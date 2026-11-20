import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql, type Transaction, type Updateable } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { CurrentUser } from '../auth/current-user.decorator.js';
import { AppError, ValidationFailedError, type ValidationIssue } from '../common/errors/app-error.js';
import { messageFor } from '../common/errors/messages.js';
import { fuzzyRepeatsExactPlace, mentionsExactPlace } from '../common/validation/exact-place.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../db/tokens.js';
import type { DropPrivateTable, DropsTable, Schema } from '../db/schema.js';
import { MarketsService } from '../markets/markets.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ReviewService } from '../review/review.service.js';
import { type OwnerDropView, ownerDropQuery, toOwnerView } from './owner-view.js';
import { type DropAction, type DropStatus, nextDropStatus } from './drop-state.js';
import type { CreateDropDto } from './dto/create-drop.dto.js';
import type { UpdateDropDto } from './dto/update-drop.dto.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ACTIVE = 5;
const COST_BOUNDS = { min: 0, max: 1000 };

/** Fields that may change while a Drop is live or paused (the change sends it back to review). */
const TEXT_FIELDS = new Set(['title', 'whyNow', 'perfectFor', 'bestTime', 'watchOut', 'meetDetail']);

type Trx = Transaction<Schema>;
type Executor = Kysely<Schema> | Trx;

const issue = (code: string, field: string, vars = {}): ValidationIssue => ({
  code,
  field,
  message: messageFor(code, vars),
});

