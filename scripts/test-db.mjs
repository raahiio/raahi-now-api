// Local PostgreSQL 16 for tests (no Docker needed). Run with `npm run db:test`.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = 5432;
const databaseDir = resolve(import.meta.dirname, '..', '.pgdata');

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

if (!existsSync(databaseDir)) {
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const name of ['raahi_now', 'raahi_now_test']) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();

console.log(`test db ready on ${PORT}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
