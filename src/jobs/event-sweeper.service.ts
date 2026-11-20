import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Clock } from '../common/clock.js';
import { DB } from '../db/tokens.js';
import type { Schema } from '../db/schema.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { withAdvisoryLock } from './advisory-lock.js';

export const EVENT_SWEEPER_LOCK_KEY = 71_003;

@Injectable()
export class EventSweeper {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  /** Marks upcoming events `past` 3 hours after their end (or start, with no end). Returns the count. */
  async run(now: Date = this.clock.now()): Promise<number> {
    const res = await withAdvisoryLock(this.db, EVENT_SWEEPER_LOCK_KEY, () =>
      this.db.transaction().execute(async (trx) => {
        const rows = await trx
          .updateTable('events')
          .set({ status: 'past', updated_at: now })
          .where('status', '=', 'upcoming')
          .where(sql<boolean>`COALESCE(ends_at, starts_at) + interval '3 hours' <= ${now}`)
          .returning('id')
          .execute();
        for (const row of rows) {
          await this.outbox.add(trx, {
            type: 'event.ended',
            subjectKind: 'event',
            subjectId: row.id,
            actorId: null,
            data: { reason: 'ended' },
          });
        }
        return rows.length;
      }),
    );
    return res.ran ? res.value : 0;
  }
}
