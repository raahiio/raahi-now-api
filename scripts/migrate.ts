// Compiled by tsc to dist-openapi/scripts with the openapi script. Runs every pending migration
// against DATABASE_URL (loaded from .env by `npm run db:migrate` when the file exists).
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { migrateToLatest } from '../src/db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env or export it.');
  process.exit(1);
}

const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url }) }) });
try {
  await migrateToLatest(db);
  console.log('Migrations are up to date.');
} finally {
  await db.destroy();
}
