import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { EventStatus, Schema } from '../src/db/schema.js';
import { hashClaimCode } from '../src/guests/claim-codes.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { fakeToken } from './support/fake-verifier.js';
import { createLocal, createMedia, type TestLocal } from './support/fixtures.js';

const NOW = new Date('2026-11-14T12:00:00Z');
const SECRET = 'SECRET-ADDR-456';
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * 3_600_000);
const mins = (m: number) => m * 60_000;

describe('Public events (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let host: TestLocal;
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
    t.clock.set(NOW);
    host = await createLocal(db, 'host1');
  });

  interface Opts {
    status?: EventStatus;
    startsAt?: Date;
    endsAt?: Date | null;
    marketId?: string;
    category?: 'tasting' | 'walk' | 'market' | 'class' | 'gathering';
    visibility?: 'public' | 'after_rsvp' | null;
    capacity?: number | null;
    name?: string;
    id?: string;
    photo?: string | null;
    guest?: { claimCode: string };
    owner?: boolean;
  }
  const insert = async (o: Opts = {}) => {
    const id = o.id ?? uuidv7();
    let guestIdentityId: string | null = null;
    if (o.guest) {
      guestIdentityId = uuidv7();
      await db
        .insertInto('guest_identities')
        .values({
          id: guestIdentityId,
          email: 'guest@example.com',
          claim_hash: hashClaimCode(o.guest.claimCode, t.env.CLAIM_CODE_SECRET),
        })
        .execute();
    }
    const visibility = o.visibility === undefined ? 'after_rsvp' : o.visibility;
    await db
      .insertInto('events')
      .values({
        id,
        owner_user_id: o.guest ? null : host.userId,
        guest_identity_id: guestIdentityId,
        market_id: o.marketId ?? 'boston',
        name: o.name ?? 'Saturday dumpling walk',
        category: o.category ?? 'walk',
        description: 'A relaxed walk through the neighborhood, tasting as we go.',
        starts_at: o.startsAt ?? at(24),
        ends_at: o.endsAt === undefined ? null : o.endsAt,
        area: 'Chinatown',
        address_visibility: visibility,
        capacity: o.capacity ?? null,
        photo_media_id: o.photo ?? null,
        host_name: o.guest ? 'Guest Host' : 'Test Local',
        host_badge: o.guest ? 'community_host' : 'verified_local',
        status: o.status ?? 'upcoming',
      })
      .execute();
    if (visibility !== null) await db.insertInto('event_private').values({ event_id: id, exact_address: SECRET }).execute();
    return id;
  };
  const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

  it('lists only upcoming events whose end (or start) plus 3 hours is in the future', async () => {
    const endedRecently = await insert({ startsAt: at(-5), endsAt: new Date(NOW.getTime() - mins(179)) });
    await insert({ startsAt: at(-6), endsAt: new Date(NOW.getTime() - mins(181)) });
    const startedRecently = await insert({ startsAt: new Date(NOW.getTime() - mins(179)) });
    await insert({ startsAt: new Date(NOW.getTime() - mins(181)) });
    const res = await t.http.get('/v1/events').expect(200);
    expect(ids(res.body).sort()).toEqual([endedRecently, startedRecently].sort());
  });

  it('sorts by start then id and pages with a cursor', async () => {
    const same = at(48);
    const a = await insert({ startsAt: same, id: '0192a000-0000-7000-8000-00000000000a' });
    const b = await insert({ startsAt: same, id: '0192a000-0000-7000-8000-00000000000b' });
    const early = await insert({ startsAt: at(2) });
    const late = await insert({ startsAt: at(72) });
    const all = (await t.http.get('/v1/events').expect(200)).body;
    expect(ids(all)).toEqual([early, a, b, late]);
    expect(all.nextCursor).toBeNull();

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const body = (await t.http.get(`/v1/events?limit=1${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body;
      seen.push(...ids(body));
      cursor = body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([early, a, b, late]);
  });

  it('filters by category and market; an unknown market is an empty list', async () => {
    const walk = await insert({ category: 'walk' });
    const tasting = await insert({ category: 'tasting' });
    const nyc = await insert({ marketId: 'new-york-city' });
    expect(ids((await t.http.get('/v1/events?category=tasting').expect(200)).body)).toEqual([tasting]);
    expect(ids((await t.http.get('/v1/events?market=boston').expect(200)).body).sort()).toEqual([walk, tasting].sort());
    expect(ids((await t.http.get('/v1/events?market=new-york-city').expect(200)).body)).toEqual([nyc]);
    expect((await t.http.get('/v1/events?market=nowhere').expect(200)).body.items).toEqual([]);
    expect((await t.http.get('/v1/events?market=nowhere&from=2026-11-14').expect(200)).body.items).toEqual([]);
    const bad = await t.http.get('/v1/events?category=party').expect(422);
    expect(bad.body).toMatchObject({ code: 'category.invalid', field: 'category' });
  });

  it('from/to are dates in the market zone: a Sigiriya (Colombo zone) event at 23:30 local on 14 Nov shows for from=to=2026-11-14 and not for 2026-11-15', async () => {
    // 23:30 at +05:30 is 18:00Z, still 14 Nov in UTC; 00:30 local on 15 Nov is 19:00Z on 14 Nov UTC.
    const late = await insert({ marketId: 'sigiriya', startsAt: new Date('2026-11-14T18:00:00Z') });
    const after = await insert({ marketId: 'sigiriya', startsAt: new Date('2026-11-14T19:00:00Z') });
    const day = (d: string) => t.http.get(`/v1/events?market=sigiriya&from=${d}&to=${d}`).expect(200);
    expect(ids((await day('2026-11-14')).body)).toEqual([late]);
    expect(ids((await day('2026-11-15')).body)).toEqual([after]);
    expect(ids((await t.http.get('/v1/events?market=sigiriya&from=2026-11-15').expect(200)).body)).toEqual([after]);
    expect(ids((await t.http.get('/v1/events?market=sigiriya&to=2026-11-14').expect(200)).body)).toEqual([late]);
  });

  it('from or to without market is 422 market.required; a bad date is from.invalid / to.invalid', async () => {
    expect((await t.http.get('/v1/events?from=2026-11-14').expect(422)).body).toMatchObject({ code: 'market.required', field: 'market' });
    expect((await t.http.get('/v1/events?to=2026-11-14').expect(422)).body).toMatchObject({ code: 'market.required', field: 'market' });
    expect((await t.http.get('/v1/events?market=boston&from=2026-13-01').expect(422)).body).toMatchObject({ code: 'from.invalid', field: 'from' });
    expect((await t.http.get('/v1/events?market=boston&to=14-11-2026').expect(422)).body).toMatchObject({ code: 'to.invalid', field: 'to' });
    expect((await t.http.get('/v1/events?market=boston&from=2026-02-30').expect(422)).body.code).toBe('from.invalid');
  });

  it('a day whose midnight does not exist in the market zone starts at its first valid instant', async () => {
    // Santiago springs forward at 24:00 on Sat 2026-09-05 (-04 -> -03): 00:00 on 6 Sep does not exist.
    await db.updateTable('markets').set({ tz: 'America/Santiago' }).where('id', '=', 'boston').execute();
    try {
      const first = await insert({ startsAt: new Date('2026-09-06T04:00:00Z') }); // 01:00 local, first valid hour
      const before = await insert({ startsAt: new Date('2026-09-06T03:59:00Z') }); // 23:59 on 5 Sep local
      t.clock.set('2026-09-05T00:00:00Z');
      const res = await t.http.get('/v1/events?market=boston&from=2026-09-06&to=2026-09-06').expect(200);
      expect(ids(res.body)).toEqual([first]);
      expect(ids((await t.http.get('/v1/events?market=boston&to=2026-09-05').expect(200)).body)).toEqual([before]);
    } finally {
      await db.updateTable('markets').set({ tz: 'America/New_York' }).where('id', '=', 'boston').execute();
    }
  });

  it('spotsLeft equals capacity, or null without capacity; photo and host are mapped', async () => {
    const media = await createMedia(db, host.userId);
    const withCap = await insert({ capacity: 12, photo: media, startsAt: at(2) });
    await insert({ startsAt: at(3) });
    const items = (await t.http.get('/v1/events').expect(200)).body.items;
    expect(items[0]).toMatchObject({
      id: withCap,
      spotsLeft: 12,
      photo: { mediaId: media },
      host: { name: 'Test Local', badge: 'verified_local' },
      market: { id: 'boston', city: 'Boston', tz: 'America/New_York' },
    });
    expect(items[1]).toMatchObject({ spotsLeft: null, photo: null });
  });

  it('exactAddress shows when visibility is public, and not for after_rsvp, for the public', async () => {
    const open = await insert({ visibility: 'public', startsAt: at(2) });
    const rsvp = await insert({ visibility: 'after_rsvp', startsAt: at(3) });
    const none = await insert({ visibility: null, startsAt: at(4) });
    const list = (await t.http.get('/v1/events').expect(200)).body.items as Record<string, unknown>[];
    expect(list.find((i) => i.id === open)).toMatchObject({ exactAddress: SECRET });
    expect(list.find((i) => i.id === rsvp)).not.toHaveProperty('exactAddress');
    expect(list.find((i) => i.id === none)).not.toHaveProperty('exactAddress');
    expect((await t.http.get(`/v1/events/${open}`).expect(200)).body.exactAddress).toBe(SECRET);
    const hidden = (await t.http.get(`/v1/events/${rsvp}`).expect(200)).body;
    expect(hidden).not.toHaveProperty('exactAddress');
    expect(JSON.stringify(hidden)).not.toContain(SECRET);
  });

  it('pending, rejected, removed, cancelled and past events are 404 publicly; the owner (account or claim code) and reviewers can read them', async () => {
    const stranger = await createLocal(db, 'stranger');
    const statuses = ['pending', 'rejected', 'removed', 'cancelled', 'past'] as const;
    for (const [i, status] of statuses.entries()) {
      const claimCode = `ABCDEFGH234${i}`;
      const id = await insert({ status });
      const guestId = await insert({ status, guest: { claimCode } });
      for (const target of [id, guestId]) {
        const res = await t.http.get(`/v1/events/${target}`).expect(404);
        expect(res.body).toMatchObject({ code: 'not_found' });
        await t.http.get(`/v1/events/${target}`).set(stranger.headers).expect(404);
      }
      const own = await t.http.get(`/v1/events/${id}`).set(host.headers).expect(200);
      expect(own.body).toMatchObject({ id, status, exactAddress: SECRET, addressVisibility: 'after_rsvp' });
      const viaCode = await t.http.get(`/v1/events/${guestId}`).set('X-Claim-Code', claimCode).expect(200);
      expect(viaCode.body).toMatchObject({ id: guestId, status, exactAddress: SECRET });
      await t.http.get(`/v1/events/${guestId}`).set(reviewer).expect(200);
      await t.http.get(`/v1/events/${id}`).set(reviewer).expect(200);
    }
    await t.http.get('/v1/events/not-a-uuid').expect(404);
    await t.http.get(`/v1/events/${uuidv7()}`).expect(404);
    await t.http.get(`/v1/events/${uuidv7()}`).set(reviewer).expect(404);
  });

  it('a wrong claim code is anonymous on a GET: public view for a live event, 404 otherwise, and no failure is recorded', async () => {
    const claimCode = 'ABCDEFGH2345';
    const pending = await insert({ status: 'pending', guest: { claimCode } });
    const live = await insert({ guest: { claimCode: 'JKMNPQRS2345' }, visibility: 'public' });
    for (let i = 0; i < 6; i++) await t.http.get(`/v1/events/${pending}`).set('X-Claim-Code', 'ZZZZZZZZZZZZ').expect(404);
    const pub = await t.http.get(`/v1/events/${live}`).set('X-Claim-Code', 'ZZZZZZZZZZZZ').expect(200);
    expect(pub.body).not.toHaveProperty('status');
    expect(await db.selectFrom('rate_events').selectAll().execute()).toEqual([]);
    // Not locked out of the real code either.
    await t.http.get(`/v1/events/${pending}`).set('X-Claim-Code', claimCode).expect(200);
  });

  it('a manage token opens the guest owner view; a claim code for another event does not', async () => {
    const claimCode = 'ABCDEFGH2345';
    const mine = await insert({ status: 'pending', guest: { claimCode } });
    const other = await insert({ status: 'pending', guest: { claimCode: 'JKMNPQRS2345' } });
    const { manageToken } = (await t.http.post('/v1/claims/exchange').send({ code: claimCode }).expect(200)).body;
    await t.http.get(`/v1/events/${mine}`).set('Authorization', `Manage ${manageToken}`).expect(200);
    await t.http.get(`/v1/events/${other}`).set('Authorization', `Manage ${manageToken}`).expect(404);
    await t.http.get(`/v1/events/${other}`).set('X-Claim-Code', claimCode).expect(404);
  });

  it('public JSON never contains hostEmail, claim codes, guest identity ids or after_rsvp addresses', async () => {
    const claimCode = 'ABCDEFGH2345';
    const guestEvent = await insert({ guest: { claimCode } });
    const account = await insert();
    const list = await t.http.get('/v1/events').expect(200);
    const details = [await t.http.get(`/v1/events/${guestEvent}`).expect(200), await t.http.get(`/v1/events/${account}`).expect(200)];
    const text = JSON.stringify(list.body) + details.map((d) => JSON.stringify(d.body)).join('');
    expect(text).not.toMatch(/guest@example\.com|claim|SECRET-ADDR-456|owner_user_id|guest_identity|hostEmail/i);
    expect(text).not.toContain(claimCode);
  });

  it('a tampered cursor is 422 cursor.invalid and limit 51 is 422 limit.range', async () => {
    expect((await t.http.get('/v1/events?cursor=garbage').expect(422)).body).toMatchObject({ code: 'cursor.invalid', field: 'cursor' });
    expect((await t.http.get('/v1/events?limit=51').expect(422)).body.code).toBe('limit.range');
  });

  it('anonymous responses are public, max-age=15 with Vary: Authorization; authenticated ones are private, no-store', async () => {
    const id = await insert();
    for (const path of ['/v1/events', `/v1/events/${id}`]) {
      const anon = await t.http.get(path).expect(200);
      expect(anon.headers['cache-control']).toBe('public, max-age=15');
      expect(anon.headers.vary).toMatch(/Authorization/);
      const authed = await t.http.get(path).set(host.headers).expect(200);
      expect(authed.headers['cache-control']).toBe('private, no-store');
      expect(authed.headers.vary).toMatch(/Authorization/);
    }
  });

  it('a request carrying a claim code is never publicly cacheable', async () => {
    const id = await insert({ guest: { claimCode: 'ABCDEFGH2345' } });
    const res = await t.http.get(`/v1/events/${id}`).set('X-Claim-Code', 'ABCDEFGH2345').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('the visibility cutoff follows the injected clock, not the database clock', async () => {
    const id = await insert({ startsAt: at(1) });
    expect(ids((await t.http.get('/v1/events').expect(200)).body)).toEqual([id]);
    t.clock.set(at(1 + 3 + 0.01));
    expect((await t.http.get('/v1/events').expect(200)).body.items).toEqual([]);
    await t.http.get(`/v1/events/${id}`).expect(404);
  });
});
