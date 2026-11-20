import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { IdTokenVerifier } from '../../src/auth/id-token-verifier.js';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/common/clock.js';
import { ENV } from '../../src/config/config.module.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { configureApp } from '../../src/configure-app.js';
import { EventPublisher } from '../../src/outbox/event-publisher.js';
import { Mailer } from '../../src/mail/mailer.js';
import { ObjectStorage } from '../../src/media/object-storage.js';
import { CapturingMailer } from './capturing-mailer.js';
import { CapturingPublisher } from './capturing-publisher.js';
import { FakeVerifier } from './fake-verifier.js';
import { FixedClock } from './fixed-clock.js';
import { MemoryStorage } from './memory-storage.js';
import { testDatabaseUrl, testPublicDatabaseUrl } from './urls.js';

export interface TestApp {
  app: INestApplication;
  http: TestAgent;
  env: Env;
  storage: MemoryStorage;
  clock: FixedClock;
  mailer: CapturingMailer;
  publisher: CapturingPublisher;
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

  const storage = new MemoryStorage();
  const clock = new FixedClock();
  const mailer = new CapturingMailer();
  const publisher = new CapturingPublisher();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(IdTokenVerifier)
    .useValue(new FakeVerifier())
    .overrideProvider(ObjectStorage)
    .useValue(storage)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(EventPublisher)
    .useValue(publisher)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return { app, http: request(app.getHttpServer()), env, storage, clock, mailer, publisher };
}
