import { sql, type Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../src/db/schema.js';
import {
  closeTestDbs,
  getTestDb,
  getTestPublicDb,
  resetDb,
} from './support/db.js';

describe('Phase 1 schema (e2e)', () => {
  const db = getTestDb();
  const publicDb = getTestPublicDb();

  afterAll(closeTestDbs);
  beforeEach(() => resetDb(db));

  async function tableNames(d: Kysely<Schema>): Promise<string[]> {
    const { rows } = await sql<{
      tablename: string;
    }>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`.execute(d);
    return rows.map((r) => r.tablename);
  }

  async function seedLocal() {
    const userId = uuidv7();
    await db
      .insertInto('users')
      .values({
        id: userId,
        firebase_uid: `fb-${userId}`,
        email: `${userId}@x.test`,
        first_name: 'Ana',
        tz: 'America/New_York',
      })
      .execute();
    const localId = uuidv7();
    await db
      .insertInto('locals')
      .values({
        id: localId,
        user_id: userId,
        display_name: 'Ana',
        role_title: 'Chef',
        bio: 'Bio',
      })
      .execute();
    const mediaId = uuidv7();
    await db
      .insertInto('media')
      .values({
        id: mediaId,
        owner_user_id: userId,
        content_type: 'image/jpeg',
        s3_key: 'k',
        status: 'ready',
      })
      .execute();
    return { userId, localId, mediaId };
  }

  async function insertDrop(over: Record<string, unknown> = {}) {
    const { localId, mediaId } = await seedLocal();
    await db
      .insertInto('drops')
      .values({
        id: uuidv7(),
        local_id: localId,
        market_id: 'boston',
        title: 'A title',
        why_now: 'Because now',
        perfect_for: 'Everyone',
        cost_min_usd: 0,
        cost_max_usd: 10,
        time_minutes: 30,
        watch_out: 'Careful',
        photo_media_id: mediaId,
        fuzzy_area: 'North End',
        unlock_price_minor: 100,
        unlock_cap: 5,
        window_hours: 6,
        status: 'draft',
        ...over,
      })
      .execute();
  }

  async function insertEvent(
    o: { endsOffsetHours?: number; both?: boolean } = {},
  ) {
    const { userId } = await seedLocal();
    const guestId = uuidv7();
    if (o.both)
      await db
        .insertInto('guest_identities')
        .values({ id: guestId, email: 'g@x.test', claim_hash: uuidv7() })
        .execute();
    const starts = new Date('2030-01-01T10:00:00Z');
    await db
      .insertInto('events')
      .values({
        id: uuidv7(),
        owner_user_id: userId,
        guest_identity_id: o.both ? guestId : null,
        market_id: 'boston',
        name: 'Walk',
        category: 'walk',
        description: 'A description',
        starts_at: starts,
        ends_at: o.endsOffsetHours
          ? new Date(starts.getTime() + o.endsOffsetHours * 3_600_000)
          : null,
        area: 'Common',
        host_name: 'Ana',
        host_badge: 'verified_local',
        status: 'pending',
      })
      .execute();
  }

  it('creates every Phase 1 table', async () => {
    const names = await tableNames(db);
    expect(names).toEqual(
      expect.arrayContaining([
        'users',
        'locals',
        'markets',
        'media',
        'drops',
        'drop_private',
        'events',
        'event_private',
        'guest_identities',
        'review_items',
        'outbox',
        'rate_events',
        'audit_log',
      ]),
    );
  });

  it('seeds the five markets', async () => {
    const rows = await db
      .selectFrom('markets')
      .select(['id', 'tz', 'status'])
      .orderBy('id')
      .execute();
    expect(rows.map((r) => r.id)).toEqual([
      'boston',
      'ellsworth-acadia',
      'kyoto',
      'new-york-city',
      'sigiriya',
    ]);
    expect(rows.find((r) => r.id === 'sigiriya')).toMatchObject({
      tz: 'Asia/Colombo',
      status: 'preview',
    });
  });

  it('public role can read drops but not drop_private', async () => {
    await expect(
      publicDb.selectFrom('drops').select('title').execute(),
    ).resolves.toEqual([]);
    await expect(
      publicDb.selectFrom('drop_private').selectAll().execute(),
    ).rejects.toThrow(/permission denied/);
  });

  it('public role cannot read users, guest_identities, outbox or events.owner_user_id', async () => {
    for (const t of [
      'users',
      'guest_identities',
      'outbox',
      'review_items',
      'rate_events',
      'audit_log',
      'event_private',
    ]) {
      await expect(
        publicDb
          .selectFrom(t as keyof Schema)
          .selectAll()
          .execute(),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      publicDb.selectFrom('events').select('owner_user_id').execute(),
    ).rejects.toThrow(/permission denied/);
    await expect(
      publicDb.selectFrom('events').select('guest_identity_id').execute(),
    ).rejects.toThrow(/permission denied/);
    await expect(
      publicDb.selectFrom('events').select(['name', 'host_name']).execute(),
    ).resolves.toEqual([]);
  });

  it('rejects window_hours 5', async () => {
    await expect(insertDrop({ window_hours: 5 })).rejects.toThrow(/check/i);
  });
  it('rejects cost_max_usd below cost_min_usd', async () => {
    await expect(
      insertDrop({ cost_min_usd: 10, cost_max_usd: 5 }),
    ).rejects.toThrow(/check/i);
  });
  it('rejects time_minutes 20', async () => {
    await expect(insertDrop({ time_minutes: 20 })).rejects.toThrow(/check/i);
  });
  it('accepts a valid drop', async () => {
    await expect(insertDrop()).resolves.toBeUndefined();
  });
  it('rejects an event ending more than 24 hours after it starts', async () => {
    await expect(insertEvent({ endsOffsetHours: 25 })).rejects.toThrow(
      /check/i,
    );
  });
  it('accepts an event ending exactly 24 hours after it starts', async () => {
    await expect(insertEvent({ endsOffsetHours: 24 })).resolves.toBeUndefined();
  });
  it('rejects an event with both owner_user_id and guest_identity_id', async () => {
    await expect(insertEvent({ both: true })).rejects.toThrow(/check/i);
  });

  it('allows only one pending review row per item', async () => {
    const refId = uuidv7();
    const row = () => ({ id: uuidv7(), kind: 'drop' as const, ref_id: refId });
    await db.insertInto('review_items').values(row()).execute();
    await expect(
      db.insertInto('review_items').values(row()).execute(),
    ).rejects.toThrow(/duplicate key|unique/i);
    await db
      .updateTable('review_items')
      .set({ state: 'approved' })
      .where('ref_id', '=', refId)
      .execute();
    await expect(
      db.insertInto('review_items').values(row()).execute(),
    ).resolves.toBeDefined();
  });

  it('migrateToLatest is idempotent', async () => {
    const { migrateToLatest } = await import('../src/db/migrate.js');
    await expect(
      migrateToLatest(db as Kysely<unknown>),
    ).resolves.toBeUndefined();
  });
});
