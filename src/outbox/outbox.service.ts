import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../db/schema.js';

export interface OutboxEvent {
  type: string;
  subjectKind: 'drop' | 'event';
  subjectId: string;
  actorId?: string | null;
  data: Record<string, unknown>;
}

/** Private fields must never travel through the outbox. */
const FORBIDDEN_KEYS = /^(exact_?place|meet_?detail|exact_?address|host_?email|claim_?code|claim_?hash)$/i;

function assertNoPrivateKeys(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoPrivateKeys);
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) throw new Error(`Outbox payload must not contain "${key}"`);
      assertNoPrivateKeys(v);
    }
  }
}

@Injectable()
export class OutboxService {
  /** Writes an event inside the caller's transaction. Payload is `{ actorId, data }`. */
  async add(trx: Transaction<Schema>, event: OutboxEvent): Promise<void> {
    assertNoPrivateKeys(event.data);
    await trx
      .insertInto('outbox')
      .values({
        id: uuidv7(),
        type: event.type,
        subject_kind: event.subjectKind,
        subject_id: event.subjectId,
        payload: JSON.stringify({ actorId: event.actorId ?? null, data: event.data }),
      })
      .execute();
  }
}
