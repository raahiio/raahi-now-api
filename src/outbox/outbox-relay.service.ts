import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { withAdvisoryLock } from '../jobs/advisory-lock.js';
import { DB } from '../db/tokens.js';
import type { Schema } from '../db/schema.js';
import { type Envelope, EventPublisher } from './event-publisher.js';

export const RELAY_LOCK_KEY = 71_001;
const BATCH_SIZE = 100;

interface Payload {
  actorId?: string | null;
  data?: Record<string, unknown>;
}

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    private readonly publisher: EventPublisher,
  ) {}

  /** Publishes up to 100 unpublished rows. Returns how many were published. */
  async run(): Promise<number> {
    const res = await withAdvisoryLock(this.db, RELAY_LOCK_KEY, () => this.relay());
    return res.ran ? res.value : 0;
  }

  private async relay(): Promise<number> {
    const rows = await this.db
      .selectFrom('outbox')
      .selectAll()
      .where('published_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .limit(BATCH_SIZE)
      .execute();

    const failedSubjects = new Set<string>();
    let published = 0;
    for (const row of rows) {
      const subjectKey = `${row.subject_kind}:${row.subject_id}`;
      if (failedSubjects.has(subjectKey)) continue; // keep per-subject order
      const payload = (row.payload ?? {}) as Payload;
      const envelope: Envelope = {
        id: row.id,
        type: row.type,
        v: 1,
        occurredAt: row.created_at.toISOString(),
        actor: { id: payload.actorId ?? null },
        subject: { kind: row.subject_kind, id: row.subject_id },
        data: payload.data ?? {},
      };
      try {
        await this.publisher.publish(envelope);
      } catch (err) {
        failedSubjects.add(subjectKey);
        this.logger.warn(`publish failed for outbox ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      await this.db.updateTable('outbox').set({ published_at: sql`now()` }).where('id', '=', row.id).execute();
      published += 1;
    }
    return published;
  }
}
