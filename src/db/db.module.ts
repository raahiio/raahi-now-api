import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { Schema } from './schema.js';
import { DB, PUBLIC_DB } from './tokens.js';

const logger = new Logger('DbModule');

function createDb(connectionString: string, name: string): Kysely<Schema> {
  const pool = new pg.Pool({ connectionString });
  // An idle client that loses its connection emits 'error' on the pool; unhandled, it kills the process.
  // Only the message is logged: the error object can carry connection details.
  pool.on('error', (err) => logger.error(`${name} pool error: ${err.message}`));
  return new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) });
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.DATABASE_URL, 'app'),
    },
    {
      provide: PUBLIC_DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.DATABASE_PUBLIC_URL, 'public'),
    },
  ],
  exports: [DB, PUBLIC_DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    @Inject(PUBLIC_DB) private readonly publicDb: Kysely<Schema>,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.db.destroy(), this.publicDb.destroy()]);
  }
}
