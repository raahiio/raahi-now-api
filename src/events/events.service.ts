import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql, type Transaction, type Updateable } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { CurrentUser } from '../auth/current-user.decorator.js';
import { Clock } from '../common/clock.js';
import { AppError, ValidationFailedError, type ValidationIssue } from '../common/errors/app-error.js';
import { messageFor } from '../common/errors/messages.js';
import { resolveWallClock, WallClockError } from '../common/time/wall-clock.js';
import type { EventsTable, Schema } from '../db/schema.js';
import { DB } from '../db/tokens.js';
import { type Market, MarketsService } from '../markets/markets.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ReviewService } from '../review/review.service.js';
import type { CreateEventDto } from './dto/create-event.dto.js';
import type { UpdateEventDto } from './dto/update-event.dto.js';
import { validateEventTimes } from './event-rules.js';
import { EDITABLE_STATUSES, hostBadge } from './event-state.js';
import { type OwnerEventView, ownerEventQuery, toOwnerEventView } from './owner-view.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR_MS = 3_600_000;

type Trx = Transaction<Schema>;
type Executor = Kysely<Schema> | Trx;

const issue = (code: string, field: string, vars = {}): ValidationIssue => ({
  code,
  field,
  message: messageFor(code, vars),
});

@Injectable()
export class EventsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    private readonly markets: MarketsService,
    private readonly outbox: OutboxService,
    private readonly review: ReviewService,
    private readonly clock: Clock,
  ) {}

  async create(me: CurrentUser, dto: CreateEventDto): Promise<OwnerEventView> {
    const issues: ValidationIssue[] = [];
    let market: Market | undefined;
    try {
      market = await this.markets.require(dto.marketId);
    } catch (err) {
      if (!(err instanceof AppError) || err.status !== 422) throw err;
      issues.push(issue(err.code, err.field ?? 'marketId'));
    }
    issues.push(...(await this.photoIssues(this.db, me.id, dto.photoMediaId)));
    issues.push(...this.addressIssues(dto.exactAddress ?? null, dto.addressVisibility ?? null));

    let startsAt: Date | undefined;
    let endsAt: Date | null = null;
    if (market) {
      const times = this.resolveTimes(market.tz, dto.startsLocal, dto.endsLocal ?? null, { checkStart: true });
      issues.push(...times.issues);
      startsAt = times.startsAt;
      endsAt = times.endsAt;
    }
    if (issues.length || !startsAt) throw new ValidationFailedError(issues);

    const id = uuidv7();
    const start = startsAt;
    const end = endsAt;
    await this.db.transaction().execute(async (trx) => {
      // Serialize creates per owner so two at once cannot both pass the duplicate and first-host checks.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`event:${me.id}`}))`.execute(trx);
      await this.assertNoDuplicate(trx, me.id, dto.name, dto.marketId, start, null);

      const returning = await trx
        .selectFrom('events')
        .select('id')
        .where('owner_user_id', '=', me.id)
        .where('status', 'in', ['upcoming', 'past'])
        .limit(1)
        .executeTakeFirst();
      const host = await this.host(trx, me.id);
      const status = returning ? 'upcoming' : 'pending';

      await trx
        .insertInto('events')
        .values({
          id,
          owner_user_id: me.id,
          guest_identity_id: null,
          market_id: dto.marketId,
          name: dto.name,
          category: dto.category,
          description: dto.description,
          starts_at: start,
          ends_at: end,
          date_note: dto.dateNote ?? null,
          area: dto.area,
          address_visibility: dto.exactAddress ? (dto.addressVisibility ?? null) : null,
          photo_media_id: dto.photoMediaId ?? null,
          link: dto.link ?? null,
          capacity: dto.capacity ?? null,
          host_name: host.name,
          host_badge: host.badge,
          status,
        })
        .execute();
      if (dto.exactAddress) {
        await trx.insertInto('event_private').values({ event_id: id, exact_address: dto.exactAddress }).execute();
      }

      if (status === 'pending') {
        await this.review.enqueue(trx, 'event', id);
        await this.outbox.add(trx, { type: 'event.submitted', subjectKind: 'event', subjectId: id, actorId: me.id, data: {} });
      } else {
        await this.outbox.add(trx, { type: 'event.approved', subjectKind: 'event', subjectId: id, actorId: me.id, data: {} });
      }
    });
    return this.view(this.db, id);
  }

  /** Phase 1: an edit does not send the event back to review. */
  async update(me: CurrentUser, id: string, dto: UpdateEventDto): Promise<OwnerEventView> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`event:${me.id}`}))`.execute(trx);
      await this.lock(trx, me, id);
      const current = await ownerEventQuery(trx).where('events.id', '=', id).executeTakeFirstOrThrow();

      const issues: ValidationIssue[] = [];
      if (dto.photoMediaId) issues.push(...(await this.photoIssues(trx, me.id, dto.photoMediaId)));

      const address = dto.exactAddress === undefined ? current.exact_address : dto.exactAddress;
      const visibility = dto.addressVisibility === undefined ? current.address_visibility : dto.addressVisibility;
      if (dto.exactAddress !== undefined || dto.addressVisibility !== undefined) {
        issues.push(...this.addressIssues(address, visibility));
      }

      let startsAt = current.starts_at;
      let endsAt = current.ends_at;
      if (dto.startsLocal !== undefined || dto.endsLocal !== undefined) {
        const times = this.resolveTimes(
          current.market_tz,
          dto.startsLocal,
          dto.endsLocal,
          { checkStart: dto.startsLocal !== undefined, startsAt: current.starts_at, endsAt: current.ends_at },
        );
        issues.push(...times.issues);
        startsAt = times.startsAt ?? startsAt;
        endsAt = times.endsAt;
      }
      if (issues.length) throw new ValidationFailedError(issues);

      const name = dto.name ?? current.name;
      if (dto.name !== undefined || dto.startsLocal !== undefined) {
        await this.assertNoDuplicate(trx, me.id, name, current.market_id, startsAt, id);
      }

      const set: Updateable<EventsTable> = { updated_at: new Date(), starts_at: startsAt, ends_at: endsAt };
      if (dto.name !== undefined) set.name = dto.name;
      if (dto.category !== undefined) set.category = dto.category;
      if (dto.description !== undefined) set.description = dto.description;
      if (dto.dateNote !== undefined) set.date_note = dto.dateNote;
      if (dto.area !== undefined) set.area = dto.area;
      if (dto.capacity !== undefined) set.capacity = dto.capacity;
      if (dto.photoMediaId !== undefined) set.photo_media_id = dto.photoMediaId;
      if (dto.link !== undefined) set.link = dto.link;
      if (dto.exactAddress !== undefined || dto.addressVisibility !== undefined) set.address_visibility = address ? visibility : null;
      await trx.updateTable('events').set(set).where('id', '=', id).execute();

      if (dto.exactAddress !== undefined) {
        if (dto.exactAddress === null) {
          await trx.deleteFrom('event_private').where('event_id', '=', id).execute();
        } else {
          await trx
            .insertInto('event_private')
            .values({ event_id: id, exact_address: dto.exactAddress })
            .onConflict((oc) => oc.column('event_id').doUpdateSet({ exact_address: dto.exactAddress as string }))
            .execute();
        }
      }
      return this.view(trx, id);
    });
  }

  async cancel(me: CurrentUser, id: string): Promise<OwnerEventView> {
    return this.db.transaction().execute(async (trx) => {
      await this.lock(trx, me, id);
      await trx.updateTable('events').set({ status: 'cancelled', updated_at: new Date() }).where('id', '=', id).execute();
      await this.outbox.add(trx, { type: 'event.cancelled', subjectKind: 'event', subjectId: id, actorId: me.id, data: {} });
      return this.view(trx, id);
    });
  }

  async listMine(me: CurrentUser): Promise<OwnerEventView[]> {
    const rows = await ownerEventQuery(this.db)
      .where('events.owner_user_id', '=', me.id)
      .orderBy('events.starts_at')
      .orderBy('events.id')
      .execute();
    return rows.map(toOwnerEventView);
  }

  // ---- internals ----

  /** Locks the caller's own editable event. Missing or not theirs: 404. Wrong status: 409. */
  private async lock(trx: Trx, me: CurrentUser, id: string): Promise<void> {
    if (!UUID.test(id)) throw new AppError(404, 'not_found');
    const row = await trx
      .selectFrom('events')
      .select('status')
      .where('id', '=', id)
      .where('owner_user_id', '=', me.id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'not_found');
    if (!EDITABLE_STATUSES.includes(row.status)) throw new AppError(409, 'event.not_editable');
  }

  private async view(db: Executor, id: string): Promise<OwnerEventView> {
    return toOwnerEventView(await ownerEventQuery(db).where('events.id', '=', id).executeTakeFirstOrThrow());
  }

  /** Host name and badge for an account: the local profile name when there is one, else the first name. */
  private async host(db: Executor, userId: string) {
    const row = await db
      .selectFrom('users')
      .leftJoin('locals', 'locals.user_id', 'users.id')
      .select(['users.first_name', 'locals.display_name', 'locals.verified_at'])
      .where('users.id', '=', userId)
      .executeTakeFirstOrThrow();
    return { name: row.display_name ?? row.first_name, badge: hostBadge(row.verified_at !== null && row.verified_at !== undefined) };
  }

  private async assertNoDuplicate(
    db: Executor,
    ownerId: string,
    name: string,
    marketId: string,
    startsAt: Date,
    excludeId: string | null,
  ): Promise<void> {
    let q = db
      .selectFrom('events')
      .select('id')
      .where('owner_user_id', '=', ownerId)
      .where('market_id', '=', marketId)
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .where('status', '!=', 'cancelled')
      .where('starts_at', '>', new Date(startsAt.getTime() - HOUR_MS))
      .where('starts_at', '<', new Date(startsAt.getTime() + HOUR_MS))
      .limit(1);
    if (excludeId) q = q.where('id', '!=', excludeId);
    if (await q.executeTakeFirst()) throw new AppError(409, 'event.duplicate');
  }

  private async photoIssues(db: Executor, userId: string, photoMediaId: string | null | undefined): Promise<ValidationIssue[]> {
    if (photoMediaId === undefined || photoMediaId === null) return [];
    const ok =
      UUID.test(photoMediaId) &&
      (await db
        .selectFrom('media')
        .select('id')
        .where('id', '=', photoMediaId)
        .where('owner_user_id', '=', userId)
        .where('status', '=', 'ready')
        .executeTakeFirst());
    return ok ? [] : [issue('photo.not_ready', 'photoMediaId')];
  }

  private addressIssues(address: string | null | undefined, visibility: string | null | undefined): ValidationIssue[] {
    if (address && !visibility) return [issue('addressVisibility.required', 'addressVisibility')];
    if (!address && visibility) return [issue('exactAddress.required', 'exactAddress')];
    return [];
  }

  /**
   * Resolves wall-clock inputs in the market zone and applies the time rules. On create both
   * values come from the body; on update, an undefined value keeps the stored one (`startsAt`,
   * `endsAt` in opts). A null end clears it.
   */
  private resolveTimes(
    tz: string,
    startsLocal: string | undefined,
    endsLocal: string | null | undefined,
    opts: { checkStart: boolean; startsAt?: Date; endsAt?: Date | null },
  ): { issues: ValidationIssue[]; startsAt?: Date; endsAt: Date | null } {
    const issues: ValidationIssue[] = [];
    let startsAt = opts.startsAt;
    let endsAt: Date | null = endsLocal === undefined ? (opts.endsAt ?? null) : null;

    const resolve = (local: string, field: 'startsLocal' | 'endsLocal'): Date | undefined => {
      try {
        return resolveWallClock(local, tz);
      } catch (err) {
        if (!(err instanceof WallClockError)) throw err;
        issues.push(issue(err.kind === 'invalid' ? `${field}.invalid` : `start.${err.kind === 'nonexistent' ? 'nonexistent' : 'ambiguous'}_time`, field));
        return undefined;
      }
    };

    if (startsLocal !== undefined) startsAt = resolve(startsLocal, 'startsLocal');
    if (endsLocal !== undefined && endsLocal !== null) endsAt = resolve(endsLocal, 'endsLocal') ?? null;

    if (issues.length === 0 && startsAt) {
      try {
        validateEventTimes(startsAt, endsAt, this.clock.now(), { checkStart: opts.checkStart });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        issues.push(issue(err.code, err.field ?? 'startsLocal'));
      }
    }
    return { issues, startsAt, endsAt };
  }
}
