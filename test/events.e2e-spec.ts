import type { Kysely } from 'kysely';
import type { Schema } from '../src/db/schema.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { createLocal, createMedia, insertEvent, type TestLocal } from './support/fixtures.js';
import { fakeToken } from './support/fake-verifier.js';
import { uuidv7 } from 'uuidv7';

const NOW = '2026-11-19T12:00:00Z';

describe('Events, account host (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let me: TestLocal;

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
    me = await createLocal(db, 'host1');
  });

  const validEvent = (overrides: Record<string, unknown> = {}) => ({
    name: 'Saturday dumpling walk',
    category: 'walk',
    marketId: 'boston',
    description: 'A relaxed walk through the neighborhood, tasting as we go.',
    startsLocal: '2026-11-21T14:00',
    area: 'Chinatown',
    ...overrides,
  });
  const post = (overrides: Record<string, unknown> = {}, who: { headers: { Authorization: string } } = me) =>
    t.http.post('/v1/events').set(who.headers).send(validEvent(overrides));
  const firstError = (res: { body: { errors?: { code: string; field: string; message: string }[] } }) => res.body.errors?.[0];

  /** A plain account (no local profile). */
  const createPlain = async (uid: string) => {
    const userId = uuidv7();
    await db
      .insertInto('users')
      .values({ id: userId, firebase_uid: uid, email: `${uid}@example.com`, first_name: 'Plain', tz: 'America/New_York' })
      .execute();
    return { userId, headers: { Authorization: fakeToken({ uid }) } };
  };

  it('a first-time host creates a pending event, a review item and an event.submitted outbox row', async () => {
    const res = await post().expect(201);
    expect(res.body).toMatchObject({
      status: 'pending',
      market: { id: 'boston', city: 'Boston', tz: 'America/New_York' },
      host: { name: 'Test Local', badge: 'verified_local' },
      photo: null,
      exactAddress: null,
    });
    const review = await db.selectFrom('review_items').selectAll().where('ref_id', '=', res.body.id).execute();
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ kind: 'event', state: 'pending' });
    const outbox = await db.selectFrom('outbox').select('type').where('subject_id', '=', res.body.id).execute();
    expect(outbox.map((o) => o.type)).toEqual(['event.submitted']);
  });

  it('a host with an approved earlier event creates an upcoming event and an event.approved outbox row', async () => {
    await insertEvent(db, { ownerUserId: me.userId, status: 'upcoming', name: 'Earlier event' });
    const res = await post().expect(201);
    expect(res.body.status).toBe('upcoming');
    expect(await db.selectFrom('review_items').selectAll().where('ref_id', '=', res.body.id).execute()).toHaveLength(0);
    const outbox = await db.selectFrom('outbox').select('type').where('subject_id', '=', res.body.id).execute();
    expect(outbox.map((o) => o.type)).toEqual(['event.approved']);
  });

  it('a plain account hosts as community_host under its first name', async () => {
    const plain = await createPlain('plain1');
    const res = await post({}, plain).expect(201);
    expect(res.body.host).toEqual({ name: 'Plain', badge: 'community_host' });
  });

  it('resolves startsLocal in the market zone (Boston 14:00 → 19:00Z in November)', async () => {
    const res = await post({ endsLocal: '2026-11-21T16:30' }).expect(201);
    expect(res.body.startsAt).toBe('2026-11-21T19:00:00.000Z');
    expect(res.body.startsAtLocal).toBe('2026-11-21T14:00:00-05:00');
    expect(res.body.endsAt).toBe('2026-11-21T21:30:00.000Z');
    expect(res.body.endsAtLocal).toBe('2026-11-21T16:30:00-05:00');
  });

  it('Sigiriya 23:30 local is stored as 18:00Z (UTC+5:30)', async () => {
    const res = await post({ marketId: 'sigiriya', startsLocal: '2026-11-21T23:30' }).expect(201);
    expect(res.body.startsAt).toBe('2026-11-21T18:00:00.000Z');
  });

  it('a start in the spring-forward gap is 422 start.nonexistent_time', async () => {
    t.clock.set('2027-03-01T12:00:00Z');
    const res = await post({ startsLocal: '2027-03-14T02:30' }).expect(422);
    expect(firstError(res)).toMatchObject({ code: 'start.nonexistent_time', field: 'startsLocal' });
  });

  it('a start in the fall-back repeat is 422 start.ambiguous_time', async () => {
    t.clock.set('2027-10-20T12:00:00Z');
    const res = await post({ startsLocal: '2027-11-07T01:30' }).expect(422);
    expect(firstError(res)).toMatchObject({ code: 'start.ambiguous_time', field: 'startsLocal' });
  });

  it('a malformed startsLocal is 422 startsLocal.invalid', async () => {
    const res = await post({ startsLocal: '2026-11-21 14:00' }).expect(422);
    expect(firstError(res)).toMatchObject({ code: 'startsLocal.invalid', field: 'startsLocal' });
  });

  it('a start 10 minutes ahead is 422 start.too_soon with the spec message', async () => {
    // 12:10Z is 07:10 in Boston.
    const res = await post({ startsLocal: '2026-11-19T07:10' }).expect(422);
    expect(firstError(res)).toEqual({
      code: 'start.too_soon',
      field: 'startsLocal',
      message: 'Pick a start at least 30 minutes from now.',
    });
  });

  it('an end before the start is 422 end.before_start on endsLocal', async () => {
    const res = await post({ endsLocal: '2026-11-21T13:00' }).expect(422);
    expect(firstError(res)).toMatchObject({ code: 'end.before_start', field: 'endsLocal' });
  });

  it('an address without addressVisibility is 422 addressVisibility.required', async () => {
    const res = await post({ exactAddress: '14 Eldridge Street' }).expect(422);
    expect(firstError(res)).toMatchObject({ code: 'addressVisibility.required', field: 'addressVisibility' });
  });

  it('an addressVisibility without an address is 422 exactAddress.required', async () => {
    const res = await post({ addressVisibility: 'public' }).expect(422);
    expect(firstError(res)).toMatchObject({ code: 'exactAddress.required', field: 'exactAddress' });
  });

  it('capacity 0 and 501 are 422 capacity.range; 1 and 500 pass', async () => {
    for (const capacity of [0, 501]) {
      const res = await post({ capacity }).expect(422);
      expect(firstError(res)).toMatchObject({ code: 'capacity.range', field: 'capacity' });
    }
    await post({ capacity: 1 }).expect(201);
    await post({ capacity: 500, name: 'Another walk entirely' }).expect(201);
  });

  it('a description of 19 characters is 422 description.too_short', async () => {
    const res = await post({ description: 'a'.repeat(19) }).expect(422);
    expect(firstError(res)).toMatchObject({ code: 'description.too_short', field: 'description' });
  });

  it('https://bit.ly/menu is 422 link.shortened; http://example.com is 422 link.not_https', async () => {
    expect(firstError(await post({ link: 'https://bit.ly/menu' }).expect(422))).toMatchObject({ code: 'link.shortened', field: 'link' });
    expect(firstError(await post({ link: 'http://example.com' }).expect(422))).toMatchObject({ code: 'link.not_https', field: 'link' });
    expect((await post({ link: 'https://example.com/menu' }).expect(201)).body.link).toBe('https://example.com/menu');
  });

  it('an unknown market and a photo that is not ready are reported together', async () => {
    const pending = await createMedia(db, me.userId, 'pending');
    const res = await post({ marketId: 'atlantis', photoMediaId: pending }).expect(422);
    expect(res.body.errors.map((e: { code: string }) => e.code).sort()).toEqual(['market.invalid', 'photo.not_ready']);
  });

  it('accepts a ready photo of the caller and returns it as photo.mediaId', async () => {
    const mediaId = await createMedia(db, me.userId);
    const res = await post({ photoMediaId: mediaId }).expect(201);
    expect(res.body.photo).toEqual({ mediaId });
  });

  it('a duplicate (same host, name, market, start within one hour) is 409 event.duplicate', async () => {
    await post().expect(201);
    const dup = await post({ name: 'SATURDAY DUMPLING WALK', startsLocal: '2026-11-21T14:59' }).expect(409);
    expect(dup.body.code).toBe('event.duplicate');
    // Exactly one hour apart is not a duplicate.
    await post({ startsLocal: '2026-11-21T15:00' }).expect(201);
    // A different host is not a duplicate.
    const other = await createLocal(db, 'host2');
    await post({}, other).expect(201);
  });

  it('two concurrent identical creates yield one event and one 409', async () => {
    const results = await Promise.all([post(), post()]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
  });

  it('a cancelled event does not block a duplicate', async () => {
    const first = await post().expect(201);
    await t.http.post(`/v1/events/${first.body.id}/cancel`).set(me.headers).expect(200);
    await post().expect(201);
  });

  it('the exact address is stored in event_private and host_name/host_badge on the event', async () => {
    const res = await post({ exactAddress: '14 Eldridge Street', addressVisibility: 'after_rsvp' }).expect(201);
    expect(res.body).toMatchObject({ exactAddress: '14 Eldridge Street', addressVisibility: 'after_rsvp' });
    const priv = await db.selectFrom('event_private').selectAll().where('event_id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(priv.exact_address).toBe('14 Eldridge Street');
    const row = await db.selectFrom('events').selectAll().where('id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ host_name: 'Test Local', host_badge: 'verified_local', owner_user_id: me.userId });
  });

  it('requires a signed-in user, except that an anonymous post takes the guest path (422 device.required)', async () => {
    const anon = await t.http.post('/v1/events').send(validEvent()).expect(422);
    expect(anon.body.code).toBe('device.required');
    await t.http.get('/v1/me/events').expect(401);
  });

  describe('editing and cancelling', () => {
    it('PATCH edits a pending event, re-resolves times and keeps the status', async () => {
      const created = await post().expect(201);
      const res = await t.http
        .patch(`/v1/events/${created.body.id}`)
        .set(me.headers)
        .send({ name: 'Sunday dumpling walk', startsLocal: '2026-11-22T10:00', exactAddress: '1 Beach Street', addressVisibility: 'public' })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Sunday dumpling walk',
        status: 'pending',
        startsAt: '2026-11-22T15:00:00.000Z',
        exactAddress: '1 Beach Street',
        addressVisibility: 'public',
      });
    });

    it('PATCH keeping an old end that falls before the new start is 422 end.before_start', async () => {
      const created = await post({ endsLocal: '2026-11-21T16:00' }).expect(201);
      const res = await t.http
        .patch(`/v1/events/${created.body.id}`)
        .set(me.headers)
        .send({ startsLocal: '2026-11-22T10:00' })
        .expect(422);
      expect(firstError(res)).toMatchObject({ code: 'end.before_start', field: 'endsLocal' });
    });

    it('PATCH can clear optional fields with null', async () => {
      const created = await post({ endsLocal: '2026-11-21T16:00', exactAddress: '1 Beach Street', addressVisibility: 'public', capacity: 8 }).expect(201);
      const res = await t.http
        .patch(`/v1/events/${created.body.id}`)
        .set(me.headers)
        .send({ endsLocal: null, exactAddress: null, addressVisibility: null, capacity: null })
        .expect(200);
      expect(res.body).toMatchObject({ endsAt: null, endsAtLocal: null, exactAddress: null, addressVisibility: null, capacity: null });
      expect(await db.selectFrom('event_private').selectAll().where('event_id', '=', created.body.id).execute()).toHaveLength(0);
    });

    it('PATCH into a duplicate of another own event is 409, but not of itself', async () => {
      await post().expect(201);
      const other = await post({ name: 'Another walk entirely' }).expect(201);
      await t.http.patch(`/v1/events/${other.body.id}`).set(me.headers).send({ name: 'saturday dumpling walk' }).expect(409);
      await t.http.patch(`/v1/events/${other.body.id}`).set(me.headers).send({ area: 'North End' }).expect(200);
    });

    it('editing a past or cancelled event is 409 event.not_editable; cancel sets cancelled', async () => {
      const created = await post().expect(201);
      for (const status of ['past', 'cancelled', 'rejected', 'removed'] as const) {
        const id = await insertEvent(db, { ownerUserId: me.userId, status, name: `Event ${status}` });
        const res = await t.http.patch(`/v1/events/${id}`).set(me.headers).send({ area: 'North End' }).expect(409);
        expect(res.body.code).toBe('event.not_editable');
        expect((await t.http.post(`/v1/events/${id}/cancel`).set(me.headers).expect(409)).body.code).toBe('event.not_editable');
      }
      const res = await t.http.post(`/v1/events/${created.body.id}/cancel`).set(me.headers).expect(200);
      expect(res.body.status).toBe('cancelled');
      const outbox = await db.selectFrom('outbox').select('type').where('subject_id', '=', created.body.id).orderBy('id').execute();
      expect(outbox.map((o) => o.type)).toEqual(['event.submitted', 'event.cancelled']);
      await t.http.patch(`/v1/events/${created.body.id}`).set(me.headers).send({ area: 'North End' }).expect(409);
    });

    it("another account's event is 404 on PATCH and cancel", async () => {
      const created = await post().expect(201);
      const other = await createLocal(db, 'host2');
      await t.http.patch(`/v1/events/${created.body.id}`).set(other.headers).send({ area: 'North End' }).expect(404);
      await t.http.post(`/v1/events/${created.body.id}/cancel`).set(other.headers).expect(404);
      await t.http.patch('/v1/events/not-a-uuid').set(me.headers).send({}).expect(404);
    });

    it('the market cannot be changed by PATCH', async () => {
      const created = await post().expect(201);
      const res = await t.http.patch(`/v1/events/${created.body.id}`).set(me.headers).send({ marketId: 'sigiriya' }).expect(422);
      expect(firstError(res)).toMatchObject({ code: 'field.unknown', field: 'marketId' });
      const row = await db.selectFrom('events').select('market_id').where('id', '=', created.body.id).executeTakeFirstOrThrow();
      expect(row.market_id).toBe('boston');
    });

    it('editing only the end of an event that now starts in under 30 minutes still works', async () => {
      const created = await post().expect(201);
      t.clock.set('2026-11-21T18:50:00Z');
      await t.http.patch(`/v1/events/${created.body.id}`).set(me.headers).send({ endsLocal: '2026-11-21T16:00' }).expect(200);
    });
  });

  describe('GET /v1/me/events', () => {
    it('lists my events in every status ordered by start, and no one elses', async () => {
      const mk = (status: 'pending' | 'upcoming' | 'past' | 'cancelled' | 'rejected' | 'removed', days: number) =>
        insertEvent(db, { ownerUserId: me.userId, status, name: `Event ${status}`, startsAt: new Date(Date.parse(NOW) + days * 86_400_000), review: false });
      const ids = [await mk('past', 6), await mk('upcoming', 2), await mk('cancelled', 4), await mk('pending', 1), await mk('rejected', 5), await mk('removed', 3)];
      const other = await createLocal(db, 'host2');
      await insertEvent(db, { ownerUserId: other.userId, status: 'upcoming', name: 'Not mine' });

      const res = await t.http.get('/v1/me/events').set(me.headers).expect(200);
      expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([ids[3], ids[1], ids[5], ids[2], ids[4], ids[0]]);
      expect(res.body.items.map((e: { status: string }) => e.status)).toEqual(['pending', 'upcoming', 'removed', 'cancelled', 'rejected', 'past']);
    });
  });
});
