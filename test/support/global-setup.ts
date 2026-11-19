import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { migrateToLatest } from '../../src/db/migrate.js';
import {
  PUBLIC_TEST_PASSWORD,
  PUBLIC_TEST_ROLE,
  testDatabaseUrl,
} from './urls.js';

export default async function setup(): Promise<void> {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: testDatabaseUrl() }),
    }),
  });
  try {
    await sql`DROP SCHEMA public CASCADE`.execute(db);
    await sql`CREATE SCHEMA public`.execute(db);
    await migrateToLatest(db);
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${sql.raw(PUBLIC_TEST_ROLE)}') THEN
          CREATE ROLE ${sql.raw(PUBLIC_TEST_ROLE)} LOGIN PASSWORD '${sql.raw(PUBLIC_TEST_PASSWORD)}';
        END IF;
      END
      $$`.execute(db);
    await sql`GRANT raahi_public_read TO ${sql.id(PUBLIC_TEST_ROLE)}`.execute(
      db,
    );
    await sql`GRANT CONNECT ON DATABASE ${sql.id(new URL(testDatabaseUrl()).pathname.slice(1))} TO ${sql.id(PUBLIC_TEST_ROLE)}`.execute(
      db,
    );
  } finally {
    await db.destroy();
  }
}
