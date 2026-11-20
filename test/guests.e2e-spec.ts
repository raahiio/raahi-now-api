import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import { hashClaimCode } from '../src/guests/claim-codes.js';
import { verifyManageToken } from '../src/guests/manage-token.js';
import type { Schema } from '../src/db/schema.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { fakeToken } from './support/fake-verifier.js';
import { createLocal, insertEvent, type TestLocal } from './support/fixtures.js';

const NOW = '2026-11-19T12:00:00Z';
const CODE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

describe('Guest hosts (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let seq = 0;

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
    t.mailer.clear();
    seq = 0;
  });

  /** A valid guest body. Each call gets a distinct name so repeated posts are not duplicates. */
  const validGuestEvent = (overrides: Record<string, unknown> = {}) => ({
    name: `Saturday dumpling walk ${++seq}`,
    category: 'walk',
    marketId: 'boston',
    description: 'A relaxed walk through the neighborhood, tasting as we go.',
    startsLocal: '2026-11-21T14:00',
    area: 'Chinatown',
    hostName: 'Guest Host',
    hostEmail: 'guest@example.com',
    ...overrides,
  });
  const postGuest = (overrides: Record<string, unknown> = {}, device = 'dev-1') =>
    t.http.post('/v1/events').set('X-Device-Id', device).send(validGuestEvent(overrides));
  const createGuest = async (overrides: Record<string, unknown> = {}, device = 'dev-1') =>
    (await postGuest(overrides, device).expect(201)).body as { id: string; claimCode: string; status: string };
  const wrong = 'ZZZZZZZZZZZZ';

  describe('creating', () => {
    it('a guest creates a pending event; the response has claimCode and the spec message; one email is captured', async () => {
      const res = await postGuest().expect(201);
      expect(res.body).toMatchObject({
        status: 'pending',
        message: "Thanks! We'll take a quick look before it goes up, and email you at guest@example.com.",
        host: { name: 'Guest Host', badge: 'community_host' },
      });
      expect(res.body.claimCode).toMatch(CODE);
      expect(JSON.stringify(res.body)).not.toContain('hostEmail');
      expect(t.mailer.sent).toHaveLength(1);
      expect(t.mailer.sent[0]).toMatchObject({ to: 'guest@example.com' });
      expect(t.mailer.sent[0]!.text).toContain(res.body.claimCode);

      const ids = await db.selectFrom('guest_identities').select(['claim_hash', 'email']).execute();
      expect(ids).toEqual([
        { claim_hash: hashClaimCode(res.body.claimCode, t.env.CLAIM_CODE_SECRET), email: 'guest@example.com' },
      ]);
      expect(await db.selectFrom('review_items').select(['kind', 'state']).execute()).toEqual([{ kind: 'event', state: 'pending' }]);
      const outbox = await db.selectFrom('outbox').select(['type', 'payload']).execute();
      expect(outbox.map((o) => o.type)).toEqual(['event.submitted']);
      expect(JSON.stringify(outbox)).not.toContain('guest@example.com');
    });

    it('a guest post without X-Device-Id is 422 device.required; without hostEmail or hostName is 422 <field>.required', async () => {
      const noDevice = await t.http.post('/v1/events').send(validGuestEvent()).expect(422);
      expect(noDevice.body).toMatchObject({ code: 'device.required', field: 'X-Device-Id' });

      const { hostEmail: _e, ...noEmail } = validGuestEvent();
      const r1 = await t.http.post('/v1/events').set('X-Device-Id', 'dev-1').send(noEmail).expect(422);
      expect(r1.body.errors).toEqual([expect.objectContaining({ code: 'hostEmail.required', field: 'hostEmail' })]);
      const { hostName: _n, ...noName } = validGuestEvent();
      const r2 = await t.http.post('/v1/events').set('X-Device-Id', 'dev-1').send(noName).expect(422);
      expect(r2.body.errors).toEqual([expect.objectContaining({ code: 'hostName.required', field: 'hostName' })]);
      expect(await db.selectFrom('guest_identities').select('id').execute()).toEqual([]);
    });

    it('rejects a malformed hostEmail and contact details in hostName', async () => {
      const r1 = await postGuest({ hostEmail: 'not-an-email' }).expect(422);
      expect(r1.body.errors[0]).toMatchObject({ code: 'hostEmail.invalid', field: 'hostEmail' });
      const r2 = await postGuest({ hostName: 'call 555 123 4567' }).expect(422);
      expect(r2.body.errors[0]).toMatchObject({ code: 'text.contact_details', field: 'hostName' });
    });

    it('an account caller sending hostName or hostEmail is 422 field.unknown', async () => {
      const me: TestLocal = await createLocal(db, 'host1');
      const res = await t.http
        .post('/v1/events')
        .set(me.headers)
        .send({ ...validGuestEvent() })
        .expect(422);
      expect(res.body.errors.map((e: { code: string; field: string }) => [e.code, e.field]).sort()).toEqual([
        ['field.unknown', 'hostEmail'],
        ['field.unknown', 'hostName'],
      ]);
    });

    it('the third guest post from one device in a day is 429 rate_limited; the sixth from one IP is 429', async () => {
      await postGuest({}, 'dev-1').expect(201);
      await postGuest({}, 'dev-1').expect(201);
      expect((await postGuest({}, 'dev-1').expect(429)).body.code).toBe('rate_limited');
      await postGuest({}, 'dev-2').expect(201);
      await postGuest({}, 'dev-3').expect(201);
      await postGuest({}, 'dev-4').expect(201);
      // five accepted from this IP (two of them... counted per device); the sixth device is over the IP limit
      expect((await postGuest({}, 'dev-5').expect(429)).body.code).toBe('rate_limited');
      expect(await db.selectFrom('events').select('id').execute()).toHaveLength(5);
    });

    it('a returning guest email with an approved event creates an upcoming event', async () => {
      await insertEvent(db, { status: 'upcoming', guestEmail: 'Guest@Example.com' });
      const res = await postGuest({}, 'dev-9').expect(201);
      expect(res.body.status).toBe('upcoming');
      expect(res.body.message).toContain('guest@example.com');
      const outbox = await db.selectFrom('outbox').select('type').execute();
      expect(outbox.map((o) => o.type)).toEqual(['event.approved']);
      expect(await db.selectFrom('review_items').select('id').execute()).toEqual([]);
    });

    it('a guest email whose only earlier event is pending or cancelled stays pending', async () => {
      await insertEvent(db, { status: 'cancelled', guestEmail: 'guest@example.com', review: false });
      expect((await postGuest().expect(201)).body.status).toBe('pending');
    });

    it('the same guest email, name, market and start is 409 event.duplicate', async () => {
      await postGuest({ name: 'Dumpling walk' }, 'dev-1').expect(201);
      const res = await postGuest({ name: 'dumpling WALK', hostEmail: 'GUEST@example.com' }, 'dev-2').expect(409);
      expect(res.body.code).toBe('event.duplicate');
    });
  });

  describe('managing with a claim code', () => {
    it('a guest can PATCH and cancel with the right X-Claim-Code; a wrong code is 401 claim.invalid', async () => {
      const ev = await createGuest();
      const bad = await t.http.patch(`/v1/events/${ev.id}`).set('X-Claim-Code', wrong).send({ area: 'Back Bay' }).expect(401);
      expect(bad.body.code).toBe('claim.invalid');
      expect((await t.http.patch(`/v1/events/${ev.id}`).send({ area: 'Back Bay' }).expect(401)).body.code).toBe('claim.invalid');

      const lower = ev.claimCode.toLowerCase().replace(/^(.{4})(.{4})/, '$1-$2 ');
      const ok = await t.http.patch(`/v1/events/${ev.id}`).set('X-Claim-Code', lower).send({ area: 'Back Bay' }).expect(200);
      expect(ok.body.area).toBe('Back Bay');
      expect(JSON.stringify(ok.body)).not.toContain('guest@example.com');

      const cancelled = await t.http.post(`/v1/events/${ev.id}/cancel`).set('X-Claim-Code', ev.claimCode).expect(200);
      expect(cancelled.body.status).toBe('cancelled');
    });

    it("an unknown event id with a claim code is 401 claim.invalid, never 404; another guest's code does not work", async () => {
      const a = await createGuest({}, 'dev-1');
      const b = await createGuest({ hostEmail: 'other@example.com' }, 'dev-2');
      expect((await t.http.patch(`/v1/events/${uuidv7()}`).set('X-Claim-Code', a.claimCode).send({}).expect(401)).body.code).toBe('claim.invalid');
      expect((await t.http.patch('/v1/events/not-a-uuid').set('X-Claim-Code', a.claimCode).send({}).expect(401)).body.code).toBe('claim.invalid');
      expect((await t.http.patch(`/v1/events/${b.id}`).set('X-Claim-Code', a.claimCode).send({}).expect(401)).body.code).toBe('claim.invalid');
    });

    it('cancelling a pending event also removes its pending review item in the same step', async () => {
      const ev = await createGuest();
      await t.http.post(`/v1/events/${ev.id}/cancel`).set('X-Claim-Code', ev.claimCode).expect(200);
      const items = await db.selectFrom('review_items').select(['state', 'reason', 'decided_at']).execute();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ state: 'removed', reason: 'Cancelled by host' });
      expect(items[0]!.decided_at).toBeInstanceOf(Date);
    });

    it('an account cancel of a pending event also removes its review item; an upcoming cancel leaves review untouched', async () => {
      const me = await createLocal(db, 'host1');
      const body = { name: 'Account walk', category: 'walk', marketId: 'boston', description: 'A relaxed walk through the neighborhood, tasting as we go.', startsLocal: '2026-11-21T14:00', area: 'Chinatown' };
      const pending = (await t.http.post('/v1/events').set(me.headers).send(body).expect(201)).body;
      await t.http.post(`/v1/events/${pending.id}/cancel`).set(me.headers).expect(200);
      const items = await db.selectFrom('review_items').select(['state', 'reason', 'decided_at']).execute();
      expect(items[0]).toMatchObject({ state: 'removed', reason: 'Cancelled by host' });
      expect(items[0]!.decided_at).toBeInstanceOf(Date);

      const upcomingId = await insertEvent(db, { status: 'upcoming', ownerUserId: me.userId, name: 'Other', review: false });
      await t.http.post(`/v1/events/${upcomingId}/cancel`).set(me.headers).expect(200);
      expect(await db.selectFrom('review_items').select('id').execute()).toHaveLength(1);
    });

    it('a signed-in account still manages its own events and never needs a claim code', async () => {
      const me = await createLocal(db, 'host1');
      const id = await insertEvent(db, { status: 'upcoming', ownerUserId: me.userId, review: false });
      await t.http.patch(`/v1/events/${id}`).set(me.headers).send({ area: 'Somewhere' }).expect(200);
      const stranger = { Authorization: fakeToken({ uid: 'stranger' }) };
      await t.http.patch(`/v1/events/${id}`).set(stranger).send({ area: 'Elsewhere' }).expect(404);
    });
  });

  describe('lock', () => {
    it('five wrong codes from one device lock it: the sixth try is 429 claim.locked even with the right code', async () => {
      const ev = await createGuest();
      for (let i = 0; i < 5; i++) {
        await t.http.patch(`/v1/events/${ev.id}`).set('X-Device-Id', 'dev-1').set('X-Claim-Code', wrong).send({}).expect(401);
      }
      const locked = await t.http.patch(`/v1/events/${ev.id}`).set('X-Device-Id', 'dev-1').set('X-Claim-Code', ev.claimCode).send({}).expect(429);
      expect(locked.body.code).toBe('claim.locked');
      // Same IP, so the IP key is locked too, whatever the device.
      await t.http.post('/v1/claims/exchange').set('X-Device-Id', 'dev-2').send({ code: ev.claimCode }).expect(429);
    });

    it('failures older than an hour no longer count', async () => {
      const ev = await createGuest();
      for (let i = 0; i < 5; i++) {
        await t.http.patch(`/v1/events/${ev.id}`).set('X-Claim-Code', wrong).send({}).expect(401);
      }
      await t.http.patch(`/v1/events/${ev.id}`).set('X-Claim-Code', ev.claimCode).send({}).expect(429);
      await db.updateTable('rate_events').set({ created_at: new Date(Date.now() - 2 * 3_600_000) }).where('kind', '=', 'claim_failure').execute();
      await t.http.patch(`/v1/events/${ev.id}`).set('X-Claim-Code', ev.claimCode).send({}).expect(200);
    });
  });

  describe('exchange', () => {
    it('returns a manage token that edits the event for 15 minutes', async () => {
      const ev = await createGuest();
      const res = await t.http.post('/v1/claims/exchange').send({ code: ev.claimCode }).expect(200);
      expect(res.body.expiresIn).toBe(900);
      const claims = await verifyManageToken(res.body.manageToken, t.env.MANAGE_TOKEN_SECRET, t.clock.now());
      expect(claims.evt).toBe(ev.id);
      const identity = await db.selectFrom('guest_identities').select('id').executeTakeFirstOrThrow();
      expect(claims.sub).toBe(identity.id);

      const patch = (id: string) => t.http.patch(`/v1/events/${id}`).set('Authorization', `Manage ${res.body.manageToken}`).send({ area: 'Seaport' });
      expect((await patch(ev.id).expect(200)).body.area).toBe('Seaport');
      const other = await createGuest({ hostEmail: 'other@example.com' }, 'dev-2');
      expect((await patch(other.id).expect(401)).body.code).toBe('claim.invalid');

      t.clock.set(new Date(Date.parse(NOW) + 901_000));
      expect((await patch(ev.id).expect(401)).body.code).toBe('claim.invalid');
    });

    it('a wrong code is 401 claim.invalid and a malformed body is 422', async () => {
      expect((await t.http.post('/v1/claims/exchange').send({ code: wrong }).expect(401)).body.code).toBe('claim.invalid');
      await t.http.post('/v1/claims/exchange').send({}).expect(422);
    });

    it('the exchange of a code for a removed event is 401', async () => {
      const ev = await createGuest();
      await db.updateTable('events').set({ status: 'removed' }).where('id', '=', ev.id).execute();
      await t.http.post('/v1/claims/exchange').send({ code: ev.claimCode }).expect(401);
    });
  });

  describe('recover', () => {
    it('answers 202 ok for an unknown email and sends nothing', async () => {
      const res = await t.http.post('/v1/claims/recover').send({ email: 'nobody@example.com' }).expect(202);
      expect(res.body).toEqual({ status: 'ok' });
      await t.mailer.flush();
      expect(t.mailer.sent).toEqual([]);
    });

    it('rotates the code: the old code stops working, the emailed one works; one email lists every event', async () => {
      const a = await createGuest({ name: 'First event here' }, 'dev-1');
      const b = await createGuest({ name: 'Second event here' }, 'dev-2');
      const removed = await createGuest({ name: 'Removed event here' }, 'dev-3');
      await db.updateTable('events').set({ status: 'removed' }).where('id', '=', removed.id).execute();
      const other = await createGuest({ hostEmail: 'other@example.com' }, 'dev-4');
      t.mailer.clear();

      const res = await t.http.post('/v1/claims/recover').send({ email: ' Guest@EXAMPLE.com ' }).expect(202);
      expect(res.body).toEqual({ status: 'ok' });
      await t.mailer.flush();
      expect(t.mailer.sent).toHaveLength(1);
      const mail = t.mailer.sent[0]!;
      expect(mail.to).toBe('guest@example.com');
      expect(mail.text).toContain('First event here');
      expect(mail.text).toContain('Second event here');
      expect(mail.text).not.toContain('Removed event here');
      const codes = mail.text.match(/[0-9A-HJKMNP-TV-Z]{12}/g) ?? [];
      expect(codes).toHaveLength(2);
      expect(codes).not.toContain(a.claimCode);

      await t.http.patch(`/v1/events/${a.id}`).set('X-Claim-Code', a.claimCode).send({}).expect(401);
      const newA = new RegExp(`First event here[^0-9A-Z]*([0-9A-HJKMNP-TV-Z]{12})`).exec(mail.text)?.[1];
      await t.http.patch(`/v1/events/${a.id}`).set('X-Device-Id', 'x').set('X-Claim-Code', newA!).send({ area: 'New area' }).expect(200);
      // other guest untouched
      await t.http.patch(`/v1/events/${other.id}`).set('X-Claim-Code', other.claimCode).send({}).expect(200);
      void b;
    });

    it('is limited to 3 an hour per email and 10 an hour per IP (429 rate_limited)', async () => {
      for (let i = 0; i < 3; i++) await t.http.post('/v1/claims/recover').send({ email: 'a@example.com' }).expect(202);
      expect((await t.http.post('/v1/claims/recover').send({ email: 'A@example.com' }).expect(429)).body.code).toBe('rate_limited');
      // 3 accepted above; the refused hit was rolled back. Seven more emails bring the IP to 10.
      for (let i = 0; i < 7; i++) await t.http.post('/v1/claims/recover').send({ email: `b${i}@example.com` }).expect(202);
      expect((await t.http.post('/v1/claims/recover').send({ email: 'c@example.com' }).expect(429)).body.code).toBe('rate_limited');
    });

    it('rejects a malformed email with 422', async () => {
      await t.http.post('/v1/claims/recover').send({ email: 'nope' }).expect(422);
      await t.http.post('/v1/claims/recover').send({}).expect(422);
    });
  });

  it('hostEmail appears in no response body, outbox payload or audit row', async () => {
    const ev = await createGuest();
    const bodies = [
      (await t.http.patch(`/v1/events/${ev.id}`).set('X-Claim-Code', ev.claimCode).send({ area: 'Somewhere' }).expect(200)).body,
      (await t.http.post(`/v1/events/${ev.id}/cancel`).set('X-Claim-Code', ev.claimCode).expect(200)).body,
    ];
    expect(JSON.stringify(bodies)).not.toContain('guest@example.com');
    expect(JSON.stringify(await db.selectFrom('outbox').selectAll().execute())).not.toContain('guest@example.com');
    expect(JSON.stringify(await db.selectFrom('audit_log').selectAll().execute())).not.toContain('guest@example.com');
  });
});
