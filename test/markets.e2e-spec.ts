import { MarketsService } from '../src/markets/markets.service.js';
import { closeTestDbs } from './support/db.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { fakeToken } from './support/fake-verifier.js';

describe('Markets (e2e)', () => {
  let t: TestApp;
  let service: MarketsService;

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(MarketsService);
  });
  afterAll(async () => {
    await t.app.close();
    await closeTestDbs();
  });

  it('lists the five seeded markets ordered by city', async () => {
    const res = await t.http.get('/v1/markets').expect(200);
    expect(res.body.items).toHaveLength(5);
    const cities = res.body.items.map((m: { city: string }) => m.city);
    expect(cities).toEqual([...cities].sort((a, b) => a.localeCompare(b)));
  });

  it('returns zone, reset time and currency for each market', async () => {
    const res = await t.http.get('/v1/markets').expect(200);
    const boston = res.body.items.find(
      (m: { id: string }) => m.id === 'boston',
    );
    expect(boston).toEqual({
      id: 'boston',
      city: 'Boston',
      country: 'US',
      tz: 'America/New_York',
      resetTime: '06:00',
      currency: 'USD',
      status: 'open',
    });
  });

  it('anonymous list responses are publicly cacheable and vary on Authorization', async () => {
    const res = await t.http.get('/v1/markets').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=15');
    expect(res.headers['vary']).toBe('Authorization');
  });

  it('authenticated list responses are private and not stored, still vary on Authorization', async () => {
    const res = await t.http
      .get('/v1/markets')
      .set('Authorization', fakeToken({ uid: 'm1', email: 'm1@example.com' }))
      .expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['vary']).toBe('Authorization');
  });

  it('require() returns a known market', async () => {
    await expect(service.require('kyoto')).resolves.toMatchObject({
      id: 'kyoto',
      status: 'preview',
      resetTime: '06:00',
    });
  });

  it('require() throws market.invalid on marketId for an unknown id', async () => {
    await expect(service.require('atlantis')).rejects.toMatchObject({
      status: 422,
      code: 'market.invalid',
      field: 'marketId',
    });
  });
});
