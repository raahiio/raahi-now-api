import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AppError } from '../common/errors/app-error.js';
import { DB, PUBLIC_DB } from '../db/tokens.js';
import type { Schema } from '../db/schema.js';

export interface Market {
  id: string;
  city: string;
  country: string;
  tz: string;
  resetTime: string;
  currency: string;
  status: 'open' | 'preview';
}

@Injectable()
export class MarketsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    @Inject(PUBLIC_DB) private readonly publicDb: Kysely<Schema>,
  ) {}

  /** Public list, ordered by city. */
  async list(): Promise<Market[]> {
    const rows = await this.publicDb
      .selectFrom('markets')
      .select([
        'id',
        'city',
        'country',
        'tz',
        'reset_time',
        'currency',
        'status',
      ])
      .orderBy('city')
      .execute();
    return rows.map(toMarket);
  }

  /** Throws 422 `market.invalid` on `marketId` unless the market exists. */
  async require(id: string): Promise<Market> {
    const row = await this.db
      .selectFrom('markets')
      .select([
        'id',
        'city',
        'country',
        'tz',
        'reset_time',
        'currency',
        'status',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new AppError(422, 'market.invalid', 'marketId');
    return toMarket(row);
  }
}

function toMarket(row: {
  id: string;
  city: string;
  country: string;
  tz: string;
  reset_time: string;
  currency: string;
  status: 'open' | 'preview';
}): Market {
  return {
    id: row.id,
    city: row.city,
    country: row.country,
    tz: row.tz,
    resetTime: row.reset_time.slice(0, 5),
    currency: row.currency,
    status: row.status,
  };
}
