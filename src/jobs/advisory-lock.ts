import { type Kysely, sql } from 'kysely';
import type { Schema } from '../db/schema.js';

/**
 * Runs `fn` only if no other session holds advisory lock `key`. Session-level advisory locks belong
 * to one Postgres connection, so lock and unlock must run on the same one: a dedicated connection is
 * checked out of the pool for the whole call (a pooled `db.selectFrom` could hit different sessions).
 */
export async function withAdvisoryLock<T>(
  db: Kysely<Schema>,
  key: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  return db.connection().execute(async (conn) => {
    const { rows } = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(${key}) AS locked`.execute(conn);
    if (!rows[0]?.locked) return { ran: false as const };
    try {
      return { ran: true as const, value: await fn() };
    } finally {
      await sql`SELECT pg_advisory_unlock(${key})`.execute(conn);
    }
  });
}
