import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { Schema } from './schema.js';
import { DB, PUBLIC_DB } from './tokens.js';

function createDb(connectionString: string): Kysely<Schema> {
  return new Kysely<Schema>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.DATABASE_URL),
    },
    {
      provide: PUBLIC_DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.DATABASE_PUBLIC_URL),
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