@Injectable()
export class DropsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    private readonly markets: MarketsService,
    private readonly outbox: OutboxService,
    private readonly review: ReviewService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private viewOpts() {
    return { mediaBaseUrl: this.env.MEDIA_BASE_URL };
  }

  async create(me: CurrentUser, dto: CreateDropDto): Promise<OwnerDropView> {
    const localId = me.localId as string;
    const issues = await this.refIssues(this.db, me.id, dto.photoMediaId, dto.marketId);
    if (issues.length) throw new ValidationFailedError(issues);

    const id = uuidv7();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('drops')
        .values({
          id,
          local_id: localId,
          market_id: dto.marketId,
          title: dto.title,
          why_now: dto.whyNow,
          perfect_for: dto.perfectFor,
          cost_min_usd: dto.costMinUsd,
          cost_max_usd: dto.costMaxUsd,
          time_minutes: dto.timeMinutes,
          best_time: dto.bestTime ?? null,
          watch_out: dto.watchOut,
          photo_media_id: dto.photoMediaId,
          photo_is_stand_in: dto.photoIsStandIn ?? false,
          fuzzy_area: dto.fuzzyArea,
          unlock_price_minor: dto.unlockPriceCredits * 100,
          unlock_cap: dto.unlocksPerDay,
          window_hours: dto.windowHours,
          status: 'draft',
        })
        .execute();
      await trx
        .insertInto('drop_private')
        .values({ drop_id: id, exact_place: dto.exactPlace, meet_detail: dto.meetDetail ?? null })
        .execute();
    });
    return this.view(this.db, id);
  }

  async update(me: CurrentUser, id: string, dto: UpdateDropDto): Promise<OwnerDropView> {
    const touched = Object.entries(dto)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);

    return this.db.transaction().execute(async (trx) => {
      const status = await this.lock(trx, me, id);
      const current = await this.view(trx, id);
      if (touched.length === 0) return current;

      let action: DropAction = 'edit';
      if (status === 'live' || status === 'paused') {
        if (touched.some((k) => !TEXT_FIELDS.has(k))) throw new AppError(409, 'drop.field_locked');
        action = 'edit_text';
      }
      const next = nextDropStatus(status, action);

      const issues = [
        ...(await this.refIssues(trx, me.id, dto.photoMediaId, dto.marketId)),
        ...this.mergedIssues(current, dto),
      ];
      if (issues.length) throw new ValidationFailedError(issues);

      const set: Updateable<DropsTable> = { status: next, updated_at: new Date() };
      if (dto.title !== undefined) set.title = dto.title;
      if (dto.whyNow !== undefined) set.why_now = dto.whyNow;
      if (dto.perfectFor !== undefined) set.perfect_for = dto.perfectFor;
      if (dto.costMinUsd !== undefined) set.cost_min_usd = dto.costMinUsd;
      if (dto.costMaxUsd !== undefined) set.cost_max_usd = dto.costMaxUsd;
      if (dto.timeMinutes !== undefined) set.time_minutes = dto.timeMinutes;
      if (dto.bestTime !== undefined) set.best_time = dto.bestTime;
      if (dto.watchOut !== undefined) set.watch_out = dto.watchOut;
      if (dto.photoMediaId !== undefined) set.photo_media_id = dto.photoMediaId;
      if (dto.photoIsStandIn !== undefined) set.photo_is_stand_in = dto.photoIsStandIn;
      if (dto.marketId !== undefined) set.market_id = dto.marketId;
      if (dto.fuzzyArea !== undefined) set.fuzzy_area = dto.fuzzyArea;
      if (dto.windowHours !== undefined) set.window_hours = dto.windowHours;
      if (dto.unlocksPerDay !== undefined) set.unlock_cap = dto.unlocksPerDay;
      if (dto.unlockPriceCredits !== undefined) set.unlock_price_minor = dto.unlockPriceCredits * 100;
      await this.apply(trx, id, status, set);

      const priv: Updateable<DropPrivateTable> = {};
      if (dto.exactPlace !== undefined) priv.exact_place = dto.exactPlace;
      if (dto.meetDetail !== undefined) priv.meet_detail = dto.meetDetail;
      if (Object.keys(priv).length) await trx.updateTable('drop_private').set(priv).where('drop_id', '=', id).execute();

      if (next === 'pending') await this.sendToReview(trx, me, id, { resubmitted: true });
      return this.view(trx, id);
    });
  }

  async submit(me: CurrentUser, id: string): Promise<OwnerDropView & { message: string }> {
    const view = await this.db.transaction().execute(async (trx) => {
      // Serialize submits per local so two at once cannot both slip under the limit.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${me.localId as string}))`.execute(trx);
      const status = await this.lock(trx, me, id);
      const next = nextDropStatus(status, 'submit');

      const { count } = await trx
        .selectFrom('drops')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('local_id', '=', me.localId as string)
        .where('status', 'in', ['pending', 'live', 'paused'])
        .where('id', '!=', id)
        .executeTakeFirstOrThrow();
      if (Number(count) >= MAX_ACTIVE) throw new AppError(409, 'drop.limit_live');

      await this.apply(trx, id, status, { status: next, updated_at: new Date() });
      await this.sendToReview(trx, me, id, {});
      return this.view(trx, id);
    });
    return { ...view, message: messageFor('drop.submitted') };
  }

  pause(me: CurrentUser, id: string) {
    return this.simple(me, id, 'pause');
  }

  resume(me: CurrentUser, id: string) {
    return this.simple(me, id, 'resume');
  }

  end(me: CurrentUser, id: string) {
    return this.simple(me, id, 'end');
  }

  async raiseCap(me: CurrentUser, id: string, unlocksPerDay: number): Promise<OwnerDropView> {
    return this.db.transaction().execute(async (trx) => {
      const status = await this.lock(trx, me, id);
      if (status !== 'draft' && status !== 'live' && status !== 'paused') throw new AppError(409, 'drop.invalid_transition');
      const current = await this.view(trx, id);
      if (unlocksPerDay < current.unlocksPerDay) throw new AppError(422, 'drop.cap_lower', 'unlocksPerDay');
      if (unlocksPerDay === current.unlocksPerDay) return current;
      await this.apply(trx, id, status, { unlock_cap: unlocksPerDay, updated_at: new Date() });
      return this.view(trx, id);
    });
  }

  async duplicate(me: CurrentUser, id: string): Promise<OwnerDropView> {
    const copyId = uuidv7();
    await this.db.transaction().execute(async (trx) => {
      await this.lock(trx, me, id);
      const src = await this.view(trx, id);
      const row = await trx.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      await trx
        .insertInto('drops')
        .values({
          id: copyId,
          local_id: row.local_id,
          market_id: row.market_id,
          title: row.title,
          why_now: row.why_now,
          perfect_for: row.perfect_for,
          cost_min_usd: row.cost_min_usd,
          cost_max_usd: row.cost_max_usd,
          time_minutes: row.time_minutes,
          best_time: row.best_time,
          watch_out: row.watch_out,
          photo_media_id: row.photo_media_id,
          photo_is_stand_in: row.photo_is_stand_in,
          fuzzy_area: row.fuzzy_area,
          unlock_price_minor: row.unlock_price_minor,
          unlock_cap: row.unlock_cap,
          window_hours: row.window_hours,
          status: 'draft',
        })
        .execute();
      await trx
        .insertInto('drop_private')
        .values({ drop_id: copyId, exact_place: src.exactPlace, meet_detail: src.meetDetail })
        .execute();
    });
    return this.view(this.db, copyId);
  }

  async listMine(me: CurrentUser): Promise<OwnerDropView[]> {
    const rows = await this.ownerQuery(this.db)
      .where('drops.local_id', '=', me.localId as string)
      .orderBy('drops.created_at', 'desc')
      .orderBy('drops.id', 'desc')
      .execute();
    return rows.map((r) => toOwnerView(r, this.viewOpts()));
  }

  async getMine(me: CurrentUser, id: string): Promise<OwnerDropView> {
    if (!UUID.test(id)) throw new AppError(404, 'not_found');
    const row = await this.ownerQuery(this.db)
      .where('drops.id', '=', id)
      .where('drops.local_id', '=', me.localId as string)
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'not_found');
    return toOwnerView(row, this.viewOpts());
  }

  // ---- internals ----

  private async simple(me: CurrentUser, id: string, action: DropAction): Promise<OwnerDropView> {
    return this.db.transaction().execute(async (trx) => {
      const status = await this.lock(trx, me, id);
      const next = nextDropStatus(status, action);
      await this.apply(trx, id, status, { status: next, updated_at: new Date() });
      return this.view(trx, id);
    });
  }

  /** Locks the caller's own Drop row and returns its status. Not found or not theirs: 404. */
  private async lock(trx: Trx, me: CurrentUser, id: string): Promise<DropStatus> {
    if (!UUID.test(id)) throw new AppError(404, 'not_found');
    const row = await trx
      .selectFrom('drops')
      .select('status')
      .where('id', '=', id)
      .where('local_id', '=', me.localId as string)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'not_found');
    return row.status;
  }

  /** Conditional update: applies only if the status is still the one we decided on. */
  private async apply(trx: Trx, id: string, expected: DropStatus, set: Updateable<DropsTable>): Promise<void> {
    const res = await trx.updateTable('drops').set(set).where('id', '=', id).where('status', '=', expected).executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw new AppError(409, 'drop.invalid_transition');
  }

  private async sendToReview(trx: Trx, me: CurrentUser, id: string, data: Record<string, unknown>): Promise<void> {
    await this.review.enqueue(trx, 'drop', id);
    await this.outbox.add(trx, { type: 'drop.submitted', subjectKind: 'drop', subjectId: id, actorId: me.id, data });
  }

  private ownerQuery(db: Executor) {
    return ownerDropQuery(db);
  }

  private async view(db: Executor, id: string): Promise<OwnerDropView> {
    const row = await this.ownerQuery(db).where('drops.id', '=', id).executeTakeFirstOrThrow();
    return toOwnerView(row, this.viewOpts());
  }

  /** The photo must be a ready upload of the caller; the market must exist. Both come back as field errors. */
  private async refIssues(db: Executor, userId: string, photoMediaId?: string, marketId?: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    if (photoMediaId !== undefined) {
      const ok =
        UUID.test(photoMediaId) &&
        (await db
          .selectFrom('media')
          .select('id')
          .where('id', '=', photoMediaId)
          .where('owner_user_id', '=', userId)
          .where('status', '=', 'ready')
          .executeTakeFirst());
      if (!ok) issues.push(issue('photo.not_ready', 'photoMediaId'));
    }
    if (marketId !== undefined) {
      try {
        await this.markets.require(marketId);
      } catch (err) {
        if (!(err instanceof AppError) || err.status !== 422) throw err;
        issues.push(issue(err.code, err.field ?? 'marketId'));
      }
    }
    return issues;
  }

  /**
   * Checks that need the stored values: the exact-place rules and the cost order. A field is
   * checked when it was edited, or when the exact place changed under it. Issues carry codes
   * and messages only, never the exact place.
   */
  private mergedIssues(current: OwnerDropView, dto: UpdateDropDto): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const place = dto.exactPlace ?? current.exactPlace;
    const placeChanged = dto.exactPlace !== undefined;
    const publicText: [string, string, string | undefined][] = [
      ['title', dto.title ?? current.title, dto.title],
      ['whyNow', dto.whyNow ?? current.whyNow, dto.whyNow],
      ['watchOut', dto.watchOut ?? current.watchOut, dto.watchOut],
    ];
    for (const [field, value, edited] of publicText) {
      if ((placeChanged || edited !== undefined) && mentionsExactPlace(value, place)) issues.push(issue(`${field}.exact_place`, field));
    }
    const fuzzy = dto.fuzzyArea ?? current.fuzzyArea;
    if ((placeChanged || dto.fuzzyArea !== undefined) && fuzzyRepeatsExactPlace(fuzzy, place)) {
      issues.push(issue('fuzzyArea.exact_place', 'fuzzyArea'));
    }
    const min = dto.costMinUsd ?? current.cost.minUsd;
    const max = dto.costMaxUsd ?? current.cost.maxUsd;
    if ((dto.costMinUsd !== undefined || dto.costMaxUsd !== undefined) && max < min) {
      issues.push(issue('cost.range', 'costMaxUsd', COST_BOUNDS));
    }
    return issues;
  }
}
