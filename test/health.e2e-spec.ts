import { createTestApp, type TestApp } from './support/create-test-app.js';

describe('Health (e2e)', () => {
  let t: TestApp;
  afterEach(async () => {
    await t?.app.close();
  });

  it('GET /v1/health returns ok', async () => {
    t = await createTestApp();
    await t.http.get('/v1/health').expect(200, { status: 'ok' });
  });
});
