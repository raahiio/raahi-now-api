import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Schema } from '../../src/db/schema.js';
import { testDatabaseUrl, testPublicDatabaseUrl } from './urls.js';

const open: Kysely<Schema>[] = [];

function make(url: string): Kysely<Schema> {
  const db = new Kysely<Schema>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: 4 }),
    }),
  });
  open.push(db);
  return db;
}

let appDb: Kysely<Schema> | undefined;
let publicDb: Kysely<Schema> | undefined;

/** Superuser connection to the test database. Call `closeTestDbs` in afterAll. */
export function getTestDb(): Kysely<Schema> {
  return (appDb ??= make(testDatabaseUrl()));
}

/** Connection as login role raahi_public_test (member of raahi_public_read). */
export function getTestPublicDb(): Kysely<Schema> {
  return (publicDb ??= make(testPublicDatabaseUrl()));
}

export async function closeTestDbs(): Promise<void> {
  await Promise.all(open.splice(0).map((d) => d.destroy()));
  appDb = undefined;
  publicDb = undefined;
}

/** Truncates every table except `markets`. */
export async function resetDb(db: Kysely<Schema>): Promise<void> {
  const { rows } = await sql<{ tablename: string }>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename NOT IN ('markets', 'kysely_migration', 'kysely_migration_lock')`.execute(
    db,
  );
  if (rows.length === 0) return;
  const list = sql.join(rows.map((r) => sql.table(r.tablename)));
  await sql`TRUNCATE ${list} RESTART IDENTITY CASCADE`.execute(db);
}
