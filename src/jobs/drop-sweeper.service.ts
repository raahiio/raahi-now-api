import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Clock } from '../common/clock.js';
import { nextDropStatus } from '../drops/drop-state.js';
import { DB } from '../db/tokens.js';
import type { Schema } from '../db/schema.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { withAdvisoryLock } from './advisory-lock.js';

export const DROP_SWEEPER_LOCK_KEY = 71_002;

@Injectable()
export class DropSweeper {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  /** Moves live and paused Drops past their expiry to `gone` (spec §5 `expire`). Returns the count. */
  async run(now: Date = this.clock.now()): Promise<number> {
    const res = await withAdvisoryLock(this.db, DROP_SWEEPER_LOCK_KEY, () =>
      this.db.transaction().execute(async (trx) => {
        const gone = nextDropStatus('live', 'expire');
        const rows = await trx
          .updateTable('drops')
          .set({ status: gone, updated_at: now })
          .where('status', 'in', ['live', 'paused'])
          .where('expires_at', '<=', now)
          .returning(['id', 'local_id'])
          .execute();
        for (const row of rows) {
          await this.outbox.add(trx, {
            type: 'drop.ended',
            subjectKind: 'drop',
            subjectId: row.id,
            actorId: null,
            data: { reason: 'expired' },
          });
        }
        return rows.length;
      }),
    );
    return res.ran ? res.value : 0;
  }
}
