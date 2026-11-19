import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { AppModule } from '../../src/app.module.js';
import { ENV } from '../../src/config/config.module.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { configureApp } from '../../src/configure-app.js';
import { testDatabaseUrl, testPublicDatabaseUrl } from './urls.js';

export interface TestApp {
  app: INestApplication;
  http: TestAgent;
  env: Env;
}

const FIXED_TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  S3_BUCKET: 'raahi-test-bucket',
  S3_REGION: 'ap-south-1',
  SES_FROM: 'no-reply@raahi.test',
  CLAIM_CODE_SECRET: 'test-claim-code-secret-0123456789abcdef',
  MANAGE_TOKEN_SECRET: 'test-manage-token-secret-0123456789abcdef',
  DEVICE_HASH_SALT: 'test-device-hash-salt',
  FIREBASE_PROJECT_ID: 'raahi-test',
  JOBS_ENABLED: 'false',
};

export interface TestAppOptions {
  /** Extra modules (e.g. a test-only controller module) imported next to AppModule. */
  imports?: NonNullable<ModuleMetadata['imports']>;
}

export async function createTestApp(
  overrides: Record<string, string | undefined> = {},
  options: TestAppOptions = {},
): Promise<TestApp> {
  const env = loadEnv({
    ...FIXED_TEST_ENV,
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_PUBLIC_URL: testPublicDatabaseUrl(),
    ...overrides,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...(options.imports ?? [])] })
    .overrideProvider(ENV)
    .useValue(env)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return { app, http: request(app.getHttpServer()), env };
}
