import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../src/db/schema.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { fakeToken } from './support/fake-verifier.js';
import { createLocal, createMedia, insertEvent, type TestLocal } from './support/fixtures.js';

const EXACT = "Back counter, Fong's Grocery, 14 Eldridge Street";

describe('Review queue and admin actions (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let me: TestLocal;
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
    me = await createLocal(db, 'local1');
    mediaId = await createMedia(db, me.userId);
  });

  const submittedDrop = async (windowHours = 24) => {
    const body = {
      title: 'Hand-pulled dumplings, still warm',
      whyNow: 'The family makes one batch before noon and it sells out fast.',
      perfectFor: 'Food lovers on a short stop',
      costMinUsd: 5,
      costMaxUsd: 12,
      timeMinutes: 45,
      watchOut: 'Cash only and no seating inside.',
      photoMediaId: mediaId,
      marketId: 'new-york-city',
      fuzzyArea: 'Lower East Side',
      exactPlace: EXACT,
      meetDetail: 'Ask for the family batch at the back counter.',
      windowHours,
      unlocksPerDay: 8,
      unlockPriceCredits: 2,
    };
    const d = (await t.http.post('/v1/drops').set(me.headers).send(body).expect(201)).body;
    await t.http.post(`/v1/drops/${d.id}/submit`).set(me.headers).expect(200);
    return d.id as string;
  };
  const act = (kind: string, id: string, action: string, body?: object, who = reviewer) =>
    t.http.post(`/v1/admin/items/${kind}/${id}/${action}`).set(who).send(body);
  const dropRow = (id: string) => db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const outboxRows = (type: string, id: string) =>
    db.selectFrom('outbox').selectAll().where('type', '=', type).where('subject_id', '=', id).execute();

  it('approving a Drop sets live, approved_at and expires_at = approved_at + window_hours', async () => {
    const id = await submittedDrop(24);
    await act('drop', id, 'approve').expect(200);
    const row = await dropRow(id);
    expect(row.status).toBe('live');
    expect(row.approved_at).toBeInstanceOf(Date);
    expect((row.expires_at as Date).getTime() - (row.approved_at as Date).getTime()).toBe(24 * 3_600_000);
    const review = await db.selectFrom('review_items').selectAll().where('ref_id', '=', id).executeTakeFirstOrThrow();
    expect(review.state).toBe('approved');
    expect(review.reviewer_id).not.toBeNull();
  });

  it('re-approval after a live text edit restarts the window', async () => {
    const id = await submittedDrop(6);
    await act('drop', id, 'approve').expect(200);
    const first = (await dropRow(id)).approved_at as Date;
    await t.http.patch(`/v1/drops/${id}`).set(me.headers).send({ title: 'Hand-pulled dumplings, fresh' }).expect(200);
    expect((await dropRow(id)).status).toBe('pending');
    await new Promise((r) => setTimeout(r, 10));
    await act('drop', id, 'approve').expect(200);
    const row = await dropRow(id);
    expect(row.status).toBe('live');
    expect((row.approved_at as Date).getTime()).toBeGreaterThan(first.getTime());
    expect((row.expires_at as Date).getTime() - (row.approved_at as Date).getTime()).toBe(6 * 3_600_000);
  });

  it('approving an event sets upcoming', async () => {
    const id = await insertEvent(db);
    await act('event', id, 'approve').expect(200);
    const ev = await db.selectFrom('events').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(ev.status).toBe('upcoming');
    expect(await outboxRows('event.approved', id)).toHaveLength(1);
  });

  it('rejecting a Drop and an event stores the reason', async () => {
    const dropId = await submittedDrop();
    await act('drop', dropId, 'reject', { reason: '  Photo is blurry  ' }).expect(200);
    expect((await dropRow(dropId)).status).toBe('rejected');
    const r = await db.selectFrom('review_items').select(['state', 'reason']).where('ref_id', '=', dropId).executeTakeFirstOrThrow();
    expect(r).toEqual({ state: 'rejected', reason: 'Photo is blurry' });

    const eventId = await insertEvent(db);
    await act('event', eventId, 'reject', { reason: 'Not a real event' }).expect(200);
    const ev = await db.selectFrom('events').select('status').where('id', '=', eventId).executeTakeFirstOrThrow();
    expect(ev.status).toBe('rejected');
    expect(await outboxRows('event.rejected', eventId)).toHaveLength(1);
  });

  it('reject and remove need a reason of at least 5 characters', async () => {
    const id = await submittedDrop();
    for (const action of ['reject', 'remove']) {
      for (const body of [undefined, {}, { reason: '    ' }, { reason: 'nope' }, { reason: '  abc  ' }, { reason: 12345 }]) {
        const res = await act('drop', id, action, body).expect(422);
        expect(res.body.code).toBe('validation_failed');
        expect(res.body.errors[0]).toMatchObject({ code: 'review.reason_required', field: 'reason' });
      }
    }
    expect((await dropRow(id)).status).toBe('pending');
  });

  it('approving an item that is not pending is 409 review.not_pending', async () => {
    const id = await submittedDrop();
    await act('drop', id, 'approve').expect(200);
    const res = await act('drop', id, 'approve').expect(409);
    expect(res.body.code).toBe('review.not_pending');
    const res2 = await act('drop', id, 'reject', { reason: 'Too late now' }).expect(409);
    expect(res2.body.code).toBe('review.not_pending');
  });

  it('a local, a traveler and an anonymous caller are refused', async () => {
    const id = await submittedDrop();
    const res = await t.http.get('/v1/admin/review-queue').set(me.headers).expect(403);
    expect(res.body.code).toBe('forbidden');
    await act('drop', id, 'approve', undefined, me.headers).expect(403);
    await t.http.get('/v1/admin/review-queue').expect(401);
    expect((await dropRow(id)).status).toBe('pending');
  });

  it('the queue lists pending items oldest first with private fields', async () => {
    const dropId = await submittedDrop();
    const guestEvent = await insertEvent(db, {
      guestEmail: 'host@example.com',
      exactAddress: '9 Mott Street',
      review: { submittedAt: new Date(Date.now() - 60_000) },
    });
    const done = await insertEvent(db, { status: 'upcoming' });
    const res = await t.http.get('/v1/admin/review-queue').set(reviewer).expect(200);
    expect(res.body.items.map((i: { refId: string }) => i.refId)).toEqual([guestEvent, dropId]);
    expect(res.body.items.map((i: { refId: string }) => i.refId)).not.toContain(done);
    const [ev, drop] = res.body.items;
    expect(ev).toMatchObject({ kind: 'event', flags: [], item: { exactAddress: '9 Mott Street', hostEmail: 'host@example.com' } });
    expect(drop.item).toMatchObject({ exactPlace: EXACT, meetDetail: 'Ask for the family batch at the back counter.' });
    expect(typeof drop.reviewId).toBe('string');
    expect(typeof drop.submittedAt).toBe('string');

    const onlyDrops = await t.http.get('/v1/admin/review-queue?kind=drop').set(reviewer).expect(200);
    expect(onlyDrops.body.items.map((i: { refId: string }) => i.refId)).toEqual([dropId]);
    const onlyEvents = await t.http.get('/v1/admin/review-queue?kind=event').set(reviewer).expect(200);
    expect(onlyEvents.body.items.map((i: { refId: string }) => i.refId)).toEqual([guestEvent]);
    await t.http.get('/v1/admin/review-queue?kind=bogus').set(reviewer).expect(404);
  });

  it('every decision writes an audit_log row', async () => {
    const a = await submittedDrop();
    await act('drop', a, 'approve').expect(200);
    const e = await insertEvent(db);
    await act('event', e, 'reject', { reason: 'Not a real event' }).expect(200);
    const rows = await db.selectFrom('audit_log').selectAll().orderBy('created_at').execute();
    expect(rows.map((r) => r.action)).toEqual(['drop.approve', 'event.reject']);
    expect(rows[0]).toMatchObject({ target_kind: 'drop', target_id: a, diff: { from: 'pending', to: 'live' } });
    expect(rows[1]).toMatchObject({ target_kind: 'event', target_id: e, diff: { from: 'pending', to: 'rejected', reason: 'Not a real event' } });
    const reviewerUser = await db.selectFrom('users').select('id').where('firebase_uid', '=', 'rev1').executeTakeFirstOrThrow();
    expect(rows[0]?.actor_id).toBe(reviewerUser.id);
    expect(JSON.stringify(rows)).not.toMatch(/Eldridge|exactPlace|meetDetail/);
  });

  it('approve writes a drop.approved outbox row that holds no private fields', async () => {
    const id = await submittedDrop();
    await act('drop', id, 'approve').expect(200);
    const [row] = await outboxRows('drop.approved', id);
    expect(row).toBeDefined();
    expect(JSON.stringify(row?.payload)).not.toMatch(/exactPlace|exact_place|meetDetail|meet_detail|Eldridge/);
    expect(row?.subject_kind).toBe('drop');
  });

  it('two simultaneous approvals produce one success, one 409 and one outbox row', async () => {
    const id = await submittedDrop();
    const [a, b] = await Promise.all([act('drop', id, 'approve'), act('drop', id, 'approve')]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
    expect(await outboxRows('drop.approved', id)).toHaveLength(1);
    expect(await db.selectFrom('audit_log').selectAll().execute()).toHaveLength(1);
  });

  it('removing a pending Drop closes its review item; removing a live one needs no review item', async () => {
    const pending = await submittedDrop();
    await act('drop', pending, 'remove', { reason: 'Against the rules' }).expect(200);
    expect((await dropRow(pending)).status).toBe('removed');
    const item = await db.selectFrom('review_items').select('state').where('ref_id', '=', pending).executeTakeFirstOrThrow();
    expect(item.state).toBe('removed');

    const liveId = await submittedDrop();
    await act('drop', liveId, 'approve').expect(200);
    await act('drop', liveId, 'remove', { reason: 'Reported by a traveler' }).expect(200);
    expect((await dropRow(liveId)).status).toBe('removed');
    expect(await outboxRows('drop.removed', liveId)).toHaveLength(1);
    const audit = await db.selectFrom('audit_log').selectAll().where('target_id', '=', liveId).where('action', '=', 'drop.remove').execute();
    expect(audit).toHaveLength(1);
  });

  it('removing a Drop that is already removed or still a draft is 409 drop.invalid_transition', async () => {
    const id = await submittedDrop();
    await act('drop', id, 'remove', { reason: 'Against the rules' }).expect(200);
    const again = await act('drop', id, 'remove', { reason: 'Against the rules' }).expect(409);
    expect(again.body.code).toBe('drop.invalid_transition');
    expect(await outboxRows('drop.removed', id)).toHaveLength(1);

    await db.updateTable('drops').set({ status: 'draft' }).where('id', '=', id).execute();
    await act('drop', id, 'remove', { reason: 'Against the rules' }).expect(409);
  });

  it('removing events follows the event state table', async () => {
    const upcoming = await insertEvent(db, { status: 'upcoming' });
    await act('event', upcoming, 'remove', { reason: 'Reported by a traveler' }).expect(200);
    const ev = await db.selectFrom('events').select('status').where('id', '=', upcoming).executeTakeFirstOrThrow();
    expect(ev.status).toBe('removed');
    expect(await outboxRows('event.removed', upcoming)).toHaveLength(1);

    const cancelled = await insertEvent(db, { status: 'cancelled' });
    const res = await act('event', cancelled, 'remove', { reason: 'Reported by a traveler' }).expect(409);
    expect(res.body).toMatchObject({ code: 'event.invalid_transition', message: "That can't be done to this event right now." });

    const pending = await insertEvent(db);
    await act('event', pending, 'remove', { reason: 'Against the rules' }).expect(200);
    const item = await db.selectFrom('review_items').select('state').where('ref_id', '=', pending).executeTakeFirstOrThrow();
    expect(item.state).toBe('removed');
  });

  describe('the decision reason reaches the poster', () => {
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    it('the owner sees the reason after a rejection; the reviewer view has it too', async () => {
      const id = await submittedDrop();
      expect((await t.http.get(`/v1/me/drops/${id}`).set(me.headers).expect(200)).body.review).toBeNull();
      await act('drop', id, 'reject', { reason: 'Photo is blurry' }).expect(200);
      const own = (await t.http.get(`/v1/me/drops/${id}`).set(me.headers).expect(200)).body;
      expect(own.review).toEqual({ state: 'rejected', reason: 'Photo is blurry', decidedAt: expect.stringMatching(ISO) });
      const list = (await t.http.get('/v1/me/drops').set(me.headers).expect(200)).body.items;
      expect(list[0].review).toMatchObject({ state: 'rejected', reason: 'Photo is blurry' });
      const asReviewer = (await t.http.get(`/v1/drops/${id}`).set(reviewer).expect(200)).body;
      expect(asReviewer.review).toMatchObject({ state: 'rejected', reason: 'Photo is blurry' });
    });

    it('removing a live Drop records a decided review row with the reason, shown to the owner but never publicly', async () => {
      const id = await submittedDrop();
      await act('drop', id, 'approve').expect(200);
      const pub = (await t.http.get(`/v1/drops/${id}`).expect(200)).body;
      expect(pub).not.toHaveProperty('review');
      expect((await t.http.get(`/v1/me/drops/${id}`).set(me.headers).expect(200)).body.review).toMatchObject({ state: 'approved', reason: null });

      await act('drop', id, 'remove', { reason: 'Reported by a traveler' }).expect(200);
      const rows = await db.selectFrom('review_items').select(['state', 'reason', 'reviewer_id', 'decided_at']).where('ref_id', '=', id).orderBy('decided_at').execute();
      expect(rows.map((r) => [r.state, r.reason])).toEqual([['approved', null], ['removed', 'Reported by a traveler']]);
      expect(rows[1]?.reviewer_id).not.toBeNull();
      const own = (await t.http.get(`/v1/me/drops/${id}`).set(me.headers).expect(200)).body;
      expect(own.review).toMatchObject({ state: 'removed', reason: 'Reported by a traveler' });
    });

    it('the event owner sees the reason after a rejection and after removal of an upcoming event; the public never does', async () => {
      const rejected = await insertEvent(db, { ownerUserId: me.userId });
      await act('event', rejected, 'reject', { reason: 'Not a real event' }).expect(200);
      const upcoming = await insertEvent(db, { ownerUserId: me.userId, status: 'upcoming', review: false });
      expect((await t.http.get(`/v1/events/${upcoming}`).expect(200)).body).not.toHaveProperty('review');
      await act('event', upcoming, 'remove', { reason: 'Reported by a traveler' }).expect(200);

      const items = (await t.http.get('/v1/me/events').set(me.headers).expect(200)).body.items as { id: string; review: unknown }[];
      expect(items.find((e) => e.id === rejected)?.review).toMatchObject({ state: 'rejected', reason: 'Not a real event' });
      expect(items.find((e) => e.id === upcoming)?.review).toMatchObject({ state: 'removed', reason: 'Reported by a traveler' });
      const own = (await t.http.get(`/v1/events/${upcoming}`).set(me.headers).expect(200)).body;
      expect(own.review).toMatchObject({ state: 'removed', reason: 'Reported by a traveler' });
    });

    it('review queue items carry the latest decision (null when there is none)', async () => {
      await submittedDrop();
      await insertEvent(db);
      const items = (await t.http.get('/v1/admin/review-queue').set(reviewer).expect(200)).body.items as { item: { review: unknown } }[];
      expect(items).toHaveLength(2);
      for (const i of items) expect(i.item.review).toBeNull();
    });

    it('a reason over 500 characters is 422 review.reason_too_long', async () => {
      const id = await submittedDrop();
      const res = await act('drop', id, 'reject', { reason: 'x'.repeat(501) }).expect(422);
      expect(res.body.errors[0]).toMatchObject({ code: 'review.reason_too_long', field: 'reason', message: 'Use at most 500 characters.' });
      await act('drop', id, 'reject', { reason: 'x'.repeat(500) }).expect(200);
    });
  });

  it('a bad kind, an unknown id and a non-UUID id are 404', async () => {
    const id = await submittedDrop();
    await act('banner', id, 'approve').expect(404);
    await act('drop', uuidv7(), 'approve').expect(404);
    await act('drop', 'not-a-uuid', 'approve').expect(404);
    await act('event', uuidv7(), 'reject', { reason: 'Not a real event' }).expect(404);
    await act('drop', id, 'reject', { reason: 'bad' }).expect(422);
  });
});
