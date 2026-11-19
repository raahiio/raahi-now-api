import type { Kysely } from 'kysely';
import {
  Migrator,
  type Migration,
  type MigrationProvider,
} from 'kysely/migration';
import * as phase1 from './migrations/001_phase1.js';

class StaticMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ '001_phase1': phase1 });
  }
}

export async function migrateToLatest(db: Kysely<unknown>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(),
  });
  const { error, results } = await migrator.migrateToLatest();
  const failed = results?.find((r) => r.status === 'Error');
  if (error || failed) {
    throw new Error(
      `Migration failed${failed ? ` (${failed.migrationName})` : ''}: ${String(error)}`,
      {
        cause: error,
      },
    );
  }
}
