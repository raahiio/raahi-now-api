import type { Kysely } from 'kysely';
import type { Schema } from '../src/db/schema.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { fakeToken } from './support/fake-verifier.js';
import { createLocal, createMedia, type TestLocal } from './support/fixtures.js';

const EXACT = "Back counter, Fong's Grocery, 14 Eldridge Street";

describe('Drops, local side (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let me: TestLocal;
  let mediaId: string;

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
    me = await createLocal(db, 'local1');
    mediaId = await createMedia(db, me.userId);
  });

  const validDrop = (overrides: Record<string, unknown> = {}) => ({
    title: 'Hand-pulled dumplings, still warm',
    whyNow: 'The family makes one batch before noon and it sells out fast.',
    perfectFor: 'Food lovers on a short stop',
    costMinUsd: 5,
    costMaxUsd: 12,
    timeMinutes: 45,
    bestTime: 'Before 11 am',
    watchOut: 'Cash only and no seating inside.',
    photoMediaId: mediaId,
    marketId: 'new-york-city',
    fuzzyArea: 'Lower East Side',
    exactPlace: EXACT,
    meetDetail: 'Ask for the family batch at the back counter.',
    windowHours: 24,
    unlocksPerDay: 8,
    unlockPriceCredits: 2,
    ...overrides,
  });

  const create = async (overrides: Record<string, unknown> = {}, who: TestLocal = me) =>
    (await t.http.post('/v1/drops').set(who.headers).send(validDrop(overrides)).expect(201)).body;
  const setStatus = (id: string, status: string) =>
    db.updateTable('drops').set({ status: status as never }).where('id', '=', id).execute();
  const submitted = async (overrides: Record<string, unknown> = {}) => {
    const d = await create(overrides);
    await t.http.post(`/v1/drops/${d.id}/submit`).set(me.headers).expect(200);
    return d.id as string;
  };
  const live = async () => {
    const id = await submitted();
    await setStatus(id, 'live');
    return id;
  };

  it('requires authentication', async () => {
    await t.http.post('/v1/drops').send(validDrop()).expect(401);
  });

  it('a traveler cannot create a Drop (403 drop.local_required)', async () => {
    const res = await t.http
      .post('/v1/drops')
      .set({ Authorization: fakeToken({ uid: 'traveler' }) })
      .send(validDrop())
      .expect(403);
    expect(res.body.code).toBe('drop.local_required');
    expect(res.body.message).toBe('Only verified locals can post Drops.');
  });

  it('an unverified local cannot create a Drop', async () => {
    const other = await createLocal(db, 'unverified', { verified: false });
    const res = await t.http.post('/v1/drops').set(other.headers).send(validDrop()).expect(403);
    expect(res.body.code).toBe('drop.local_required');
  });

  it('creates a draft and stores the private text separately', async () => {
    const res = await t.http.post('/v1/drops').set(me.headers).send(validDrop()).expect(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      title: 'Hand-pulled dumplings, still warm',
      cost: { minUsd: 5, maxUsd: 12 },
      timeMinutes: 45,
      photo: { mediaId, isStandIn: false },
      market: { id: 'new-york-city', city: 'New York City', tz: 'America/New_York' },
      fuzzyArea: 'Lower East Side',
      unlockPriceCredits: 2,
      unlocksPerDay: 8,
      unlocksLeft: 8,
      expiresAt: null,
      windowHours: 24,
      exactPlace: EXACT,
    });
    const priv = await db.selectFrom('drop_private').selectAll().where('drop_id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(priv.exact_place).toBe(EXACT);
    const row = await db.selectFrom('drops').selectAll().where('id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('Eldridge');
    expect(row.unlock_price_minor).toBe(200);
    expect(row.unlock_cap).toBe(8);
  });

  it('rejects exact-place text in the title with the spec message', async () => {
    const res = await t.http
      .post('/v1/drops')
      .set(me.headers)
      .send(validDrop({ title: 'Dumplings at 14 Eldridge Street' }))
      .expect(422);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.errors[0]).toEqual({
      code: 'title.exact_place',
      field: 'title',
      message: 'This mentions the exact spot. Keep it for the hidden field so travelers unlock it.',
    });
  });

  it('flags exact-place text in whyNow and watchOut, and a fuzzy area that repeats it, together', async () => {
    const res = await t.http
      .post('/v1/drops')
      .set(me.headers)
      .send(
        validDrop({
          whyNow: "Fong's Grocery sells out of the family batch before noon each day.",
          watchOut: 'Line forms outside 14 Eldridge Street early.',
          fuzzyArea: 'Back counter',
        }),
      )
      .expect(422);
    expect(res.body.errors.map((e: { code: string }) => e.code).sort()).toEqual([
      'fuzzyArea.exact_place',
      'watchOut.exact_place',
      'whyNow.exact_place',
    ]);
  });

  it('never echoes the submitted exactPlace in an error body', async () => {
    const res = await t.http
      .post('/v1/drops')
      .set(me.headers)
      .send(validDrop({ exactPlace: 'SECRET-PLACE-123', title: 'x' }))
      .expect(422);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-PLACE-123');
  });

  it('whyNow "Busy." gets whyNow.too_short', async () => {
    const res = await t.http.post('/v1/drops').set(me.headers).send(validDrop({ whyNow: 'Busy.' })).expect(422);
    expect(res.body.errors).toEqual([
      {
        code: 'whyNow.too_short',
        field: 'whyNow',
        message: 'Add at least 20 characters so travelers know why this is worth doing today.',
      },
    ]);
  });

  it('a missing watchOut gets watchOut.required', async () => {
    const body = validDrop();
    delete (body as Record<string, unknown>).watchOut;
    const res = await t.http.post('/v1/drops').set(me.headers).send(body).expect(422);
    expect(res.body.errors).toEqual([
      { code: 'watchOut.required', field: 'watchOut', message: 'Add a watch-out so travelers know what to expect.' },
    ]);
  });

  it('contact details in text fields are rejected', async () => {
    const res = await t.http
      .post('/v1/drops')
      .set(me.headers)
      .send(validDrop({ bestTime: 'Call 212 555 0199', meetDetail: 'Email me at a@b.co' }))
      .expect(422);
    expect(res.body.errors.map((e: { code: string; field: string }) => `${e.field}:${e.code}`).sort()).toEqual([
      'bestTime:text.contact_details',
      'meetDetail:text.contact_details',
    ]);
  });

  it('windowHours 5 gets windowHours.invalid', async () => {
    const res = await t.http.post('/v1/drops').set(me.headers).send(validDrop({ windowHours: 5 })).expect(422);
    expect(res.body.errors).toEqual([
      { code: 'windowHours.invalid', field: 'windowHours', message: 'Choose how long this Drop stays live.' },
    ]);
  });

  it('costMaxUsd below costMinUsd gets cost.range', async () => {
    const res = await t.http
      .post('/v1/drops')
      .set(me.headers)
      .send(validDrop({ costMinUsd: 20, costMaxUsd: 10 }))
      .expect(422);
    expect(res.body.errors).toEqual([
      { code: 'cost.range', field: 'costMaxUsd', message: 'Use a number from 0 to 1000.' },
    ]);
  });

  it('cost, time and cap bounds', async () => {
    const codes = async (o: Record<string, unknown>) =>
      (await t.http.post('/v1/drops').set(me.headers).send(validDrop(o)).expect(422)).body.errors.map(
        (e: { code: string }) => e.code,
      );
    expect(await codes({ costMinUsd: -1 })).toEqual(['costMinUsd.range']);
    expect(await codes({ costMaxUsd: 1001 })).toEqual(['costMaxUsd.range']);
    expect(await codes({ timeMinutes: 10 })).toEqual(['timeMinutes.range']);
    expect(await codes({ timeMinutes: 725 })).toEqual(['timeMinutes.range']);
    expect(await codes({ timeMinutes: 50 })).toEqual(['timeMinutes.range']);
    expect(await codes({ unlocksPerDay: 0 })).toEqual(['unlocksPerDay.range']);
    expect(await codes({ unlocksPerDay: 21 })).toEqual(['unlocksPerDay.range']);
    expect(await codes({ marketId: 'atlantis' })).toEqual(['market.invalid']);
    await create({ timeMinutes: 15, costMinUsd: 0, costMaxUsd: 0 });
    await create({ timeMinutes: 720, costMinUsd: 1000, costMaxUsd: 1000, unlocksPerDay: 20 });
  });

  it('a title of 5 emoji is valid and 4 is too short', async () => {
    await create({ title: '🥟🥟🥟🥟🥟' });
    const res = await t.http.post('/v1/drops').set(me.headers).send(validDrop({ title: '🥟🥟🥟🥟' })).expect(422);
    expect(res.body.errors[0].code).toBe('title.too_short');
  });

  it('a photo that is not ready gets photo.not_ready', async () => {
    const pending = await createMedia(db, me.userId, 'pending');
    const res = await t.http.post('/v1/drops').set(me.headers).send(validDrop({ photoMediaId: pending })).expect(422);
    expect(res.body.errors[0]).toMatchObject({ code: 'photo.not_ready', field: 'photoMediaId' });
  });

  it('a photo owned by someone else, or unknown, gets photo.not_ready', async () => {
    const other = await createLocal(db, 'local2');
    const theirs = await createMedia(db, other.userId);
    for (const id of [theirs, 'not-a-uuid', '00000000-0000-7000-8000-000000000000']) {
      const res = await t.http.post('/v1/drops').set(me.headers).send(validDrop({ photoMediaId: id })).expect(422);
      expect(res.body.errors[0].code).toBe('photo.not_ready');
    }
  });

  it('unlockPriceCredits 2 is stored as 200; 0 and 4 are 422 unlockPriceCredits.range', async () => {
    for (const n of [0, 4]) {
      const res = await t.http.post('/v1/drops').set(me.headers).send(validDrop({ unlockPriceCredits: n })).expect(422);
      expect(res.body.errors[0].code).toBe('unlockPriceCredits.range');
    }
    const d = await create({ unlockPriceCredits: 3 });
    expect(d.unlockPriceCredits).toBe(3);
    const row = await db.selectFrom('drops').select('unlock_price_minor').where('id', '=', d.id).executeTakeFirstOrThrow();
    expect(row.unlock_price_minor).toBe(300);
  });

  it('submit moves draft to pending, writes a review item and a drop.submitted outbox row', async () => {
    const d = await create();
    const res = await t.http.post(`/v1/drops/${d.id}/submit`).set(me.headers).expect(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.message).toBe("Thanks. We'll review your Drop and start the clock when it goes live.");
    const items = await db.selectFrom('review_items').selectAll().where('ref_id', '=', d.id).execute();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'drop', state: 'pending' });
    const out = await db.selectFrom('outbox').selectAll().where('subject_id', '=', d.id).execute();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'drop.submitted', subject_kind: 'drop' });
    expect(JSON.stringify(out[0]!.payload)).not.toMatch(/Eldridge|Fong|meet|exact/i);
  });

  it('submitting a non-draft is 409 drop.invalid_transition', async () => {
    const id = await submitted();
    const res = await t.http.post(`/v1/drops/${id}/submit`).set(me.headers).expect(409);
    expect(res.body.code).toBe('drop.invalid_transition');
  });

  it('the sixth submit for one local is 409 drop.limit_live', async () => {
    for (let i = 0; i < 5; i++) await submitted();
    const sixth = await create();
    const res = await t.http.post(`/v1/drops/${sixth.id}/submit`).set(me.headers).expect(409);
    expect(res.body.code).toBe('drop.limit_live');
    expect(res.body.message).toBe('You can have 5 live Drops at a time. End one to submit another.');
    const row = await db.selectFrom('drops').select('status').where('id', '=', sixth.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('draft');
  });

  it('concurrent submits cannot exceed the limit', async () => {
    for (let i = 0; i < 4; i++) await submitted();
    const a = await create();
    const b = await create();
    const rs = await Promise.all(
      [a, b].map((d) => t.http.post(`/v1/drops/${d.id}/submit`).set(me.headers)),
    );
    expect(rs.map((r) => r.status).sort((a: number, b: number) => a - b)).toEqual([200, 409]);
  });

  it('gone and rejected Drops do not count toward the limit', async () => {
    for (let i = 0; i < 5; i++) await submitted();
    const rows = await db.selectFrom('drops').select('id').execute();
    await setStatus(rows[0]!.id, 'gone');
    const d = await create();
    await t.http.post(`/v1/drops/${d.id}/submit`).set(me.headers).expect(200);
  });

  it('edits a draft, including the private fields', async () => {
    const d = await create();
    const res = await t.http
      .patch(`/v1/drops/${d.id}`)
      .set(me.headers)
      .send({ title: 'New title for the dumplings', costMaxUsd: 30, exactPlace: 'Side door, 99 Orchard Street', meetDetail: null })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'draft',
      title: 'New title for the dumplings',
      cost: { minUsd: 5, maxUsd: 30 },
      exactPlace: 'Side door, 99 Orchard Street',
      meetDetail: null,
    });
  });

  it('PATCH checks edited text against the stored exact place, and a changed place against stored text', async () => {
    const d = await create();
    const a = await t.http.patch(`/v1/drops/${d.id}`).set(me.headers).send({ whyNow: "Fong's Grocery sells out before noon every day." }).expect(422);
    expect(a.body.errors).toEqual([expect.objectContaining({ code: 'whyNow.exact_place', field: 'whyNow' })]);
    const b = await t.http.patch(`/v1/drops/${d.id}`).set(me.headers).send({ exactPlace: 'Lower East Side' }).expect(422);
    expect(b.body.errors).toEqual([expect.objectContaining({ code: 'fuzzyArea.exact_place', field: 'fuzzyArea' })]);
    expect(JSON.stringify(a.body) + JSON.stringify(b.body)).not.toContain('Eldridge');
  });

  it('PATCH cost range is checked against the stored values', async () => {
    const d = await create();
    const res = await t.http.patch(`/v1/drops/${d.id}`).set(me.headers).send({ costMaxUsd: 2 }).expect(422);
    expect(res.body.errors[0]).toMatchObject({ code: 'cost.range', field: 'costMaxUsd' });
  });

  it('PATCH rejects unknown fields', async () => {
    const d = await create();
    const res = await t.http.patch(`/v1/drops/${d.id}`).set(me.headers).send({ status: 'live' }).expect(422);
    expect(res.body.errors[0].code).toBe('field.unknown');
  });

  it('editing a rejected Drop returns it to draft', async () => {
    const id = await submitted();
    await setStatus(id, 'rejected');
    const res = await t.http.patch(`/v1/drops/${id}`).set(me.headers).send({ windowHours: 48 }).expect(200);
    expect(res.body).toMatchObject({ status: 'draft', windowHours: 48 });
  });

  it('editing a pending, gone or removed Drop is 409 drop.invalid_transition', async () => {
    const id = await submitted();
    for (const s of ['pending', 'gone', 'removed']) {
      await setStatus(id, s);
      const res = await t.http.patch(`/v1/drops/${id}`).set(me.headers).send({ title: 'Another fine title' }).expect(409);
      expect(res.body.code).toBe('drop.invalid_transition');
    }
  });

  it('editing text on a live Drop returns it to pending with a new review item', async () => {
    const id = await live();
    await db.updateTable('review_items').set({ state: 'approved' }).where('ref_id', '=', id).execute();
    const res = await t.http.patch(`/v1/drops/${id}`).set(me.headers).send({ title: 'A fresher title for this' }).expect(200);
    expect(res.body).toMatchObject({ status: 'pending', title: 'A fresher title for this' });
    const pending = await db
      .selectFrom('review_items')
      .selectAll()
      .where('ref_id', '=', id)
      .where('state', '=', 'pending')
      .execute();
    expect(pending).toHaveLength(1);
  });

  it('editing text on a paused Drop returns it to pending', async () => {
    const id = await live();
    await setStatus(id, 'paused');
    await db.updateTable('review_items').set({ state: 'approved' }).where('ref_id', '=', id).execute();
    const res = await t.http.patch(`/v1/drops/${id}`).set(me.headers).send({ meetDetail: 'Knock twice at the side door.' }).expect(200);
    expect(res.body.status).toBe('pending');
  });

  it('editing exactPlace on a live Drop is 409 drop.field_locked', async () => {
    const id = await live();
    const res = await t.http.patch(`/v1/drops/${id}`).set(me.headers).send({ exactPlace: 'Somewhere else entirely' }).expect(409);
    expect(res.body.code).toBe('drop.field_locked');
    const mixed = await t.http
      .patch(`/v1/drops/${id}`)
      .set(me.headers)
      .send({ title: 'A fresher title for this', unlocksPerDay: 9 })
      .expect(409);
    expect(mixed.body.code).toBe('drop.field_locked');
    const row = await db.selectFrom('drops').select(['status', 'title']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('live');
    expect(row.title).not.toBe('A fresher title for this');
  });

  it('pause, resume and end follow the state table', async () => {
    const id = await live();
    expect((await t.http.post(`/v1/drops/${id}/pause`).set(me.headers).expect(200)).body.status).toBe('paused');
    expect((await t.http.post(`/v1/drops/${id}/resume`).set(me.headers).expect(200)).body.status).toBe('live');
    expect((await t.http.post(`/v1/drops/${id}/pause`).set(me.headers).expect(200)).body.status).toBe('paused');
    expect((await t.http.post(`/v1/drops/${id}/end`).set(me.headers).expect(200)).body.status).toBe('gone');
    for (const action of ['pause', 'resume', 'end']) {
      const res = await t.http.post(`/v1/drops/${id}/${action}`).set(me.headers).expect(409);
      expect(res.body.code).toBe('drop.invalid_transition');
    }
  });

  it('pausing a draft is 409', async () => {
    const d = await create();
    await t.http.post(`/v1/drops/${d.id}/pause`).set(me.headers).expect(409);
  });

  it('raise-cap 8 → 12 works; 8 → 6 is 422 drop.cap_lower; 8 → 21 is 422 unlocksPerDay.range', async () => {
    const id = await live();
    expect((await t.http.post(`/v1/drops/${id}/raise-cap`).set(me.headers).send({ unlocksPerDay: 12 }).expect(200)).body.unlocksPerDay).toBe(12);
    const d = await create();
    await t.http.post(`/v1/drops/${d.id}/raise-cap`).set(me.headers).send({ unlocksPerDay: 10 }).expect(200);
    const id2 = await live();
    const lower = await t.http.post(`/v1/drops/${id2}/raise-cap`).set(me.headers).send({ unlocksPerDay: 6 }).expect(422);
    expect(lower.body.code).toBe('drop.cap_lower');
    expect(lower.body.message).toBe('The daily limit can only go up while a Drop is live.');
    const over = await t.http.post(`/v1/drops/${id2}/raise-cap`).set(me.headers).send({ unlocksPerDay: 21 }).expect(422);
    expect(over.body.errors[0].code).toBe('unlocksPerDay.range');
    const same = await t.http.post(`/v1/drops/${id2}/raise-cap`).set(me.headers).send({ unlocksPerDay: 8 }).expect(200);
    expect(same.body.unlocksPerDay).toBe(8);
  });

  it('raise-cap on a gone Drop is 409', async () => {
    const id = await live();
    await setStatus(id, 'gone');
    await t.http.post(`/v1/drops/${id}/raise-cap`).set(me.headers).send({ unlocksPerDay: 12 }).expect(409);
  });

  it('duplicate copies every field, including private ones, into a new draft', async () => {
    const id = await live();
    await db.updateTable('drops').set({ unlocks_used: 3, approved_at: new Date(), expires_at: new Date(Date.now() + 3600_000) }).where('id', '=', id).execute();
    const res = await t.http.post(`/v1/drops/${id}/duplicate`).set(me.headers).expect(201);
    expect(res.body.id).not.toBe(id);
    expect(res.body).toMatchObject({ status: 'draft', exactPlace: EXACT, meetDetail: 'Ask for the family batch at the back counter.', expiresAt: null, unlocksLeft: 8 });
    const a = await db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const b = await db.selectFrom('drops').selectAll().where('id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(b).toMatchObject({
      title: a.title, why_now: a.why_now, perfect_for: a.perfect_for, cost_min_usd: a.cost_min_usd, cost_max_usd: a.cost_max_usd,
      time_minutes: a.time_minutes, best_time: a.best_time, watch_out: a.watch_out, photo_media_id: a.photo_media_id,
      fuzzy_area: a.fuzzy_area, unlock_price_minor: a.unlock_price_minor, unlock_cap: a.unlock_cap, window_hours: a.window_hours,
      market_id: a.market_id, local_id: a.local_id, approved_at: null, expires_at: null, unlocks_used: 0,
    });
  });

  it('another local gets 404 for my Drop on every route', async () => {
    const other = await createLocal(db, 'local2');
    const id = await live();
    const calls = [
      t.http.patch(`/v1/drops/${id}`).send({ title: 'Stolen title here' }),
      t.http.post(`/v1/drops/${id}/submit`),
      t.http.post(`/v1/drops/${id}/pause`),
      t.http.post(`/v1/drops/${id}/resume`),
      t.http.post(`/v1/drops/${id}/end`),
      t.http.post(`/v1/drops/${id}/raise-cap`).send({ unlocksPerDay: 12 }),
      t.http.post(`/v1/drops/${id}/duplicate`),
      t.http.get(`/v1/me/drops/${id}`),
    ];
    for (const c of calls) {
      const res = await c.set(other.headers).expect(404);
      expect(res.body.code).toBe('not_found');
    }
    await t.http.get('/v1/me/drops/not-a-uuid').set(me.headers).expect(404);
  });

  it('GET /v1/me/drops/:id includes exactPlace and meetDetail', async () => {
    const d = await create();
    const res = await t.http.get(`/v1/me/drops/${d.id}`).set(me.headers).expect(200);
    expect(res.body).toMatchObject({ exactPlace: EXACT, meetDetail: 'Ask for the family batch at the back counter.' });
  });

  it('GET /v1/me/drops lists my Drops in every status, newest first, and none of anyone else', async () => {
    const other = await createLocal(db, 'local2');
    const otherMedia = await createMedia(db, other.userId);
    await create({ photoMediaId: otherMedia }, other);
    const a = await create({ title: 'First drop in the list' });
    const b = await create({ title: 'Second drop in the list' });
    await setStatus(a.id, 'removed');
    const res = await t.http.get('/v1/me/drops').set(me.headers).expect(200);
    expect(res.body.items.map((d: { id: string }) => d.id)).toEqual([b.id, a.id]);
    expect(res.body.items[1].status).toBe('removed');
  });
});
