import sharp from 'sharp';
import type { Kysely } from 'kysely';
import type { Schema } from '../src/db/schema.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { fakeToken } from './support/fake-verifier.js';

async function jpegWithGps(width: number, height: number, orientation?: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3a7' } })
    .jpeg()
    .withMetadata(orientation ? { orientation } : {})
    .withExif({
      IFD0: { Copyright: 'someone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 45/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '73/1 59/1 0/1' },
    })
    .toBuffer();
}

describe('Media uploads (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  const auth = { Authorization: fakeToken({ uid: 'u1' }) };
  const other = { Authorization: fakeToken({ uid: 'u2' }) };

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
    t.storage.objects.clear();
  });

  const create = async (headers: Record<string, string> = auth) =>
    (await t.http.post('/v1/media/uploads').set(headers).send({ contentType: 'image/jpeg', sizeBytes: 1000 }).expect(201))
      .body.mediaId as string;
  const row = (id: string) => db.selectFrom('media').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  it('rejects image/gif', async () => {
    const res = await t.http.post('/v1/media/uploads').set(auth).send({ contentType: 'image/gif', sizeBytes: 1000 }).expect(422);
    expect(res.body.errors[0].code).toBe('image.type');
  });

  it('rejects a file over 5,242,880 bytes', async () => {
    const res = await t.http.post('/v1/media/uploads').set(auth).send({ contentType: 'image/jpeg', sizeBytes: 5_242_881 }).expect(422);
    expect(res.body.errors[0].code).toBe('image.too_large');
  });

  it('accepts exactly 5,242,880 bytes', async () => {
    await t.http.post('/v1/media/uploads').set(auth).send({ contentType: 'image/png', sizeBytes: 5_242_880 }).expect(201);
  });

  it('returns a presigned PUT and a pending media row owned by the user', async () => {
    const res = await t.http.post('/v1/media/uploads').set(auth).send({ contentType: 'image/webp', sizeBytes: 1000 }).expect(201);
    expect(res.body.upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/webp' } });
    expect(res.body.upload.url).toContain(`media/${res.body.mediaId}/original`);
    const r = await row(res.body.mediaId);
    expect(r).toMatchObject({ status: 'pending', owner_device_hash: null, s3_key: `media/${res.body.mediaId}/original` });
    expect(r.owner_user_id).not.toBeNull();
  });

  it('complete: a 900x900 JPEG with GPS EXIF becomes ready with no metadata', async () => {
    const id = await create();
    const original = await jpegWithGps(900, 900);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    t.storage.seed(id, original);
    const res = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(200);
    expect(res.body).toEqual({ id, status: 'ready', width: 900, height: 900 });
    const meta = await sharp(t.storage.read(`media/${id}/display.jpg`)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');
    expect(await row(id)).toMatchObject({ status: 'ready', s3_key: `media/${id}/display.jpg`, content_type: 'image/jpeg', width: 900, height: 900 });
  });

  it('complete is idempotent once ready', async () => {
    const id = await create();
    t.storage.seed(id, await jpegWithGps(900, 900));
    const first = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(200);
    const second = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(200);
    expect(second.body).toEqual(first.body);
  });

  it('complete applies EXIF orientation before the size check', async () => {
    const id = await create();
    t.storage.seed(id, await jpegWithGps(1200, 900, 6));
    const res = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(200);
    expect(res.body).toMatchObject({ width: 900, height: 1200 });
  });

  it('complete: 799x1200 is rejected with image.too_small and marked rejected', async () => {
    const id = await create();
    t.storage.seed(id, await jpegWithGps(799, 1200));
    const res = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(422);
    expect(res.body).toMatchObject({ code: 'validation_failed', errors: [{ code: 'image.too_small', field: 'file' }] });
    expect(await row(id)).toMatchObject({ status: 'rejected', reject_code: 'image.too_small' });
    const again = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(409);
    expect(again.body.code).toBe('media.not_pending');
  });

  it('complete: bytes that are not an image are rejected with image.type', async () => {
    const id = await create();
    t.storage.seed(id, Buffer.from('hello'));
    const res = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(422);
    expect(res.body.errors[0].code).toBe('image.type');
    expect(await row(id)).toMatchObject({ status: 'rejected', reject_code: 'image.type' });
  });

  it('complete: a GIF with a JPEG content type is rejected by its bytes', async () => {
    const id = await create();
    t.storage.seed(id, await sharp({ create: { width: 900, height: 900, channels: 3, background: '#fff' } }).gif().toBuffer());
    const res = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(422);
    expect(res.body.errors[0].code).toBe('image.type');
  });

  it('complete before the file is uploaded is 422 photo.not_ready and stays pending', async () => {
    const id = await create();
    const res = await t.http.post(`/v1/media/${id}/complete`).set(auth).expect(422);
    expect(res.body.errors[0].code).toBe('photo.not_ready');
    expect((await row(id)).status).toBe('pending');
  });

  it('another user cannot complete my media (404), nor can an unknown or malformed id', async () => {
    const id = await create();
    t.storage.seed(id, await jpegWithGps(900, 900));
    await t.http.post(`/v1/media/${id}/complete`).set(other).expect(404);
    await t.http.post(`/v1/media/${id}/complete`).set({ 'X-Device-Id': 'dev-1' }).expect(404);
    await t.http.post('/v1/media/00000000-0000-7000-8000-000000000000/complete').set(auth).expect(404);
    await t.http.post('/v1/media/not-a-uuid/complete').set(auth).expect(404);
    expect((await row(id)).status).toBe('pending');
  });

  it('a guest needs X-Device-Id', async () => {
    const res = await t.http.post('/v1/media/uploads').send({ contentType: 'image/jpeg', sizeBytes: 1000 }).expect(422);
    expect(res.body).toMatchObject({ code: 'device.required', field: 'X-Device-Id' });
  });

  it('a guest uploads and completes by device; another device gets 404; the 21st upload in an hour is 429', async () => {
    const dev = { 'X-Device-Id': 'device-aaaa' };
    const id = await create(dev);
    const r = await row(id);
    expect(r.owner_user_id).toBeNull();
    expect(r.owner_device_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.owner_device_hash).not.toContain('device-aaaa');
    t.storage.seed(id, await jpegWithGps(900, 900));
    await t.http.post(`/v1/media/${id}/complete`).set({ 'X-Device-Id': 'device-bbbb' }).expect(404);
    await t.http.post(`/v1/media/${id}/complete`).set(dev).expect(200);

    for (let i = 0; i < 19; i++) await create(dev);
    const res = await t.http.post('/v1/media/uploads').set(dev).send({ contentType: 'image/jpeg', sizeBytes: 1000 }).expect(429);
    expect(res.body.code).toBe('rate_limited');
    await create({ 'X-Device-Id': 'device-bbbb' });
  });

  it('signed-in users are limited to 20 uploads an hour as well', async () => {
    for (let i = 0; i < 20; i++) await create();
    await t.http.post('/v1/media/uploads').set(auth).send({ contentType: 'image/jpeg', sizeBytes: 1000 }).expect(429);
    await create(other);
  });
});
