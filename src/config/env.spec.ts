import { loadEnv } from './env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/raahi_now',
  DATABASE_PUBLIC_URL: 'postgres://public:public@localhost:5432/raahi_now',
  S3_BUCKET: 'bucket',
  S3_REGION: 'ap-south-1',
  SES_FROM: 'no-reply@example.com',
  CLAIM_CODE_SECRET: 'c'.repeat(32),
  MANAGE_TOKEN_SECRET: 'm'.repeat(32),
  DEVICE_HASH_SALT: 'salt',
  FIREBASE_PROJECT_ID: 'raahi-test',
};

describe('loadEnv', () => {
  it('loadEnv names every missing required variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL.*DATABASE_PUBLIC_URL.*CLAIM_CODE_SECRET/s);
  });

  it('loadEnv applies defaults', () => {
    const env = loadEnv({ ...validEnv });
    expect(env.PORT).toBe(3000);
    expect(env.JOBS_ENABLED).toBe(true);
  });

  it('loadEnv rejects a claim secret shorter than 32 characters', () => {
    expect(() => loadEnv({ ...validEnv, CLAIM_CODE_SECRET: 'short' })).toThrow(/CLAIM_CODE_SECRET/);
  });

  it('loadEnv parses PORT and JOBS_ENABLED overrides', () => {
    const env = loadEnv({ ...validEnv, PORT: '4100', JOBS_ENABLED: 'false' });
    expect(env.PORT).toBe(4100);
    expect(env.JOBS_ENABLED).toBe(false);
  });

  it('loadEnv reads the optional SES_REGION', () => {
    expect(loadEnv({ ...validEnv }).SES_REGION).toBeUndefined();
    expect(loadEnv({ ...validEnv, SES_REGION: '' }).SES_REGION).toBeUndefined();
    expect(loadEnv({ ...validEnv, SES_REGION: 'us-east-1' }).SES_REGION).toBe('us-east-1');
  });

  it('loadEnv reads the optional MEDIA_BASE_URL', () => {
    expect(loadEnv({ ...validEnv }).MEDIA_BASE_URL).toBeUndefined();
    expect(loadEnv({ ...validEnv, MEDIA_BASE_URL: 'https://cdn.raahi.test' }).MEDIA_BASE_URL).toBe('https://cdn.raahi.test');
  });

  it('loadEnv parses TRUST_PROXY as a hop count, defaults to 0 and rejects bad values', () => {
    expect(loadEnv({ ...validEnv }).TRUST_PROXY).toBe(0);
    expect(loadEnv({ ...validEnv, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    for (const bad of ['-1', '1.5', 'yes']) {
      expect(() => loadEnv({ ...validEnv, TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    }
  });
});
