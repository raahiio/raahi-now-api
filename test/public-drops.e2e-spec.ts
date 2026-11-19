import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { DropStatus, Schema } from '../src/db/schema.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { fakeToken } from './support/fake-verifier.js';
import { createLocal, createMedia, type TestLocal } from './support/fixtures.js';

const SECRET = 'SECRET-PLACE-123';
const hours = (h: number) => new Date(Date.now() + h * 3600_000);

describe('Public Drops (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let owner: TestLocal;
  let mediaId: string;
  const reviewer = { Authorization: fakeToken({ uid: 'rev1', roles: ['reviewer'] }) };

  beforeAll(async () => {
    db = getTestDb();
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
    await closeTestDbs();
  });
  beforeEach(async () => {
    await resetDb(db);
    owner = await createLocal(db, 'owner1');
    mediaId = await createMedia(db, owner.userId);
  });

  const insert = async (
    o: { status?: DropStatus; approvedAt?: Date; expiresAt?: Date; marketId?: string; title?: string; localId?: string } = {},
  ) => {
    const id = uuidv7();
    await db
      .insertInto('drops')
      .values({
        id,
        local_id: o.localId ?? owner.localId,
        market_id: o.marketId ?? 'new-york-city',
        title: o.title ?? 'Hand-pulled dumplings, still warm',
        why_now: 'The family makes one batch before noon.',
        perfect_for: 'Food lovers',
        cost_min_usd: 5,
        cost_max_usd: 12,
        time_minutes: 45,
        watch_out: 'Cash only.',
        photo_media_id: mediaId,
        fuzzy_area: 'Lower East Side',
        unlock_price_minor: 200,
        unlock_cap: 8,
        window_hours: 24,
        status: o.status ?? 'live',
        approved_at: o.approvedAt ?? new Date(),
        expires_at: o.expiresAt ?? hours(24),
      })
      .execute();
    await db.insertInto('drop_private').values({ drop_id: id, exact_place: SECRET, meet_detail: 'Ask at the counter' }).execute();
    return id;
  };

  it('lists only live, unexpired Drops, newest approval first', async () => {
    const older = await insert({ approvedAt: hours(-3) });
    const newer = await insert({ approvedAt: hours(-1) });
    await insert({ status: 'pending' });
    await insert({ status: 'paused' });
    const res = await t.http.get('/v1/drops').expect(200);
    expect(res.body.items.map((d: { id: string }) => d.id)).toEqual([newer, older]);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items[0]).toMatchObject({
      unlocksLeft: 8,
      unlockPriceCredits: 2,
      photo: { mediaId, isStandIn: false },
      market: { id: 'new-york-city', city: 'New York City', tz: 'America/New_York' },
      local: { id: owner.localId, displayName: 'Test Local', roleTitle: 'Cook', verified: true },
    });
  });

  it('a live Drop past expires_at is absent even though the sweeper has not run', async () => {
    const id = await insert({ approvedAt: hours(-30), expiresAt: hours(-6) });
    expect((await t.http.get('/v1/drops').expect(200)).body.items).toEqual([]);
    await t.http.get(`/v1/drops/${id}`).expect(404);
  });

  it('draft, pending, paused, gone, rejected and removed Drops are 404 publicly', async () => {
    for (const status of ['draft', 'pending', 'paused', 'gone', 'rejected', 'removed'] as const) {
      const id = await insert({ status });
      const res = await t.http.get(`/v1/drops/${id}`).expect(404);
      expect(res.body.code).toBe('not_found');
    }
  });

  it('a non-UUID id and an unknown id are 404', async () => {
    await t.http.get('/v1/drops/not-a-uuid').expect(404);
    await t.http.get(`/v1/drops/${uuidv7()}`).expect(404);
  });

  it('a live Drop is public and carries no private fields', async () => {
    const id = await insert();
    const res = await t.http.get(`/v1/drops/${id}`).expect(200);
    expect(res.body.id).toBe(id);
    expect(res.body.exactPlace).toBeUndefined();
  });

  it('the owner and a reviewer can read any status; another local gets 404', async () => {
    const id = await insert({ status: 'pending' });
    const other = await createLocal(db, 'other1');
    const own = await t.http.get(`/v1/drops/${id}`).set(owner.headers).expect(200);
    expect(own.body).toMatchObject({ id, status: 'pending', exactPlace: SECRET, meetDetail: 'Ask at the counter' });
    const rev = await t.http.get(`/v1/drops/${id}`).set(reviewer).expect(200);
    expect(rev.body).toMatchObject({ id, exactPlace: SECRET });
    await t.http.get(`/v1/drops/${id}`).set(other.headers).expect(404);
    // A non-owner on a live Drop gets the public view.
    const liveId = await insert();
    const view = await t.http.get(`/v1/drops/${liveId}`).set(other.headers).expect(200);
    expect(view.body.exactPlace).toBeUndefined();
  });

  it('filters by market; an unknown market is an empty list', async () => {
    const nyc = await insert();
    await insert({ marketId: 'boston' });
    const res = await t.http.get('/v1/drops?market=new-york-city').expect(200);
    expect(res.body.items.map((d: { id: string }) => d.id)).toEqual([nyc]);
    const none = await t.http.get('/v1/drops?market=atlantis').expect(200);
    expect(none.body).toEqual({ items: [], nextCursor: null });
  });

  it('pages with a cursor and returns nextCursor null at the end', async () => {
    const ids: string[] = [];
    for (let i = 5; i >= 1; i--) ids.push(await insert({ approvedAt: hours(-i) }));
    const expected = [...ids].reverse();
    const p1 = (await t.http.get('/v1/drops?limit=2').expect(200)).body;
    expect(p1.items.map((d: { id: string }) => d.id)).toEqual(expected.slice(0, 2));
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = (await t.http.get(`/v1/drops?limit=2&cursor=${p1.nextCursor}`).expect(200)).body;
    expect(p2.items.map((d: { id: string }) => d.id)).toEqual(expected.slice(2, 4));
    const p3 = (await t.http.get(`/v1/drops?limit=2&cursor=${p2.nextCursor}`).expect(200)).body;
    expect(p3.items.map((d: { id: string }) => d.id)).toEqual(expected.slice(4));
    expect(p3.nextCursor).toBeNull();
  });

  it('pages correctly across rows approved at the same instant', async () => {
    const at = hours(-1);
    const ids = [await insert({ approvedAt: at }), await insert({ approvedAt: at }), await insert({ approvedAt: at })];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const body: { items: { id: string }[]; nextCursor: string | null } = (
        await t.http.get(`/v1/drops?limit=1${cursor ? `&cursor=${cursor}` : ''}`).expect(200)
      ).body;
      seen.push(...body.items.map((d) => d.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(seen).toEqual([...ids].sort().reverse());
  });

  it('a tampered cursor is 422 cursor.invalid and limit 51 is 422 limit.range', async () => {
    const c = await t.http.get('/v1/drops?cursor=garbage').expect(422);
    expect(c.body).toMatchObject({ code: 'cursor.invalid', field: 'cursor', message: "That page link isn't valid." });
    const l = await t.http.get('/v1/drops?limit=51').expect(422);
    expect(l.body).toMatchObject({ code: 'limit.range', field: 'limit', message: 'Use a limit from 1 to 50.' });
    await t.http.get('/v1/drops?limit=0').expect(422);
    const impossible = Buffer.from(JSON.stringify({ t: '2026-02-30T00:00:00Z', id: uuidv7() })).toString('base64url');
    const d = await t.http.get(`/v1/drops?cursor=${impossible}`).expect(422);
    expect(d.body).toMatchObject({ code: 'cursor.invalid', field: 'cursor' });
  });

  it('anonymous responses are public-cacheable; authenticated ones are private, no-store', async () => {
    const id = await insert();
    for (const path of ['/v1/drops', `/v1/drops/${id}`]) {
      const anon = await t.http.get(path).expect(200);
      expect(anon.headers['cache-control']).toBe('public, max-age=15');
      expect(anon.headers['vary']).toMatch(/Authorization/);
      const authed = await t.http.get(path).set(owner.headers).expect(200);
      expect(authed.headers['cache-control']).toBe('private, no-store');
      expect(authed.headers['vary']).toMatch(/Authorization/);
    }
  });

  it('public JSON never contains the exact place text or the keys exactPlace and meetDetail', async () => {
    const id = await insert();
    const text = JSON.stringify((await t.http.get('/v1/drops').expect(200)).body) + JSON.stringify((await t.http.get(`/v1/drops/${id}`).expect(200)).body);
    expect(text).not.toMatch(/SECRET-PLACE-123|exactPlace|meetDetail|Ask at the counter/);
  });
});
