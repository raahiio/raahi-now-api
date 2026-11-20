import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type { Cursor } from '../common/pagination.js';
import type { EventCategory, Schema } from '../db/schema.js';
import { PUBLIC_DB } from '../db/tokens.js';
import type { EventRow } from './event.serializer.js';

export interface PublicEventPage {
  rows: EventRow[];
  /** Position of the last returned row, or null when this is the last page. */
  next: Cursor | null;
}

export interface PublicEventFilter {
  marketId?: string;
  category?: EventCategory;
  /** Inclusive lower bound on starts_at. */
  from?: Date;
  /** Exclusive upper bound on starts_at. */
  to?: Date;
  limit: number;
  after?: Cursor;
  now: Date;
}

/**
 * Public reads. Runs only on the read-restricted PUBLIC_DB role: columns are named one by one
 * (owner_user_id and guest_identity_id are not granted) and event_private is never touched.
 */
@Injectable()
export class PublicEventsRepository {
  constructor(@Inject(PUBLIC_DB) private readonly db: Kysely<Schema>) {}

  /**
   * Public means upcoming and not yet 3 hours past its end (or start). `now` is a parameter, not
   * the database clock, so the injected Clock decides and tests can freeze time.
   */
  private base(now: Date) {
    return this.db
      .selectFrom('events')
      .innerJoin('markets', 'markets.id', 'events.market_id')
      .select([
        'events.id',
        'events.market_id',
        'events.name',
        'events.category',
        'events.description',
        'events.starts_at',
        'events.ends_at',
        'events.date_note',
        'events.area',
        'events.address_visibility',
        'events.photo_media_id',
        'events.link',
        'events.capacity',
        'events.host_name',
        'events.host_badge',
        'events.status',
        'events.created_at',
        'events.updated_at',
        'markets.city as market_city',
        'markets.tz as market_tz',
      ])
      .where('events.status', '=', 'upcoming')
      .where(sql<boolean>`COALESCE(events.ends_at, events.starts_at) + interval '3 hours' > ${now.toISOString()}::timestamptz`);
  }

  async marketTz(marketId: string): Promise<string | undefined> {
    const row = await this.db.selectFrom('markets').select('tz').where('id', '=', marketId).executeTakeFirst();
    return row?.tz;
  }

  async list(opts: PublicEventFilter): Promise<PublicEventPage> {
    let q = this.base(opts.now)
      // Microsecond-exact cursor position: a JS Date would truncate to milliseconds.
      .select(sql<string>`to_char(events.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('cursor_t'))
      .orderBy('events.starts_at', 'asc')
      .orderBy('events.id', 'asc')
      .limit(opts.limit + 1);
    if (opts.marketId) q = q.where('events.market_id', '=', opts.marketId);
    if (opts.category) q = q.where('events.category', '=', opts.category);
    if (opts.from) q = q.where('events.starts_at', '>=', opts.from);
    if (opts.to) q = q.where('events.starts_at', '<', opts.to);
    if (opts.after) {
      q = q.where(sql<boolean>`(events.starts_at, events.id) > (${opts.after.t}::timestamptz, ${opts.after.id}::uuid)`);
    }
    const fetched = await q.execute();
    const rows = fetched.slice(0, opts.limit);
    const last = rows[rows.length - 1];
    const next = fetched.length > opts.limit && last ? { t: last.cursor_t, id: last.id } : null;
    return { rows, next };
  }

  async findVisible(id: string, now: Date): Promise<EventRow | undefined> {
    return this.base(now).where('events.id', '=', id).executeTakeFirst();
  }
}
