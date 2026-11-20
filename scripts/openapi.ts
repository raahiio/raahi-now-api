// Compiled by tsc to dist-openapi/scripts (decorator metadata is needed for DI), so ../../ is the repo root.
// Writes openapi.json. Needs no database: the pg pools connect lazily and nothing here queries.
// The env values are placeholders, used only when the variable is not already set.
const placeholders: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://openapi:openapi@127.0.0.1:1/openapi',
  DATABASE_PUBLIC_URL: 'postgres://openapi:openapi@127.0.0.1:1/openapi',
  S3_BUCKET: 'openapi',
  S3_REGION: 'ap-south-1',
  SES_FROM: 'no-reply@example.com',
  CLAIM_CODE_SECRET: 'openapi-claim-code-secret-0123456789abcdef',
  MANAGE_TOKEN_SECRET: 'openapi-manage-token-secret-0123456789abcdef',
  DEVICE_HASH_SALT: 'openapi',
  FIREBASE_PROJECT_ID: 'openapi',
  JOBS_ENABLED: 'false',
};
for (const [key, value] of Object.entries(placeholders)) process.env[key] ??= value;

const { writeFile } = await import('node:fs/promises');
const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../src/app.module.js');
const { configureApp } = await import('../src/configure-app.js');
const { buildOpenApi } = await import('../src/openapi.js');

const app = await NestFactory.create(AppModule, { logger: ['error'] });
configureApp(app);
const doc = buildOpenApi(app);
await writeFile(new URL('../../openapi.json', import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
await app.close();
console.log(`openapi.json written (${Object.keys(doc.paths).length} paths)`);
