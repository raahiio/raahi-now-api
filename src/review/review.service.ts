import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction, Updateable } from 'kysely';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../common/errors/app-error.js';
import type { DropsTable, DropStatus, EventStatus, ReviewKind, ReviewState, Schema } from '../db/schema.js';
import { DB } from '../db/tokens.js';
import { nextDropStatus } from '../drops/drop-state.js';
import { ownerDropQuery, toOwnerView } from '../drops/owner-view.js';
import { OutboxService } from '../outbox/outbox.service.js';

type Trx = Transaction<Schema>;
type Action = 'approve' | 'reject' | 'remove';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_LIMIT = 100;
const DECIDED: Record<Action, ReviewState> = { approve: 'approved', reject: 'rejected', remove: 'removed' };
const EVENT_NEXT: Record<Action, Partial<Record<EventStatus, EventStatus>>> = {
  approve: { pending: 'upcoming' },
  reject: { pending: 'rejected' },
  remove: { pending: 'removed', upcoming: 'removed', past: 'removed', rejected: 'removed' },
};

const asKind = (kind: string): ReviewKind => {
  if (kind !== 'drop' && kind !== 'event') throw new AppError(404, 'not_found');
  return kind;
};

@Injectable()
export class ReviewService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Adds a pending review item inside the caller's transaction. The database allows one
   * pending item per (kind, ref_id), so a second concurrent enqueue fails instead of duplicating.
   */
  async enqueue(trx: Trx, kind: ReviewKind, refId: string, flags: string[] = []): Promise<void> {
    await trx
      .insertInto('review_items')
      .values({ id: uuidv7(), kind, ref_id: refId, state: 'pending', flags, submitted_at: new Date() })
      .execute();
  }

  /** Pending items, oldest first, with the private fields reviewers need. */
  async queue(kind?: string) {
    const only = kind === undefined || kind === '' ? undefined : asKind(kind);
    let q = this.db
      .selectFrom('review_items')
      .select(['id', 'kind', 'ref_id', 'flags', 'submitted_at'])
      .where('state', '=', 'pending')
      .orderBy('submitted_at', 'asc')
      .orderBy('id', 'asc')
      .limit(QUEUE_LIMIT);
    if (only) q = q.where('kind', '=', only);
    const rows = await q.execute();

    const dropIds = rows.filter((r) => r.kind === 'drop').map((r) => r.ref_id);
    const eventIds = rows.filter((r) => r.kind === 'event').map((r) => r.ref_id);
    const drops = new Map(
      dropIds.length
        ? (await ownerDropQuery(this.db).where('drops.id', 'in', dropIds).execute()).map((d) => [d.id, toOwnerView(d)] as const)
        : [],
    );
    const events = new Map(
      eventIds.length ? (await this.eventViews(eventIds)).map((e) => [e.id, e] as const) : [],
    );

    return rows.flatMap((r) => {
      const item = r.kind === 'drop' ? drops.get(r.ref_id) : events.get(r.ref_id);
      if (!item) return [];
      return [
        { reviewId: r.id, kind: r.kind, refId: r.ref_id, submittedAt: r.submitted_at.toISOString(), flags: r.flags, item },
      ];
    });
  }

  approve(kind: string, id: string, reviewerId: string): Promise<void> {
    return this.decide('approve', kind, id, reviewerId);
  }

  reject(kind: string, id: string, reviewerId: string, reason: string): Promise<void> {
    return this.decide('reject', kind, id, reviewerId, reason);
  }

  remove(kind: string, id: string, reviewerId: string, reason: string): Promise<void> {
    return this.decide('remove', kind, id, reviewerId, reason);
  }

  // ---- internals ----

  private async decide(action: Action, kindParam: string, id: string, reviewerId: string, reason?: string): Promise<void> {
    const kind = asKind(kindParam);
    if (!UUID.test(id)) throw new AppError(404, 'not_found');

    await this.db.transaction().execute(async (trx) => {
      // Lock the subject first (same order as the owner flows), so concurrent decisions queue up.
      const from = await this.lockSubject(trx, kind, id);

      const decided = await trx
        .updateTable('review_items')
        .set({ state: DECIDED[action], decided_at: new Date(), reviewer_id: reviewerId, reason: reason ?? null })
        .where('kind', '=', kind)
        .where('ref_id', '=', id)
        .where('state', '=', 'pending')
        .returning('id')
        .executeTakeFirst();
      // Approve and reject need a pending item. Remove works on any item the state table allows.
      if (!decided && action !== 'remove') throw new AppError(409, 'review.not_pending');

      const to = await this.moveSubject(trx, kind, id, from, action);

      const diff = { from, to, ...(reason ? { reason } : {}) };
      await trx
        .insertInto('audit_log')
        .values({
          id: uuidv7(),
          actor_id: reviewerId,
          action: `${kind}.${action}`,
          target_kind: kind,
          target_id: id,
          diff: JSON.stringify(diff),
        })
        .execute();
      await this.outbox.add(trx, {
        type: `${kind}.${DECIDED[action]}`,
        subjectKind: kind,
        subjectId: id,
        actorId: reviewerId,
        data: diff,
      });
    });
  }

  /** Row-locks the Drop or event and returns its status. Unknown id: 404. */
  private async lockSubject(trx: Trx, kind: ReviewKind, id: string): Promise<DropStatus | EventStatus> {
    const row =
      kind === 'drop'
        ? await trx.selectFrom('drops').select('status').where('id', '=', id).forUpdate().executeTakeFirst()
        : await trx.selectFrom('events').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw new AppError(404, 'not_found');
    return row.status;
  }

  /** Conditional update from the status we read: zero rows means someone else got there first. */
  private async moveSubject(trx: Trx, kind: ReviewKind, id: string, from: string, action: Action): Promise<string> {
    const now = new Date();
    if (kind === 'event') {
      const to = EVENT_NEXT[action][from as EventStatus];
      if (!to) throw new AppError(409, 'event.invalid_transition');
      const res = await trx
        .updateTable('events')
        .set({ status: to, updated_at: now })
        .where('id', '=', id)
        .where('status', '=', from as EventStatus)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) throw new AppError(409, 'event.invalid_transition');
      return to;
    }

    const to = nextDropStatus(from as DropStatus, action);
    const set: Updateable<DropsTable> = { status: to, updated_at: now };
    if (action === 'approve') {
      // The window starts at approval, including re-approval after a live text edit.
      const { window_hours } = await trx.selectFrom('drops').select('window_hours').where('id', '=', id).executeTakeFirstOrThrow();
      set.approved_at = now;
      set.expires_at = new Date(now.getTime() + window_hours * 3_600_000);
    }
    const res = await trx
      .updateTable('drops')
      .set(set)
      .where('id', '=', id)
      .where('status', '=', from as DropStatus)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw new AppError(409, 'drop.invalid_transition');
    return to;
  }

  private async eventViews(ids: string[]) {
    const rows = await this.db
      .selectFrom('events')
      .leftJoin('event_private', 'event_private.event_id', 'events.id')
      .leftJoin('guest_identities', 'guest_identities.id', 'events.guest_identity_id')
      .leftJoin('users', 'users.id', 'events.owner_user_id')
      .selectAll('events')
      .select([
        'event_private.exact_address',
        'guest_identities.email as guest_email',
        'users.email as owner_email',
      ])
      .where('events.id', 'in', ids)
      .execute();
    return rows.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      marketId: e.market_id,
      description: e.description,
      startsAt: e.starts_at.toISOString(),
      endsAt: e.ends_at ? e.ends_at.toISOString() : null,
      dateNote: e.date_note,
      area: e.area,
      addressVisibility: e.address_visibility,
      capacity: e.capacity,
      photoMediaId: e.photo_media_id,
      link: e.link,
      hostName: e.host_name,
      hostBadge: e.host_badge,
      status: e.status,
      exactAddress: e.exact_address ?? null,
      hostEmail: e.guest_email ?? e.owner_email ?? null,
      createdAt: e.created_at.toISOString(),
    }));
  }
}
