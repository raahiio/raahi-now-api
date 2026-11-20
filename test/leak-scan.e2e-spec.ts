import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../src/db/schema.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { fakeToken } from './support/fake-verifier.js';
import { createLocal, createMedia, insertEvent } from './support/fixtures.js';

// `"review"` is matched as a JSON key: a bare `review` would hit the market status "preview".
const LEAK =
  /SECRET-PLACE-123|SECRET-MEET-789|SECRET-ADDR-456|guest@example\.com|claimCode|claim_hash|exactPlace|meetDetail|hostEmail|"review"/;

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('Leak scan (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let leak: RegExp;
  let upcomingId: string;
  let guestUpcomingId: string;
  const publicPaths: string[] = [];
  const listPaths = { drops: '/v1/drops', events: '/v1/events', dropsMarket: '/v1/drops?market=new-york-city', eventsMarket: '/v1/events?market=new-york-city' };
  const travelerAuth = { Authorization: fakeToken({ uid: 'traveler1' }) };

  beforeAll(async () => {
    db = getTestDb();
    t = await createTestApp();
    await resetDb(db);

    const owner = await createLocal(db, 'owner1');
    const mediaId = await createMedia(db, owner.userId);
    const dropId = uuidv7();
    await db
      .insertInto('drops')
      .values({
        id: dropId,
        local_id: owner.localId,
        market_id: 'new-york-city',
        title: 'Hand-pulled dumplings, still warm',
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
        status: 'live',
        approved_at: new Date(),
        expires_at: new Date(Date.now() + 24 * 3_600_000),
      })
      .execute();
    await db
      .insertInto('drop_private')
      .values({ drop_id: dropId, exact_place: 'SECRET-PLACE-123', meet_detail: 'SECRET-MEET-789' })
      .execute();

    const upcoming = await insertEvent(db, {
      status: 'upcoming',
      ownerUserId: owner.userId,
      exactAddress: 'SECRET-ADDR-456',
    });

    // A guest event created through the API: the response carries the claim code, nothing else may.
    const guest = await t.http
      .post('/v1/events')
      .set('X-Device-Id', 'leak-device')
      .send({
        name: 'Guest dumpling walk',
        category: 'walk',
        marketId: 'boston',
        description: 'A relaxed walk through the neighborhood, tasting as we go.',
        startsLocal: new Date(Date.now() + 5 * 24 * 3_600_000).toISOString().slice(0, 16),
        area: 'Chinatown',
        hostName: 'Guest Host',
        hostEmail: 'guest@example.com',
      })
      .expect(201);
    expect(guest.body.claimCode).toBeTruthy();
    // An approved guest event, so a row with guest data is on the public side too.
    const guestUpcoming = await insertEvent(db, { status: 'upcoming', guestEmail: 'guest@example.com' });
    upcomingId = upcoming;
    guestUpcomingId = guestUpcoming;

    // Decided review rows, so a `review` key would show up if a public view carried it.
    const decided = new Date();
    await db
      .insertInto('review_items')
      .values(
        [
          { kind: 'drop' as const, ref_id: dropId },
          { kind: 'event' as const, ref_id: upcoming },
          { kind: 'event' as const, ref_id: guestUpcoming },
        ].map((r) => ({ ...r, id: uuidv7(), state: 'approved' as const, submitted_at: decided, decided_at: decided })),
      )
      .execute();

    // The actual secret values: the claim code just issued and every stored claim hash.
    const hashes = (await db.selectFrom('guest_identities').select('claim_hash').execute()).map((r) => r.claim_hash);
    expect(hashes.length).toBeGreaterThanOrEqual(2);
    leak = new RegExp(`${LEAK.source}|${[guest.body.claimCode as string, ...hashes].map(escape).join('|')}`);

    publicPaths.push(
      '/v1/health',
      '/v1/markets',
      listPaths.drops,
      listPaths.dropsMarket,
      `/v1/drops/${dropId}`,
      listPaths.events,
      listPaths.eventsMarket,
      '/v1/events?market=boston',
      `/v1/events/${upcoming}`,
      `/v1/events/${guestUpcoming}`,
    );
  });
  afterAll(async () => {
    await t.app.close();
    await closeTestDbs();
  });

  it('no public route returns a private value or key, anonymous or signed in', async () => {
    for (const path of publicPaths) {
      for (const headers of [{}, travelerAuth]) {
        const res = await t.http.get(path).set(headers).expect(200);
        const text = JSON.stringify(res.body);
        expect(text, `${path} ${JSON.stringify(headers)}`).not.toMatch(leak);
      }
    }
  });

  it('the scan is not vacuous: the lists carry the seeded rows', async () => {
    const ids = async (path: string) =>
      ((await t.http.get(path).expect(200)).body.items as { id: string }[]).map((i) => i.id);
    expect(await ids(listPaths.drops)).toHaveLength(1);
    expect(await ids(listPaths.dropsMarket)).toHaveLength(1);
    expect(await ids(listPaths.events)).toEqual(expect.arrayContaining([upcomingId, guestUpcomingId]));
    expect((await ids(listPaths.eventsMarket)).length).toBeGreaterThan(0);
    for (const id of [upcomingId, guestUpcomingId]) {
      expect((await t.http.get(`/v1/events/${id}`).expect(200)).body.id).toBe(id);
    }
  });
});
