import { Controller, Get, Module } from '@nestjs/common';
import { Roles } from '../src/auth/roles.decorator.js';
import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../src/db/schema.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { fakeToken } from './support/fake-verifier.js';

@Controller('test-reviewer')
class ReviewerOnlyController {
  @Get()
  @Roles('reviewer')
  get() {
    return { ok: true };
  }
}

@Module({ controllers: [ReviewerOnlyController] })
class ReviewerOnlyModule {}

describe('Auth and /v1/me (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  const auth = {
    Authorization: fakeToken({ uid: 'u1', email: 'priya@example.com' }),
  };

  beforeAll(async () => {
    db = getTestDb();
    t = await createTestApp({}, { imports: [ReviewerOnlyModule] });
  });
  afterAll(async () => {
    await t.app.close();
    await closeTestDbs();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it('GET /v1/me without a token is 401 auth.required', async () => {
    expect((await t.http.get('/v1/me').expect(401)).body.code).toBe(
      'auth.required',
    );
  });

  it('an invalid token is 401 auth.invalid_token', async () => {
    expect(
      (
        await t.http
          .get('/v1/me')
          .set('Authorization', 'Bearer nope')
          .expect(401)
      ).body.code,
    ).toBe('auth.invalid_token');
  });

  it('an invalid token on an unmarked (optional) route is still 401 auth.invalid_token', async () => {
    expect(
      (
        await t.http
          .get('/v1/health')
          .set('Authorization', 'Bearer nope')
          .expect(401)
      ).body.code,
    ).toBe('auth.invalid_token');
  });

  it('a Manage scheme header is ignored by the guard', async () => {
    await t.http
      .get('/v1/health')
      .set('Authorization', 'Manage abc')
      .expect(200);
  });

  it('first request creates the user row', async () => {
    const res = await t.http.get('/v1/me').set(auth).expect(200);
    expect(res.body).toMatchObject({
      email: 'priya@example.com',
      roles: [],
      localId: null,
      emailVerified: true,
    });
    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(1);
  });

  it('concurrent first requests create a single row', async () => {
    const responses = await Promise.all(
      [1, 2, 3, 4].map(() => t.http.get('/v1/me').set(auth)),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(1);
  });

  it('a verified email held by another Firebase uid relinks that row to the new uid', async () => {
    await t.http.get('/v1/me').set(auth).expect(200);
    const before = await db.selectFrom('users').select('id').where('firebase_uid', '=', 'u1').executeTakeFirstOrThrow();
    const relinked = { Authorization: fakeToken({ uid: 'u1-new', email: 'Priya@example.com' }) };
    const res = await t.http.get('/v1/me').set(relinked).expect(200);
    expect(res.body).toMatchObject({ id: before.id, emailVerified: true });
    const rows = await db.selectFrom('users').select(['id', 'firebase_uid']).execute();
    expect(rows).toEqual([{ id: before.id, firebase_uid: 'u1-new' }]);
    await t.http.get('/v1/me').set(relinked).expect(200);
  });

  it('an unverified email held by another Firebase uid is 401 auth.email_in_use, not a 500', async () => {
    await t.http.get('/v1/me').set(auth).expect(200);
    const res = await t.http
      .get('/v1/me')
      .set({ Authorization: fakeToken({ uid: 'u9', email: 'priya@example.com', emailVerified: false }) })
      .expect(401);
    expect(res.body).toMatchObject({
      code: 'auth.email_in_use',
      message: 'This email is already linked to another account.',
    });
    const rows = await db.selectFrom('users').select('firebase_uid').execute();
    expect(rows).toEqual([{ firebase_uid: 'u1' }]);
  });

  it('changing to an email another account holds is 401 auth.email_in_use, even when verified', async () => {
    await t.http.get('/v1/me').set(auth).expect(200);
    await t.http.get('/v1/me').set({ Authorization: fakeToken({ uid: 'u2', email: 'other@example.com' }) }).expect(200);
    const res = await t.http
      .get('/v1/me')
      .set({ Authorization: fakeToken({ uid: 'u2', email: 'priya@example.com' }) })
      .expect(401);
    expect(res.body.code).toBe('auth.email_in_use');
  });

  async function makeLocal(verified: boolean): Promise<string> {
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('firebase_uid', '=', 'u1')
      .executeTakeFirstOrThrow();
    const id = uuidv7();
    await db
      .insertInto('locals')
      .values({
        id,
        user_id: user.id,
        display_name: 'Priya',
        role_title: 'Guide',
        bio: 'Lives here',
        verified_at: verified ? new Date() : null,
      })
      .execute();
    return id;
  }

  it('a verified locals row grants the local role', async () => {
    await t.http.get('/v1/me').set(auth).expect(200);
    const localId = await makeLocal(true);
    const res = await t.http.get('/v1/me').set(auth).expect(200);
    expect(res.body.roles).toEqual(['local']);
    expect(res.body.localId).toBe(localId);
  });

  it('an unverified locals row does not grant the local role', async () => {
    await t.http.get('/v1/me').set(auth).expect(200);
    await makeLocal(false);
    expect(
      (await t.http.get('/v1/me').set(auth).expect(200)).body.roles,
    ).toEqual([]);
  });

  it('the reviewer claim grants the reviewer role; a local row does not', async () => {
    const reviewer = {
      Authorization: fakeToken({ uid: 'r1', roles: ['reviewer'] }),
    };
    expect(
      (await t.http.get('/v1/me').set(reviewer).expect(200)).body.roles,
    ).toEqual(['reviewer']);
    await t.http.get('/v1/me').set(auth).expect(200);
    await makeLocal(true);
    expect(
      (await t.http.get('/v1/me').set(auth).expect(200)).body.roles,
    ).toEqual(['local']);
  });

  it('a "local" claim alone never grants local', async () => {
    const h = { Authorization: fakeToken({ uid: 'c1', roles: ['local'] }) };
    expect((await t.http.get('/v1/me').set(h).expect(200)).body.roles).toEqual(
      [],
    );
  });

  it('a traveler gets 403 on a reviewer-only route; a reviewer gets 200; anonymous gets 401', async () => {
    const res = await t.http.get('/v1/test-reviewer').set(auth).expect(403);
    expect(res.body.code).toBe('forbidden');
    await t.http
      .get('/v1/test-reviewer')
      .set({ Authorization: fakeToken({ uid: 'r1', roles: ['reviewer'] }) })
      .expect(200);
    expect((await t.http.get('/v1/test-reviewer').expect(401)).body.code).toBe(
      'auth.required',
    );
  });

  it('PATCH /v1/me stores socials and strips @', async () => {
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ socials: { instagram: '@priya.k' } })
      .expect(200);
    expect(res.body.socials.instagram).toBe('priya.k');
  });

  it('PATCH /v1/me removes a handle with an empty string or null and keeps the others', async () => {
    await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ socials: { instagram: 'priya.k', x: 'priya' } })
      .expect(200);
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ socials: { instagram: '', x: null } })
      .expect(200);
    expect(res.body.socials).toEqual({});
    const kept = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ socials: { tiktok: 'priya' } })
      .expect(200);
    expect(kept.body.socials).toEqual({ tiktok: 'priya' });
  });

  it('PATCH /v1/me updates firstName and tz', async () => {
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ firstName: 'Priya', tz: 'Asia/Colombo' })
      .expect(200);
    expect(res.body).toMatchObject({ firstName: 'Priya', tz: 'Asia/Colombo' });
  });

  it('PATCH /v1/me rejects a 16-character X handle', async () => {
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ socials: { x: 'abcdefghijklmnop' } })
      .expect(422);
    expect(res.body.errors[0]).toMatchObject({
      code: 'socials.x.invalid',
      field: 'socials.x',
    });
  });

  it('PATCH /v1/me rejects an unknown socials key with field.unknown', async () => {
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ socials: { myspace: 'priya' } })
      .expect(422);
    expect(res.body.errors[0]).toMatchObject({
      code: 'field.unknown',
      field: 'socials.myspace',
    });
  });

  it('PATCH /v1/me rejects an unknown time zone', async () => {
    expect(
      (
        await t.http
          .patch('/v1/me')
          .set(auth)
          .send({ tz: 'Mars/Base' })
          .expect(422)
      ).body.errors[0].code,
    ).toBe('tz.invalid');
  });

  it('PATCH /v1/me rejects a too-short firstName', async () => {
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ firstName: 'P' })
      .expect(422);
    expect(res.body.errors[0]).toMatchObject({
      code: 'firstName.too_short',
      field: 'firstName',
    });
  });

  it('PATCH /v1/me rejects a null firstName', async () => {
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ firstName: null })
      .expect(422);
    expect(res.body.errors[0]).toMatchObject({
      code: 'firstName.required',
      field: 'firstName',
    });
  });

  it('PATCH /v1/me rejects a null tz', async () => {
    const res = await t.http
      .patch('/v1/me')
      .set(auth)
      .send({ tz: null })
      .expect(422);
    expect(res.body.errors[0]).toMatchObject({
      code: 'tz.invalid',
      field: 'tz',
    });
  });
});
