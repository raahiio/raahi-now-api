export const PUBLIC_TEST_ROLE = 'raahi_public_test';
export const PUBLIC_TEST_PASSWORD = 'test';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required to run e2e tests');
  return url;
}

/** Same database as TEST_DATABASE_URL, connecting as the restricted public-read login role. */
export function testPublicDatabaseUrl(): string {
  const u = new URL(testDatabaseUrl());
  u.username = PUBLIC_TEST_ROLE;
  u.password = PUBLIC_TEST_PASSWORD;
  return u.toString();
}
