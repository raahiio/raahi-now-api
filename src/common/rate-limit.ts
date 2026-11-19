import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { DB } from '../db/tokens.js';
import type { Schema } from '../db/schema.js';
import { AppError } from './errors/app-error.js';

@Injectable()
export class RateLimiter {
  constructor(@Inject(DB) private readonly db: Kysely<Schema>) {}

  /**
   * Records a hit and throws 429 `rate_limited` when the hits in the last `windowSeconds`
   * (this one included) exceed `limit`. A refused hit is rolled back, so it does not extend the
   * lockout. Insert-then-count runs in one READ COMMITTED transaction without a lock: two
   * simultaneous hits can both see a count that omits the other, so the limit can be overshot
   * by the number of concurrent requests. Accepted for abuse throttling.
   */
  async hit(kind: string, keyHash: string, limit: number, windowSeconds: number): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('rate_events').values({ kind, key_hash: keyHash }).execute();
      const row = await trx
        .selectFrom('rate_events')
        .select(sql<string>`count(*)`.as('n'))
        .where('kind', '=', kind)
        .where('key_hash', '=', keyHash)
        .where(sql<boolean>`created_at > now() - make_interval(secs => ${windowSeconds})`)
        .executeTakeFirstOrThrow();
      if (Number(row.n) > limit) throw new AppError(429, 'rate_limited');
    });
  }
}
