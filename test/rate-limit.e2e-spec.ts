import { sql, type Kysely } from 'kysely';
import { AppError } from '../src/common/errors/app-error.js';
import { RateLimiter } from '../src/common/rate-limit.js';
import type { Schema } from '../src/db/schema.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';

describe('RateLimiter (e2e)', () => {
  let db: Kysely<Schema>;
  let limiter: RateLimiter;

  beforeAll(() => {
    db = getTestDb();
    limiter = new RateLimiter(db);
  });
  afterAll(closeTestDbs);
  beforeEach(() => resetDb(db));

  it('allows `limit` hits then throws rate_limited', async () => {
    for (let i = 0; i < 3; i++) await limiter.hit('k', 'a', 3, 3600);
    await expect(limiter.hit('k', 'a', 3, 3600)).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    await expect(limiter.hit('k', 'a', 3, 3600)).rejects.toBeInstanceOf(AppError);
  });

  it('does not record refused hits', async () => {
    for (let i = 0; i < 3; i++) await limiter.hit('k', 'a', 3, 3600);
    await limiter.hit('k', 'a', 3, 3600).catch(() => undefined);
    const { count } = await db.selectFrom('rate_events').select(sql<string>`count(*)`.as('count')).executeTakeFirstOrThrow();
    expect(Number(count)).toBe(3);
  });

  it('keys and kinds are independent', async () => {
    await limiter.hit('k', 'a', 1, 3600);
    await limiter.hit('k', 'b', 1, 3600);
    await limiter.hit('other', 'a', 1, 3600);
  });

  it('events older than the window do not count', async () => {
    await limiter.hit('k', 'a', 1, 3600);
    await sql`UPDATE rate_events SET created_at = now() - interval '2 hours'`.execute(db);
    await limiter.hit('k', 'a', 1, 3600);
  });
});
