import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type { Cursor } from '../common/pagination.js';
import { PUBLIC_DB } from '../db/tokens.js';
import type { Schema } from '../db/schema.js';
import type { DropRow } from './drop.serializer.js';

export interface PublicDropPage {
  rows: DropRow[];
  /** Position of the last returned row, or null when this is the last page. */
  next: Cursor | null;
}

/** Public reads. Runs only on the read-restricted PUBLIC_DB role: no private columns, named columns only. */
@Injectable()
export class PublicDropsRepository {
  constructor(@Inject(PUBLIC_DB) private readonly db: Kysely<Schema>) {}

  /** Live and unexpired is enforced here, so a Drop the sweeper has not reached yet is still hidden. */
  private base() {
    return this.db
      .selectFrom('drops')
      .innerJoin('markets', 'markets.id', 'drops.market_id')
      .innerJoin('locals', 'locals.id', 'drops.local_id')
      .selectAll('drops')
      .select([
        'markets.city as market_city',
        'markets.tz as market_tz',
        'locals.display_name as local_display_name',
        'locals.role_title as local_role_title',
        'locals.verified_at as local_verified_at',
      ])
      .where('drops.status', '=', 'live')
      .where(sql<boolean>`drops.expires_at > now()`);
  }

  async list(opts: { marketId?: string; limit: number; after?: Cursor }): Promise<PublicDropPage> {
    let q = this.base()
      // Microsecond-exact cursor position: a JS Date would truncate to milliseconds.
      .select(sql<string>`to_char(drops.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('cursor_t'))
      .orderBy('drops.approved_at', 'desc')
      .orderBy('drops.id', 'desc')
      .limit(opts.limit + 1);
    if (opts.marketId) q = q.where('drops.market_id', '=', opts.marketId);
    if (opts.after) {
      q = q.where(sql<boolean>`(drops.approved_at, drops.id) < (${opts.after.t}::timestamptz, ${opts.after.id}::uuid)`);
    }
    const fetched = await q.execute();
    const rows = fetched.slice(0, opts.limit);
    const last = rows[rows.length - 1];
    const next = fetched.length > opts.limit && last ? { t: last.cursor_t, id: last.id } : null;
    return { rows, next };
  }

  async findLive(id: string): Promise<DropRow | undefined> {
    return this.base().where('drops.id', '=', id).executeTakeFirst();
  }
}
