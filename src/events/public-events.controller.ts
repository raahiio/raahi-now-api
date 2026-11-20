import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import type { RequestWithUser } from '../auth/current-user.decorator.js';
import { OptionalAuth } from '../auth/roles.decorator.js';
import { applyCacheHeaders } from '../common/cache-headers.js';
import { Clock } from '../common/clock.js';
import { AppError } from '../common/errors/app-error.js';
import { decodeCursor, encodeCursor, parseLimit } from '../common/pagination.js';
import { resolveWallClock, WallClockError } from '../common/time/wall-clock.js';
import type { EventCategory, Schema } from '../db/schema.js';
import { DB } from '../db/tokens.js';
import { GuestAuthGuard } from '../guests/guest-auth.guard.js';
import { type EventRow, type EventView, serializeEvent } from './event.serializer.js';
import { ownerEventQuery } from './owner-view.js';
import { PublicEventsRepository } from './public-events.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES: readonly string[] = ['tasting', 'walk', 'market', 'class', 'gathering'] satisfies EventCategory[];

/** First instant of a calendar day in a zone. A midnight that does not exist (or repeats) starts at the day's first valid instant. */
function startOfDay(date: string, tz: string): Date {
  try {
    return resolveWallClock(`${date}T00:00`, tz);
  } catch (err) {
    if (!(err instanceof WallClockError) || err.kind === 'invalid') throw err;
    return DateTime.fromISO(date, { zone: tz }).startOf('day').toJSDate();
  }
}

function parseDay(raw: unknown, field: 'from' | 'to'): string | undefined {
  if (raw === undefined) return undefined;
  const invalid = () => new AppError(422, `${field}.invalid`, field);
  if (typeof raw !== 'string' || !DATE.test(raw)) throw invalid();
  const d = DateTime.fromISO(raw, { zone: 'utc' });
  if (!d.isValid || d.toISODate() !== raw) throw invalid();
  return raw;
}

@Controller('events')
@OptionalAuth()
export class PublicEventsController {
  constructor(
    private readonly repo: PublicEventsRepository,
    private readonly guestAuth: GuestAuthGuard,
    private readonly clock: Clock,
    @Inject(DB) private readonly db: Kysely<Schema>,
  ) {}

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
    @Query('market') market?: unknown,
    @Query('from') from?: unknown,
    @Query('to') to?: unknown,
    @Query('category') category?: unknown,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ) {
    applyCacheHeaders(req, res);
    const take = parseLimit(limit);
    const after = cursor === undefined ? undefined : decodeCursor(cursor as string);
    const marketId = typeof market === 'string' && market !== '' ? market : undefined;
    const fromDay = parseDay(from, 'from');
    const toDay = parseDay(to, 'to');
    if ((fromDay || toDay) && !marketId) throw new AppError(422, 'market.required', 'market');
    if (category !== undefined && (typeof category !== 'string' || !CATEGORIES.includes(category))) {
      throw new AppError(422, 'category.invalid', 'category');
    }

    let fromAt: Date | undefined;
    let toAt: Date | undefined;
    if (marketId && (fromDay || toDay)) {
      const tz = await this.repo.marketTz(marketId);
      if (!tz) return { items: [], nextCursor: null };
      if (fromDay) fromAt = startOfDay(fromDay, tz);
      if (toDay) toAt = startOfDay(DateTime.fromISO(toDay, { zone: 'utc' }).plus({ days: 1 }).toISODate() as string, tz);
    }

    const now = this.clock.now();
    const page = await this.repo.list({
      marketId,
      category: category as EventCategory | undefined,
      from: fromAt,
      to: toAt,
      limit: take,
      after,
      now,
    });
    const rows = await this.withPublicAddresses(page.rows);
    return {
      items: rows.map((r) => serializeEvent(r, 'public', now)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    };
  }

  @Get(':id')
  async get(@Req() req: RequestWithUser, @Res({ passthrough: true }) res: Response, @Param('id') id: string): Promise<EventView> {
    applyCacheHeaders(req, res);
    // A claim code is a credential but not an Authorization header, so keep the owner's copy out of shared caches.
    if (req.headers['x-claim-code'] !== undefined) res.setHeader('Cache-Control', 'private, no-store');
    if (!UUID.test(id)) throw new AppError(404, 'not_found');
    const now = this.clock.now();
    const me = req.user;

    // Reviewers and admins read any status; an owner reads their own; everyone else gets the public view.
    const reviewer = Boolean(me && (me.roles.includes('reviewer') || me.roles.includes('admin')));
    if (reviewer) {
      const row = await ownerEventQuery(this.db).where('events.id', '=', id).executeTakeFirst();
      if (row) return serializeEvent(row, 'reviewer', now);
    } else {
      const owned = await this.ownedBy(req, id);
      if (owned) return serializeEvent(owned, 'owner', now);
    }

    const row = await this.repo.findVisible(id, now);
    if (!row) throw new AppError(404, 'not_found');
    const [withAddress] = await this.withPublicAddresses([row]);
    return serializeEvent(withAddress as EventRow, 'public', now);
  }

  /** The event if this caller owns it by account, claim code or manage token. */
  private async ownedBy(req: RequestWithUser, id: string) {
    const me = req.user;
    if (me) {
      const row = await ownerEventQuery(this.db).where('events.id', '=', id).where('events.owner_user_id', '=', me.id).executeTakeFirst();
      if (row) return row;
    }
    const guest = await this.guestAuth.peek(req, id);
    if (!guest) return undefined;
    return ownerEventQuery(this.db)
      .where('events.id', '=', id)
      .where('events.guest_identity_id', '=', guest.identityId)
      .executeTakeFirst();
  }

  /**
   * exact_address lives in event_private, which the public role cannot read. Once the public query
   * has decided which events are visible, read the address on the app connection for exactly the
   * ones whose visibility is `public`, in one query. after_rsvp addresses are never fetched.
   */
  private async withPublicAddresses(rows: EventRow[]): Promise<EventRow[]> {
    const ids = rows.filter((r) => r.address_visibility === 'public').map((r) => r.id);
    if (ids.length === 0) return rows;
    const found = await this.db.selectFrom('event_private').select(['event_id', 'exact_address']).where('event_id', 'in', ids).execute();
    const byId = new Map(found.map((f) => [f.event_id, f.exact_address]));
    return rows.map((r) => (byId.has(r.id) ? { ...r, exact_address: byId.get(r.id) } : r));
  }
}
