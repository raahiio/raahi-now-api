import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, type RawBuilder, sql, type Transaction, type Updateable } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { CurrentUser } from '../auth/current-user.decorator.js';
import { Clock } from '../common/clock.js';
import { AppError, ValidationFailedError, type ValidationIssue } from '../common/errors/app-error.js';
import { messageFor } from '../common/errors/messages.js';
import { RateLimiter } from '../common/rate-limit.js';
import { resolveWallClock, WallClockError } from '../common/time/wall-clock.js';
import type { EventsTable, EventStatus, Schema } from '../db/schema.js';
import { DB } from '../db/tokens.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { type CallerKeys, GuestIdentitiesService } from '../guests/guest-identities.service.js';
import { Mailer } from '../mail/mailer.js';
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
const DAY_SECONDS = 86_400;
const GUEST_POSTS_PER_DEVICE = 2;
const GUEST_POSTS_PER_IP = 5;

/** Who is acting on an event: a signed-in account, or a guest identified by a claim. */
export type EventActor =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; identityId: string; deviceHash: string | null };

type Owner =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; email: string; hostName: string; deviceHash: string; claimHash: string };

export type GuestCreated = OwnerEventView & { claimCode: string; message: string };

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
    private readonly limiter: RateLimiter,
    private readonly guests: GuestIdentitiesService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private readonly logger = new Logger('Events');

  /** Account host. Guest-only fields are not allowed here. */
  async create(me: CurrentUser, dto: CreateEventDto): Promise<OwnerEventView> {
    const unknown = (['hostName', 'hostEmail'] as const)
      .filter((f) => dto[f] !== undefined)
      .map((f) => issue('field.unknown', f));
    if (unknown.length) throw new ValidationFailedError(unknown);
    return this.createFor({ kind: 'user', userId: me.id }, dto);
  }

  /**
   * Guest host. Order: device header, field and time validation (no writes), the two daily
   * limits, then the write. The claim code is returned once and mailed; `hostEmail` goes into
   * the identity row and the mail only.
   */
  async createAsGuest(dto: CreateEventDto, keys: CallerKeys): Promise<GuestCreated> {
    if (!keys.deviceHash) throw new AppError(422, 'device.required', 'X-Device-Id');
    const missing = (['hostName', 'hostEmail'] as const)
      .filter((f) => dto[f] === undefined || dto[f] === null)
      .map((f) => issue(`${f}.required`, f));

    const prepared = await this.prepare({ kind: 'guest', identityId: '', deviceHash: keys.deviceHash }, dto, missing);
    await this.limiter.hit('guest_event_device', keys.deviceHash, GUEST_POSTS_PER_DEVICE, DAY_SECONDS);
    await this.limiter.hit('guest_event_ip', keys.ipHash, GUEST_POSTS_PER_IP, DAY_SECONDS);

    const { code, hash } = this.guests.newCode();
    const email = (dto.hostEmail as string).trim();
    const owner: Owner = { kind: 'guest', email, hostName: dto.hostName as string, deviceHash: keys.deviceHash, claimHash: hash };
    const { id } = await this.insert(owner, dto, prepared);

    try {
      await this.mailer.send({
        to: email,
        subject: 'Your Raahi event claim code',
        text:
          `Thanks for posting "${dto.name}".\n\nYour claim code is ${code}\n\n` +
          'Keep it safe. You need it to edit or cancel your event.',
      });
    } catch (err) {
      // The code is also in the response, so a mail outage must not fail the post.
      this.logger.error(`claim mail failed: ${err instanceof Error ? err.name : 'unknown'}`);
    }
    const view = await this.view(this.db, id);
    return { ...view, claimCode: code, message: messageFor('event.guest_submitted', { email }) };
  }

  private async createFor(owner: Owner, dto: CreateEventDto): Promise<OwnerEventView> {
    const prepared = await this.prepare(this.actorOf(owner), dto, []);
    const { id } = await this.insert(owner, dto, prepared);
    return this.view(this.db, id);
  }

  private actorOf(owner: Owner): EventActor {
    return owner.kind === 'user'
      ? { kind: 'user', userId: owner.userId }
      : { kind: 'guest', identityId: '', deviceHash: owner.deviceHash };
  }

  /** Validation with no writes. Throws one 422 with every issue found. */
  private async prepare(actor: EventActor, dto: CreateEventDto, issues: ValidationIssue[]) {
    let market: Market | undefined;
    try {
      market = await this.markets.require(dto.marketId);
    } catch (err) {
      if (!(err instanceof AppError) || err.status !== 422) throw err;
      issues.push(issue(err.code, err.field ?? 'marketId'));
    }
    issues.push(...(await this.photoIssues(this.db, actor, dto.photoMediaId)));
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
    return { startsAt, endsAt };
  }

  private async insert(owner: Owner, dto: CreateEventDto, times: { startsAt: Date; endsAt: Date | null }) {
    const id = uuidv7();
    const { startsAt: start, endsAt: end } = times;
    const lockKey = owner.kind === 'user' ? `event:${owner.userId}` : `event:guest:${owner.email.toLowerCase()}`;
    let status: 'pending' | 'upcoming' = 'pending';
    await this.db.transaction().execute(async (trx) => {
      // Serialize creates per owner so two at once cannot both pass the duplicate and first-host checks.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`.execute(trx);
      const ownerCond = this.ownerCondition(owner.kind === 'user' ? owner.userId : null, owner.kind === 'guest' ? owner.email : null);
      await this.assertNoDuplicate(trx, ownerCond, dto.name, dto.marketId, start, null);

      const returning = await trx
        .selectFrom('events')
        .select('events.id')
        .where(ownerCond)
        .where('events.status', 'in', ['upcoming', 'past'])
        .limit(1)
        .executeTakeFirst();
      status = returning ? 'upcoming' : 'pending';

      let guestIdentityId: string | null = null;
      let host: { name: string; badge: 'verified_local' | 'community_host' };
      if (owner.kind === 'user') {
        host = await this.host(trx, owner.userId);
      } else {
        guestIdentityId = uuidv7();
        await trx
          .insertInto('guest_identities')
          .values({ id: guestIdentityId, email: owner.email, claim_hash: owner.claimHash })
          .execute();
        host = { name: owner.hostName, badge: 'community_host' };
      }
      const actorId = owner.kind === 'user' ? owner.userId : null;

      await trx
        .insertInto('events')
        .values({
          id,
          owner_user_id: actorId,
          guest_identity_id: guestIdentityId,
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
        await this.outbox.add(trx, { type: 'event.submitted', subjectKind: 'event', subjectId: id, actorId, data: {} });
      } else {
        await this.outbox.add(trx, { type: 'event.approved', subjectKind: 'event', subjectId: id, actorId, data: {} });
      }
    });
    return { id, status };
  }

  /** Phase 1: an edit does not send the event back to review. */
  async update(actor: EventActor, id: string, dto: UpdateEventDto): Promise<OwnerEventView> {
    return this.db.transaction().execute(async (trx) => {
      const ownerCond = this.ownerConditionFor(actor);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${await this.lockKeyFor(trx, actor)}))`.execute(trx);
      await this.lock(trx, ownerCond, id);
      const current = await ownerEventQuery(trx).where('events.id', '=', id).executeTakeFirstOrThrow();

      const issues: ValidationIssue[] = [];
      if (dto.photoMediaId) issues.push(...(await this.photoIssues(trx, actor, dto.photoMediaId)));

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
        await this.assertNoDuplicate(trx, ownerCond, name, current.market_id, startsAt, id);
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

  async cancel(actor: EventActor, id: string): Promise<OwnerEventView> {
    return this.db.transaction().execute(async (trx) => {
      const status = await this.lock(trx, this.ownerConditionFor(actor), id);
      const now = new Date();
      await trx.updateTable('events').set({ status: 'cancelled', updated_at: now }).where('id', '=', id).execute();
      if (status === 'pending') {
        // A cancelled event must leave the review queue.
        await trx
          .updateTable('review_items')
          .set({ state: 'removed', reason: 'Cancelled by host', decided_at: now })
          .where('kind', '=', 'event')
          .where('ref_id', '=', id)
          .where('state', '=', 'pending')
          .execute();
      }
      await this.outbox.add(trx, {
        type: 'event.cancelled',
        subjectKind: 'event',
        subjectId: id,
        actorId: actor.kind === 'user' ? actor.userId : null,
        data: {},
      });
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

  /** SQL condition: the event belongs to this account, or to a guest identity with this email. */
  private ownerCondition(userId: string | null, guestEmail: string | null): RawBuilder<boolean> {
    return userId !== null
      ? sql<boolean>`events.owner_user_id = ${userId}`
      : sql<boolean>`events.guest_identity_id in (select id from guest_identities where lower(email) = ${(guestEmail as string).toLowerCase()})`;
  }

  /**
   * Ownership for an existing event. A guest actor owns exactly its own identity's event here:
   * duplicate checks widen to the email, ownership does not.
   */
  private ownerConditionFor(actor: EventActor): RawBuilder<boolean> {
    return actor.kind === 'user'
      ? this.ownerCondition(actor.userId, null)
      : sql<boolean>`events.guest_identity_id = ${actor.identityId}`;
  }

  private async lockKeyFor(trx: Trx, actor: EventActor): Promise<string> {
    if (actor.kind === 'user') return `event:${actor.userId}`;
    const row = await trx.selectFrom('guest_identities').select('email').where('id', '=', actor.identityId).executeTakeFirst();
    return `event:guest:${(row?.email ?? actor.identityId).toLowerCase()}`;
  }

  /** Locks the caller's own editable event and returns its status. Missing or not theirs: 404. Wrong status: 409. */
  private async lock(trx: Trx, ownerCond: RawBuilder<boolean>, id: string): Promise<EventStatus> {
    if (!UUID.test(id)) throw new AppError(404, 'not_found');
    const row = await trx
      .selectFrom('events')
      .select('status')
      .where('id', '=', id)
      .where(ownerCond)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'not_found');
    if (!EDITABLE_STATUSES.includes(row.status)) throw new AppError(409, 'event.not_editable');
    return row.status;
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
    ownerCond: RawBuilder<boolean>,
    name: string,
    marketId: string,
    startsAt: Date,
    excludeId: string | null,
  ): Promise<void> {
    let q = db
      .selectFrom('events')
      .select('id')
      .where(ownerCond)
      .where('market_id', '=', marketId)
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .where('status', '!=', 'cancelled')
      .where('starts_at', '>', new Date(startsAt.getTime() - HOUR_MS))
      .where('starts_at', '<', new Date(startsAt.getTime() + HOUR_MS))
      .limit(1);
    if (excludeId) q = q.where('id', '!=', excludeId);
    if (await q.executeTakeFirst()) throw new AppError(409, 'event.duplicate');
  }

  private async photoIssues(db: Executor, actor: EventActor, photoMediaId: string | null | undefined): Promise<ValidationIssue[]> {
    if (photoMediaId === undefined || photoMediaId === null) return [];
    let ok = false;
    if (UUID.test(photoMediaId)) {
      let q = db.selectFrom('media').select('id').where('id', '=', photoMediaId).where('status', '=', 'ready');
      if (actor.kind === 'user') q = q.where('owner_user_id', '=', actor.userId);
      else if (actor.deviceHash) q = q.where('owner_device_hash', '=', actor.deviceHash);
      ok = (actor.kind === 'user' || actor.deviceHash !== null) && (await q.executeTakeFirst()) !== undefined;
    }
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
