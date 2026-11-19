import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../db/schema.js';

@Injectable()
export class ReviewService {
  /**
   * Adds a pending review item inside the caller's transaction. The database allows one
   * pending item per (kind, ref_id), so a second concurrent enqueue fails instead of duplicating.
   */
  async enqueue(trx: Transaction<Schema>, kind: 'drop' | 'event', refId: string, flags: string[] = []): Promise<void> {
    await trx
      .insertInto('review_items')
      .values({ id: uuidv7(), kind, ref_id: refId, state: 'pending', flags, submitted_at: new Date() })
      .execute();
  }
}
