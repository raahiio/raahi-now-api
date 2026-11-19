# Raahi NOW Phase 1 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 backend for Raahi NOW: foundations, Drop and event creation, review, and public listing, as a TypeScript NestJS API.

**Architecture:** One NestJS modular monolith over PostgreSQL, using Kysely for typed SQL. Public list and detail queries run on a separate, read-restricted database role that cannot read private text. Ports (interfaces) isolate Firebase, S3, SES and the event bus so tests run on fakes.

**Tech Stack:** Node 22, NestJS 12 (ESM), TypeScript, Kysely + pg, PostgreSQL 16, class-validator, @nestjs/swagger, luxon, sharp, jose, vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-11-19-raahi-now-phase1-spec.md` (binding). Background: the backend plan at https://claude.ai/artifact/FjQLhZq9gQWPsD9SofPFHL.

## Global Constraints

- Node `>=22`. The module system is ESM: `"type": "module"`, `nodenext`, relative imports end in `.js`. Keep what `nest new` generates; do not switch to CommonJS.
- Test runner is vitest (the Nest 12 scaffold default): `npm test` runs `*.spec.ts` (no database); `npm run test:e2e` runs `test/*.e2e-spec.ts` against a real PostgreSQL 16 at `TEST_DATABASE_URL`. Linter is oxlint (`npm run lint`).
- Pins: `@nestjs/common`, `core`, `platform-express`, `testing` 12.5.1; `@nestjs/cli` 12.0.13; `@nestjs/config` 12.1.1; `@nestjs/swagger` 12.1.2; `@nestjs/schedule` 12.0.4; `kysely` 0.29.9; `pg` 8.23.1; `luxon` 3.7.2; `sharp` 0.35.5; `firebase-admin` 14.5.1; `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sesv2` 3.1172.0; `jose` 6.2.18; `class-validator` 0.15.1; `class-transformer` 0.5.1; `uuidv7` 1.2.1; dev `@apidevtools/swagger-parser` 13.1.0. TypeScript stays at the scaffold's `^6`, not 7.
- `.npmrc` contains `legacy-peer-deps=true`. Without it `npm install` crashes with "Cannot read properties of null (reading 'edgesOut')" on this dependency tree.
- Base path `/v1`. Error body `{ code, field?, message, requestId }`; validation 422 `{ code: "validation_failed", errors: [{ code, field, message }], requestId }`.
- Every limit, enum, message and state table in the spec is used exactly. Messages live in one map, `src/common/errors/messages.ts`.
- Public responses never contain `exactPlace`, `meetDetail`, `exactAddress` (unless the event's visibility is `public`), `hostEmail`, `claimCode` or `claim_hash`.
- Commit messages use conventional commits (`feat:`, `test:`, `chore:`).

## Planning rulings

Decisions made while writing this plan, each with what it costs if wrong.

- **Vitest, oxlint, TypeScript 6, ESM, not Jest/CommonJS.** The Nest 12 scaffold generates them and its tests pass here. Cost: none.
- **class-validator and @nestjs/swagger, not Zod.** `nestjs-zod` 5.6.0 does not list Nest 12 or swagger 12 as peers. Cost if wrong: swap the DTO layer later.
- **Kysely.** Plain typed SQL fits the conditional updates, partial indexes and role grants the design needs. Cost: hand-written table types.
- **Idempotency moves to Phase 2.** Its first caller is unlock. Cost: none in Phase 1.
- **`removed` is a Drop status**, so removed items return 404 to non-owners. The backend plan's status list lacked it.
- **A text edit on a live Drop hides it while pending**, the simpler option in the backend plan's decision 5. Cost if wrong: a Drop disappears mid-window until review; the revision approach adds a `drop_revisions` table.
- **Paused Drops keep their clock running.** Cost if wrong: add `paused_at` and extend `expires_at` on resume.
- **Image processing runs inside the API on `complete`.** The `ImageProcessor` port lets a worker replace it. Cost: request latency on large images.
- **Rate limits are counted in a `rate_events` table**, not an in-memory throttler, so they hold across API instances.
- **Unlock price stays in credits in the API** and is stored as `credits × 100` minor units in USD. Phase 2 maps it to the booking engine.
- **Markets use slug ids.** Stable and readable. Cost: none.

## Review Focus

Input classes the spec implies and the plan's per-feature tests do not fully cover. Each has a test in the owning task.

1. **Wall-clock times at daylight-saving changes and in half-hour zones** (Colombo is UTC+5:30). A nonexistent or repeated time must return 422, never a silently shifted time. Task 4, Task 12.
2. **Two reviewers approving the same item at once.** Exactly one success, one outbox event. Task 10.
3. **Private text echoed in errors.** A validation error for a Drop must never contain the submitted `exactPlace`. Task 9.
4. **Unicode and whitespace lengths.** Emoji count as one character; a title of spaces fails the minimum; HTML is stripped before counting. Task 5, Task 9.
5. **Tampered cursors and out-of-range limits.** Return 422, never a 500 or an unbounded page. Task 11.

---

### Task 1: Scaffold, config and health

**Files:**
- Create (via scaffold, then trimmed): `package.json`, `tsconfig.json`, `nest-cli.json`, `vitest.config.ts`, `vitest.config.e2e.ts`
- Create: `.npmrc`, `.gitignore`, `.env.example`, `docker-compose.yml`, `README.md` (stub), `src/configure-app.ts`, `src/config/env.ts`, `src/config/config.module.ts`, `src/health/health.controller.ts`, `src/health/health.module.ts`, `test/support/create-test-app.ts`
- Modify: `src/app.module.ts`, `src/main.ts`
- Delete: `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, `test/app.e2e-spec.ts`
- Test: `src/config/env.spec.ts`, `test/health.e2e-spec.ts`

**Interfaces:**
- Produces: `loadEnv(source: Record<string, string | undefined>): Env`, where `Env` has `NODE_ENV`, `PORT` (number, default 3000), `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `S3_BUCKET`, `S3_REGION`, `SES_FROM`, `CLAIM_CODE_SECRET`, `MANAGE_TOKEN_SECRET` (both at least 32 characters), `DEVICE_HASH_SALT`, `FIREBASE_PROJECT_ID`, `JOBS_ENABLED` (boolean, default true). Throws one `Error` naming every missing variable.
- Produces: `configureApp(app: INestApplication): void` (global prefix `v1`), `createTestApp(overrides?): Promise<TestApp>` in `test/support/create-test-app.ts`.
- Produces: `GET /v1/health` returning `{ status: "ok" }`.

- [ ] **Step 1: Scaffold.** In a temp directory run `npx --yes @nestjs/cli@12.0.13 new scaffold --package-manager npm --skip-git --strict`, move its contents into the repo root (the `docs/` folder stays), create `.npmrc` first with `legacy-peer-deps=true`, then `npm install --no-audit --no-fund`.
- [ ] **Step 2: Confirm the baseline.** Run `npm test` and `npm run test:e2e`. Expected: 1 test passes in each. Then delete the sample controller, service and their tests.
- [ ] **Step 3: Write the failing tests.**

```ts
// src/config/env.spec.ts
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
// test/health.e2e-spec.ts
it('GET /v1/health returns ok', async () => {
  const { http } = await createTestApp();
  await http.get('/v1/health').expect(200, { status: 'ok' });
});
```

- [ ] **Step 4: Run to verify they fail.** `npx vitest run src/config/env.spec.ts` and `npx vitest run --config ./vitest.config.e2e.ts test/health.e2e-spec.ts`. Expected: FAIL (modules not found).
- [ ] **Step 5: Implement** `loadEnv`, `configureApp`, the health module, and `createTestApp` (builds the Nest app from `AppModule`, calls `configureApp`, returns `{ app, http }` where `http` is a supertest agent). `docker-compose.yml` runs `postgres:16` with database `raahi_now` and a second database `raahi_now_test`; `.env.example` lists every `Env` variable. Make sure the scaffold's `lint` script runs `oxlint --type-aware src/ test/` and passes.
- [ ] **Step 6: Run `npm test`, `npm run test:e2e` (with `TEST_DATABASE_URL` set) and `npm run lint`.** Expected: all pass, lint clean.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "chore: scaffold Nest 12 app with config and health endpoint"`

---

### Task 2: Database layer, Phase 1 schema, roles

**Files:**
- Create: `src/db/db.module.ts`, `src/db/tokens.ts`, `src/db/schema.ts`, `src/db/migrate.ts`, `src/db/migrations/001_phase1.ts`, `test/support/global-setup.ts`, `test/support/db.ts`
- Modify: `vitest.config.e2e.ts` (add `globalSetup`, `fileParallelism: false`), `src/app.module.ts`, `src/config/env.ts` (no change if complete), `docker-compose.yml`
- Test: `test/schema.e2e-spec.ts`

**Interfaces:**
- Produces: `export const DB = Symbol('DB')` (app role, read-write) and `export const PUBLIC_DB = Symbol('PUBLIC_DB')` (public-read role). Both inject `Kysely<Schema>`.
- Produces: `Schema` (Kysely table interfaces for every table in spec §9). `migrateToLatest(db: Kysely<unknown>): Promise<void>`.
- Produces (test): `getTestDb(): Kysely<Schema>`, `getTestPublicDb(): Kysely<Schema>` (the same database as login role `raahi_public_test`, password `test`, member of `raahi_public_read`), `resetDb(db): Promise<void>` (truncates every table except `markets`).

- [ ] **Step 1: Write the failing tests** in `test/schema.e2e-spec.ts`:

```ts
it('creates every Phase 1 table', async () => {
  const names = await tableNames(db);
  expect(names).toEqual(expect.arrayContaining(['users','locals','markets','media','drops','drop_private','events','event_private','guest_identities','review_items','outbox','rate_events','audit_log']));
});
it('seeds the five markets', async () => {
  const rows = await db.selectFrom('markets').select(['id','tz','status']).orderBy('id').execute();
  expect(rows.map(r => r.id)).toEqual(['boston','ellsworth-acadia','kyoto','new-york-city','sigiriya']);
  expect(rows.find(r => r.id === 'sigiriya')).toMatchObject({ tz: 'Asia/Colombo', status: 'preview' });
});
it('public role can read drops but not drop_private', async () => {
  await expect(publicDb.selectFrom('drops').select('title').execute()).resolves.toEqual([]);
  await expect(publicDb.selectFrom('drop_private').selectAll().execute()).rejects.toThrow(/permission denied/);
});
it('public role cannot read users, guest_identities, outbox or events.owner_user_id', async () => {
  for (const t of ['users','guest_identities','outbox','review_items','rate_events','audit_log','event_private'])
    await expect(publicDb.selectFrom(t as any).selectAll().execute()).rejects.toThrow(/permission denied/);
  await expect(publicDb.selectFrom('events').select('owner_user_id').execute()).rejects.toThrow(/permission denied/);
});
it('rejects window_hours 5', async () => { await expect(insertDrop({ window_hours: 5 })).rejects.toThrow(/check/i); });
it('rejects cost_max_usd below cost_min_usd', async () => { await expect(insertDrop({ cost_min_usd: 10, cost_max_usd: 5 })).rejects.toThrow(/check/i); });
it('rejects time_minutes 20', async () => { await expect(insertDrop({ time_minutes: 20 })).rejects.toThrow(/check/i); });
it('rejects an event ending more than 24 hours after it starts', async () => { await expect(insertEvent({ endsOffsetHours: 25 })).rejects.toThrow(/check/i); });
it('rejects an event with both owner_user_id and guest_identity_id', async () => { await expect(insertEvent({ both: true })).rejects.toThrow(/check/i); });
it('allows only one pending review row per item', async () => { /* insert twice for the same (kind, ref_id) */ });
```

- [ ] **Step 2: Run to verify failure.** `TEST_DATABASE_URL=... npx vitest run --config ./vitest.config.e2e.ts test/schema.e2e-spec.ts`. Expected: FAIL (no migrations).
- [ ] **Step 3: Implement** the migration so the schema equals spec §9 exactly, including checks, indexes, the seeded markets (spec §4), the group role `raahi_public_read` (created `NOLOGIN` if absent) and its grants (spec §9, "Database roles"). `global-setup.ts` resets the `public` schema, runs `migrateToLatest`, and creates login role `raahi_public_test` if absent. `db.module.ts` provides `DB` from `DATABASE_URL` and `PUBLIC_DB` from `DATABASE_PUBLIC_URL`, each a `pg.Pool` behind `Kysely`.
- [ ] **Step 4: Run to verify they pass**, then the whole suite and lint. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(db): Phase 1 schema, seeded markets and public-read role"`

---

### Task 3: Error model, request id and validation pipe

**Files:**
- Create: `src/common/errors/app-error.ts`, `src/common/errors/messages.ts`, `src/common/errors/all-exceptions.filter.ts`, `src/common/request-id.middleware.ts`, `src/common/validation.ts`
- Modify: `src/configure-app.ts`
- Test: `src/common/errors/messages.spec.ts`, `test/errors.e2e-spec.ts`

**Interfaces:**
- Produces: `class AppError extends Error { constructor(status: number, code: string, field?: string, vars?: Record<string,string|number>) }`.
- Produces: `MESSAGES: Record<string, string>` (spec §10, with `{min}`, `{max}`, `{email}` placeholders) and `messageFor(code: string, vars?): string`. Generic fallbacks: `<field>.too_short`, `.too_long`, `.required`, `.range` when the exact code has no entry.
- Produces: `createValidationPipe(): ValidationPipe` (whitelist, forbid unknown fields, `exceptionFactory` mapping every class-validator constraint to `{ code, field, message }`). Every decorator in this repo sets the constraint `message` to the error **code**, for example `@MinLength(5, { message: 'title.too_short' })` and `@MaxLength(80, { message: 'title.too_long' })`; the pipe looks the text up with `messageFor`.
- Produces: header `X-Request-Id` echoed, or generated as UUIDv7.

- [ ] **Step 1: Write the failing tests.**

```ts
// messages.spec.ts
it('messageFor returns the spec text', () => expect(messageFor('start.too_soon')).toBe('Pick a start at least 30 minutes from now.'));
it('messageFor fills placeholders', () => expect(messageFor('event.guest_submitted', { email: 'a@b.co' })).toBe("Thanks! We'll take a quick look before it goes up, and email you at a@b.co."));
it('messageFor falls back to the generic field messages', () => expect(messageFor('area.too_short', { min: 2 })).toBe('Add at least 2 characters.'));
// errors.e2e-spec.ts (uses a test-only controller registered by the spec)
it('AppError renders code, message and requestId', async () => { /* 404 'drop.invalid_transition'-style code → body has code, message, requestId */ });
it('validation failure returns 422 with one entry per violated field', async () => {
  const res = await http.post('/v1/__test/validate').send({ title: 'abc' }).expect(422);
  expect(res.body).toMatchObject({ code: 'validation_failed', errors: [{ code: 'title.too_short', field: 'title' }] });
});
it('rejects unknown fields', async () => { /* 422 with code 'field.unknown' */ });
it('echoes X-Request-Id and generates one when absent', async () => { /* both cases */ });
it('unhandled errors return 500 internal_error with no stack', async () => { expect(res.body).not.toHaveProperty('stack'); });
it('a validation error never echoes the submitted value', async () => {
  const res = await http.post('/v1/__test/validate').send({ title: 'abc', secret: 'SECRET-123' });
  expect(JSON.stringify(res.body)).not.toContain('SECRET-123');
});
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.
- [ ] **Step 3: Implement** the files above and register the filter, pipe and middleware in `configureApp`.
- [ ] **Step 4: Run to verify pass**, then full suite. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(common): error model, messages, request id and validation pipe"`

---

### Task 4: Wall-clock time in market zones

**Files:**
- Create: `src/common/time/wall-clock.ts`
- Test: `src/common/time/wall-clock.spec.ts`

**Interfaces:**
- Produces: `class WallClockError extends Error { readonly kind: 'invalid' | 'nonexistent' | 'ambiguous' }`.
- Produces: `resolveWallClock(local: string, tz: string): Date` where `local` is `YYYY-MM-DDTHH:mm`.
- Produces: `formatInZone(instant: Date, tz: string): { iso: string; zone: string }` (ISO with offset).
- Produces: `addHours(instant: Date, hours: number): Date`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('resolves New York wall time', () => expect(resolveWallClock('2026-11-14T14:00', 'America/New_York').toISOString()).toBe('2026-11-14T19:00:00.000Z'));
it('resolves Tokyo wall time', () => expect(resolveWallClock('2026-11-14T14:00', 'Asia/Tokyo').toISOString()).toBe('2026-11-14T05:00:00.000Z'));
it('resolves Colombo (UTC+5:30)', () => expect(resolveWallClock('2026-11-14T14:00', 'Asia/Colombo').toISOString()).toBe('2026-11-14T08:30:00.000Z'));
it('rejects a time skipped at spring-forward', () => expect(() => resolveWallClock('2026-03-08T02:30', 'America/New_York')).toThrow(expect.objectContaining({ kind: 'nonexistent' })));
it('rejects a time repeated at fall-back', () => expect(() => resolveWallClock('2026-11-01T01:30', 'America/New_York')).toThrow(expect.objectContaining({ kind: 'ambiguous' })));
it('accepts the hour after the fall-back repeat', () => expect(resolveWallClock('2026-11-01T02:30', 'America/New_York').toISOString()).toBe('2026-11-01T07:30:00.000Z'));
it('rejects malformed input and unknown zones', () => {
  expect(() => resolveWallClock('2026-13-40T99:00', 'America/New_York')).toThrow(expect.objectContaining({ kind: 'invalid' }));
  expect(() => resolveWallClock('2026-11-14T14:00', 'Mars/Base')).toThrow(expect.objectContaining({ kind: 'invalid' }));
});
it('formats an instant in its zone', () => expect(formatInZone(new Date('2026-11-14T19:00:00Z'), 'America/New_York')).toEqual({ iso: '2026-11-14T14:00:00-05:00', zone: 'America/New_York' }));
```

- [ ] **Step 2: Run** `npx vitest run src/common/time/wall-clock.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with luxon. Detect nonexistent and ambiguous times by comparing the zone's UTC offsets one day before and after the candidate and checking how many valid instants map to that wall time.
- [ ] **Step 4: Run.** Expected: PASS (8 tests).
- [ ] **Step 5: Commit.** `git commit -m "feat(time): resolve wall-clock input in market zones"`

---

### Task 5: Shared text and value validators

**Files:**
- Create: `src/common/validation/text.ts`, `contact-details.ts`, `exact-place.ts`, `links.ts`, `handles.ts`, `decorators.ts`
- Test: `src/common/validation/validators.spec.ts`

**Interfaces:**
- Produces: `normalizeText(raw: string): string`; `hasControlChars(raw: string): boolean`; `textLength(s: string): number` (Unicode code points).
- Produces: `containsContactDetails(text: string): boolean`; `mentionsExactPlace(publicText: string, exactPlace: string): boolean`; `fuzzyRepeatsExactPlace(fuzzy: string, exactPlace: string): boolean`; `linkProblem(url: string): 'not_https' | 'shortened' | 'invalid' | null`; `normalizeHandle(raw: string): string`; `isValidHandle(platform: 'instagram'|'threads'|'x'|'tiktok'|'youtube', handle: string): boolean`.
- Produces decorators (each sets the constraint message to its code): `@PlainText(code)`, `@NoContactDetails(code?)` (default `text.contact_details`), `@NotMentioning(exactPlaceProperty: string)` (code `<field>.exact_place`), `@HttpsNoShortener()`, `@TextRange(min, max, field)` (codes `<field>.too_short`, `.too_long`, measured with `textLength` after `normalizeText`).

- [ ] **Step 1: Write the failing tests** (table-driven):

```ts
it.each([
  ['+1 555 010 0100', true], ['call 555-0100 now', true], ['a@b.co', true], ['@priya_k', true],
  ['see example.com', true], ['https://x.com/a', true],
  ['Open 9 to 5', false], ['Room 12, floor 3', false], ['Fold your own, 8 stools', false],
])('containsContactDetails(%s) = %s', (t, v) => expect(containsContactDetails(t)).toBe(v));
it('mentionsExactPlace finds a street segment', () => expect(mentionsExactPlace('Dumplings at 14 Eldridge Street', "Back counter, Fong's Grocery, 14 Eldridge Street")).toBe(true));
it('mentionsExactPlace allows the area-level name', () => expect(mentionsExactPlace('Dumpling Counter on Eldridge', "Back counter, Fong's Grocery, 14 Eldridge Street")).toBe(false));
it('fuzzyRepeatsExactPlace flags an equal segment', () => expect(fuzzyRepeatsExactPlace('14 Eldridge Street', "Back counter, Fong's Grocery, 14 Eldridge Street")).toBe(true));
it.each([['https://example.com/menu', null], ['http://example.com', 'not_https'], ['https://bit.ly/menu', 'shortened'], ['nonsense', 'invalid']])('linkProblem(%s)', (u, v) => expect(linkProblem(u)).toBe(v));
it.each([['instagram','priya.k',true], ['instagram','a'.repeat(31),false], ['x','abcdefghijklmnop',false], ['x','a.b',false], ['tiktok','a',false], ['youtube','ab',false], ['threads','a'.repeat(30),true]])('isValidHandle(%s,%s)', (p,h,v) => expect(isValidHandle(p as never,h)).toBe(v));
it('normalizeHandle strips a leading @', () => expect(normalizeHandle('@priya')).toBe('priya'));
it('normalizeText strips HTML and collapses spaces', () => expect(normalizeText('  <b>Hi</b>   there ')).toBe('Hi there'));
it('textLength counts an emoji as one', () => expect(textLength('🍜🍜🍜🍜🍜')).toBe(5));
it('a title of spaces fails the minimum', () => expect(textLength(normalizeText('       '))).toBe(0));
it('hasControlChars detects a NUL', () => expect(hasControlChars('a\u0000b')).toBe(true));
```

- [ ] **Step 2: Run** `npx vitest run src/common/validation/validators.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec §3 and §5 ("Exact place text" rule). The shortener list is spec §3.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(validation): shared text, contact, place, link and handle rules"`

---

### Task 6: Auth, users, roles and profile

**Files:**
- Create: `src/auth/id-token-verifier.ts`, `src/auth/firebase-token-verifier.ts`, `src/auth/auth.guard.ts`, `src/auth/roles.guard.ts`, `src/auth/roles.decorator.ts`, `src/auth/current-user.decorator.ts`, `src/auth/users.service.ts`, `src/auth/auth.module.ts`, `src/me/me.controller.ts`, `src/me/me.dto.ts`, `src/me/me.module.ts`, `test/support/fake-verifier.ts`
- Modify: `test/support/create-test-app.ts` (override `IdTokenVerifier`), `src/app.module.ts`
- Test: `test/me.e2e-spec.ts`

**Interfaces:**
- Consumes: `DB`, `AppError`, `isValidHandle`, `normalizeHandle`.
- Produces: `abstract class IdTokenVerifier { verify(token: string): Promise<VerifiedToken> }` (also the injection token), `VerifiedToken = { uid: string; email: string; emailVerified: boolean; name?: string; roles: string[] }`.
- Produces: `type Role = 'local' | 'reviewer' | 'admin'`; `interface CurrentUser { id: string; firebaseUid: string; email: string; emailVerified: boolean; roles: Role[]; localId: string | null; tz: string | null }`.
- Produces: `@OptionalAuth()` (adds `req.user` when a valid token is present), `@RequireAuth()` (401 otherwise), `@Roles(...roles: Role[])` (403 `forbidden`), `@CurrentUser()`.
- Produces: `fakeToken(opts: { uid: string; email?: string; roles?: string[] }): string` returning `Bearer test:<uid>:<email>:<roles csv>`; `FakeVerifier` accepts only that format.

- [ ] **Step 1: Write the failing tests.**

```ts
it('GET /v1/me without a token is 401 auth.required', async () => expect((await http.get('/v1/me').expect(401)).body.code).toBe('auth.required'));
it('an invalid token is 401 auth.invalid_token', async () => expect((await http.get('/v1/me').set('Authorization','Bearer nope').expect(401)).body.code).toBe('auth.invalid_token'));
it('first request creates the user row', async () => {
  const res = await http.get('/v1/me').set('Authorization', fakeToken({ uid: 'u1', email: 'priya@example.com' })).expect(200);
  expect(res.body).toMatchObject({ email: 'priya@example.com', roles: [] });
  expect(await db.selectFrom('users').select('id').execute()).toHaveLength(1);
});
it('a verified locals row grants the local role', async () => { /* insert locals with verified_at, GET /v1/me → roles ['local'] and localId set */ });
it('the reviewer claim grants the reviewer role; a local row does not', async () => { /* claims roles ['reviewer'] → roles include reviewer */ });
it('PATCH /v1/me stores socials and strips @', async () => {
  const res = await http.patch('/v1/me').set(auth).send({ socials: { instagram: '@priya.k' } }).expect(200);
  expect(res.body.socials.instagram).toBe('priya.k');
});
it('PATCH /v1/me rejects a 16-character X handle', async () => {
  const res = await http.patch('/v1/me').set(auth).send({ socials: { x: 'abcdefghijklmnop' } }).expect(422);
  expect(res.body.errors[0]).toMatchObject({ code: 'socials.x.invalid', field: 'socials.x' });
});
it('PATCH /v1/me rejects an unknown time zone', async () => expect((await http.patch('/v1/me').set(auth).send({ tz: 'Mars/Base' }).expect(422)).body.errors[0].code).toBe('tz.invalid'));
it('a traveler gets 403 on a reviewer-only route', async () => { /* test-only controller with @Roles('reviewer') */ });
```

- [ ] **Step 2: Run** `npx vitest run --config ./vitest.config.e2e.ts test/me.e2e-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `UsersService.findOrCreate(token)` upserts by `firebase_uid`. `FirebaseTokenVerifier` wraps `firebase-admin` `verifyIdToken` and maps `roles` from custom claims. `CurrentUser.roles` = claim roles that are `reviewer` or `admin`, plus `local` when the user's `locals.verified_at` is set. `AuthModule` binds `IdTokenVerifier` to the Firebase implementation.
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(auth): token verification, roles and profile endpoints"`

---

### Task 7: Markets

**Files:**
- Create: `src/markets/markets.service.ts`, `src/markets/markets.controller.ts`, `src/markets/markets.module.ts`
- Modify: `src/app.module.ts`
- Test: `test/markets.e2e-spec.ts`

**Interfaces:**
- Consumes: `DB`, `PUBLIC_DB`, `AppError`.
- Produces: `interface Market { id: string; city: string; country: string; tz: string; resetTime: string; currency: string; status: 'open' | 'preview' }`; `MarketsService.require(id: string): Promise<Market>` (throws `AppError(422, 'market.invalid', 'marketId')`).
- Produces: `GET /v1/markets` → `{ items: Market[] }`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('lists the five seeded markets', async () => expect((await http.get('/v1/markets').expect(200)).body.items).toHaveLength(5));
it('returns zone and reset time', async () => {
  const boston = (await http.get('/v1/markets')).body.items.find((m: any) => m.id === 'boston');
  expect(boston).toEqual({ id: 'boston', city: 'Boston', country: 'US', tz: 'America/New_York', resetTime: '06:00', currency: 'USD', status: 'open' });
});
it('require() throws market.invalid for an unknown id', async () => await expect(service.require('atlantis')).rejects.toMatchObject({ code: 'market.invalid' }));
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(markets): list markets and validate market ids"`

---

### Task 8: Media uploads

**Files:**
- Create: `src/media/object-storage.ts`, `src/media/s3-storage.ts`, `src/media/image-processor.ts`, `src/media/media.service.ts`, `src/media/media.controller.ts`, `src/media/media.dto.ts`, `src/media/media.module.ts`, `src/common/rate-limit.ts`, `src/common/device.ts`, `test/support/memory-storage.ts`
- Modify: `test/support/create-test-app.ts` (override `ObjectStorage`), `src/app.module.ts`
- Test: `test/media.e2e-spec.ts`, `src/common/rate-limit.spec.ts`

**Interfaces:**
- Consumes: `DB`, `CurrentUser`, `@OptionalAuth`, `AppError`.
- Produces: `abstract class ObjectStorage { presignPut(key: string, contentType: string): Promise<{ url: string; headers: Record<string,string> }>; get(key: string): Promise<Buffer>; put(key: string, body: Buffer, contentType: string): Promise<void> }`.
- Produces: `class ImageProcessor { process(input: Buffer): Promise<{ output: Buffer; width: number; height: number; contentType: 'image/jpeg' }> }` (re-encodes to JPEG, removes all metadata, throws `AppError(422, 'image.type')` if the bytes are not a JPEG, PNG or WebP).
- Produces: `RateLimiter.hit(kind: string, keyHash: string, limit: number, windowSeconds: number): Promise<void>` (inserts a `rate_events` row, throws `AppError(429, 'rate_limited')` when the count in the window would exceed `limit`); `hashKey(value: string): string` (HMAC with `DEVICE_HASH_SALT`); `deviceKey(req): string | null` (from `X-Device-Id`).
- Produces: `POST /v1/media/uploads { contentType, sizeBytes }` → 201 `{ mediaId, upload: { method: 'PUT', url, headers } }`; `POST /v1/media/:id/complete` → 200 `{ id, status: 'ready', width, height }`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('rejects image/gif', async () => expect((await http.post('/v1/media/uploads').set(auth).send({ contentType: 'image/gif', sizeBytes: 1000 }).expect(422)).body.errors[0].code).toBe('image.type'));
it('rejects a file over 5,242,880 bytes', async () => expect((await http.post('/v1/media/uploads').set(auth).send({ contentType: 'image/jpeg', sizeBytes: 5_242_881 }).expect(422)).body.errors[0].code).toBe('image.too_large'));
it('returns a presigned PUT and a pending media row', async () => { /* 201, upload.method 'PUT', row status 'pending' */ });
it('complete: a 900×900 JPEG with GPS EXIF becomes ready with no metadata', async () => {
  storage.seed(mediaId, await jpegWithGps(900, 900));
  const res = await http.post(`/v1/media/${mediaId}/complete`).set(auth).expect(200);
  expect(res.body).toMatchObject({ status: 'ready', width: 900, height: 900 });
  expect((await sharp(storage.read(displayKey)).metadata()).exif).toBeUndefined();
});
it('complete: 799×1200 is rejected with image.too_small and marked rejected', async () => { /* 422 + row status 'rejected' */ });
it('complete: bytes that are not an image are rejected with image.type', async () => { /* seed Buffer.from('hello') as image/jpeg */ });
it('another user cannot complete my media (404)', async () => { /* second token → 404 */ });
it('a guest needs X-Device-Id, and the 21st upload in an hour is 429', async () => { /* 20 ok, 21st rate_limited */ });
// rate-limit.spec (with DB via e2e helper): 'allows limit hits then throws rate_limited'
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** per spec §3 (Images). Storage keys: `media/<id>/original` and `media/<id>/display.jpg`. Guests upload with `X-Device-Id` (limit 20 per hour per device hash, kind `media_upload`); signed-in users use the same limit keyed by user id.
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(media): presigned uploads, image checks and metadata stripping"`

---

### Task 9: Drops, local side

**Files:**
- Create: `src/drops/drop-state.ts`, `src/drops/dto/create-drop.dto.ts`, `src/drops/dto/update-drop.dto.ts`, `src/drops/dto/raise-cap.dto.ts`, `src/drops/drops.service.ts`, `src/drops/drops.controller.ts`, `src/drops/drops.module.ts`, `src/outbox/outbox.service.ts`, `src/outbox/outbox.module.ts`, `src/review/review.service.ts`, `src/review/review.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/drops/drop-state.spec.ts`, `test/drops.e2e-spec.ts`

**Interfaces:**
- Consumes: `DB`, `CurrentUser`, `@Roles('local')`, `MarketsService.require`, validators from Task 5, `messageFor`.
- Produces: `type DropStatus = 'draft'|'pending'|'live'|'paused'|'gone'|'rejected'|'removed'`; `type DropAction = 'submit'|'pause'|'resume'|'end'|'approve'|'reject'|'remove'|'edit_text'|'edit'|'expire'`; `nextDropStatus(current: DropStatus, action: DropAction): DropStatus` (throws `AppError(409, 'drop.invalid_transition')`); `WINDOW_HOURS = [3,6,12,24,48,72] as const`.
- Produces: `OutboxService.add(trx: Transaction<Schema>, event: { type: string; subjectKind: 'drop'|'event'; subjectId: string; actorId?: string | null; data: Record<string, unknown> }): Promise<void>`.
- Produces: `ReviewService.enqueue(trx: Transaction<Schema>, kind: 'drop'|'event', refId: string, flags?: string[]): Promise<void>`.
- Produces endpoints: `POST /v1/drops`, `PATCH /v1/drops/:id`, `POST /v1/drops/:id/submit|pause|resume|end|raise-cap|duplicate`, `GET /v1/me/drops`, `GET /v1/me/drops/:id` (all `@RequireAuth`, local role).
- `CreateDropDto` fields exactly as spec §5 (`title`, `whyNow`, `perfectFor`, `costMinUsd`, `costMaxUsd`, `timeMinutes`, `bestTime?`, `watchOut`, `photoMediaId`, `photoIsStandIn?`, `marketId`, `fuzzyArea`, `exactPlace`, `meetDetail?`, `windowHours`, `unlocksPerDay`, `unlockPriceCredits`).

- [ ] **Step 1: Write the failing tests.** State machine (unit):

```ts
it.each([
  ['draft','submit','pending'], ['pending','approve','live'], ['pending','reject','rejected'], ['live','pause','paused'],
  ['paused','resume','live'], ['live','end','gone'], ['paused','end','gone'], ['live','expire','gone'], ['paused','expire','gone'],
  ['live','edit_text','pending'], ['paused','edit_text','pending'], ['draft','edit','draft'], ['rejected','edit','draft'], ['live','remove','removed'],
])('%s + %s → %s', (from, action, to) => expect(nextDropStatus(from as DropStatus, action as DropAction)).toBe(to));
it.each([['draft','approve'],['gone','resume'],['live','submit'],['removed','edit'],['pending','pause']])('%s + %s throws drop.invalid_transition', (from, action) => expect(() => nextDropStatus(from as DropStatus, action as DropAction)).toThrow(expect.objectContaining({ code: 'drop.invalid_transition' })));
```

E2E (`test/drops.e2e-spec.ts`; helper `validDrop(overrides?)` builds a valid body with a ready media row, `exactPlace: "Back counter, Fong's Grocery, 14 Eldridge Street"`):

```ts
it('a traveler cannot create a Drop (403 drop.local_required)', ...);
it('creates a draft and stores the private text separately', async () => { /* 201 status 'draft'; drop_private row holds exact_place */ });
it('rejects exact-place text in the title with the spec message', async () => {
  const res = await http.post('/v1/drops').set(localAuth).send(validDrop({ title: 'Dumplings at 14 Eldridge Street' })).expect(422);
  expect(res.body.errors[0]).toEqual({ code: 'title.exact_place', field: 'title', message: 'This mentions the exact spot. Keep it for the hidden field so travelers unlock it.' });
});
it('never echoes the submitted exactPlace in an error body', async () => {
  const res = await http.post('/v1/drops').set(localAuth).send(validDrop({ exactPlace: 'SECRET-PLACE-123', title: 'x' })).expect(422);
  expect(JSON.stringify(res.body)).not.toContain('SECRET-PLACE-123');
});
it('whyNow "Busy." gets whyNow.too_short', ...);       // message: 'Add at least 20 characters so travelers know why this is worth doing today.'
it('a missing watchOut gets watchOut.required', ...);   // 'Add a watch-out so travelers know what to expect.'
it('windowHours 5 gets windowHours.invalid', ...);      // 'Choose how long this Drop stays live.'
it('costMaxUsd below costMinUsd gets cost.range', ...);
it('a title of 5 emoji is valid and 4 is too short', ...);
it('a photo that is not ready gets photo.not_ready', ...);
it('unlockPriceCredits 2 is stored as unlock_price_minor 200; 0 and 4 are 422 unlockPriceCredits.range', ...);
it('submit moves draft to pending, writes a review item and a drop.submitted outbox row', ...);
it('the sixth submit for one local is 409 drop.limit_live', ...);
it('editing text on a live Drop returns it to pending', ...);
it('editing exactPlace on a live Drop is 409 drop.field_locked', ...);
it('pause, resume and end follow the state table', ...);
it('raise-cap 8 → 12 works; 8 → 6 is 422 drop.cap_lower; 8 → 21 is 422 unlocksPerDay.range', ...);
it('duplicate copies every field, including private ones, into a new draft', ...);
it('another local gets 404 for my Drop', ...);
it('GET /v1/me/drops/:id includes exactPlace and meetDetail', ...);
```

- [ ] **Step 2: Run.** `npx vitest run src/drops/drop-state.spec.ts` and the e2e file. Expected: FAIL.
- [ ] **Step 3: Implement** `nextDropStatus` from the spec §5 table; DTOs with the Task 5 decorators and messages from spec §10; `DropsService` doing every write in one transaction (the `drops` and `drop_private` rows together), calling `ReviewService.enqueue` and `OutboxService.add` inside the same transaction. A guard in the service, not the DTO, checks the exact-place rules (they compare two fields) and the 5-active limit.
- [ ] **Step 4: Run to verify pass**, then the full suite and lint.
- [ ] **Step 5: Commit.** `git commit -m "feat(drops): local-side creation, editing and lifecycle"`

---

### Task 10: Review queue and admin actions

**Files:**
- Create: `src/review/review.controller.ts`, `src/review/review.dto.ts`
- Modify: `src/review/review.service.ts`, `src/review/review.module.ts`, `src/app.module.ts`
- Test: `test/review.e2e-spec.ts`

**Interfaces:**
- Consumes: `ReviewService.enqueue`, `OutboxService.add`, `nextDropStatus`, `@Roles('reviewer','admin')`, `DB`. Event items are inserted directly in this task's tests, because the event API arrives in Task 12; approving an event is one conditional `UPDATE events SET status = 'upcoming' ... WHERE status = 'pending'`.
- Produces: `ReviewService.approve(kind, id, reviewerId): Promise<void>`, `reject(kind, id, reviewerId, reason: string)`, `remove(kind, id, reviewerId, reason: string)`; `GET /v1/admin/review-queue?kind=`; `POST /v1/admin/items/:kind/:id/approve|reject|remove`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('approving a Drop sets live, approved_at and expires_at = approved_at + window_hours', async () => {
  /* drop with window_hours 24 */ expect(hoursBetween(row.approved_at, row.expires_at)).toBe(24); expect(row.status).toBe('live');
});
it('approving an event sets upcoming', ...);
it('reject and remove need a reason of at least 5 characters', async () => expect(body.errors[0].code).toBe('review.reason_required'));
it('approving an item that is not pending is 409 review.not_pending', ...);
it('a local gets 403 on the review endpoints', ...);
it('the queue lists pending items oldest first with private fields', ...);
it('every decision writes an audit_log row', ...);
it('approve writes a drop.approved outbox row that holds no private fields', async () => {
  expect(JSON.stringify(outboxRow.payload)).not.toMatch(/exactPlace|meetDetail|Eldridge/);
});
it('two simultaneous approvals produce one success, one 409 and one outbox row', async () => {
  const [a, b] = await Promise.all([approve(id), approve(id)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect(await outboxRows('drop.approved', id)).toHaveLength(1);
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** each decision in one transaction that first runs `UPDATE review_items SET state = ... WHERE kind = $1 AND ref_id = $2 AND state = 'pending' RETURNING id`; zero rows means 409 `review.not_pending`. The updated subject row, the audit row and the outbox row follow in the same transaction.
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(review): admin queue with approve, reject and remove"`

---

### Task 11: Public Drops list and detail

**Files:**
- Create: `src/drops/drop.serializer.ts`, `src/drops/public-drops.controller.ts`, `src/drops/public-drops.repository.ts`, `src/common/pagination.ts`
- Modify: `src/drops/drops.module.ts`
- Test: `src/drops/drop.serializer.spec.ts`, `src/common/pagination.spec.ts`, `test/public-drops.e2e-spec.ts`

**Interfaces:**
- Consumes: `PUBLIC_DB`, `DB`, `@OptionalAuth`.
- Produces: `type Audience = 'public' | 'owner' | 'reviewer'`; `serializeDrop(row: DropRow, audience: Audience, now: Date): DropView`; `DropView` fields: `id, title, whyNow, perfectFor, cost: { minUsd, maxUsd }, timeMinutes, bestTime, watchOut, photo: { mediaId, url?, isStandIn }, market: { id, city, tz }, fuzzyArea, unlockPriceCredits, unlocksPerDay, unlocksLeft, status, expiresAt, local: { id, displayName, roleTitle, verified }`, plus `exactPlace` and `meetDetail` only for `owner` and `reviewer`.
- Produces: `encodeCursor(v: { t: string; id: string }): string`; `decodeCursor(c: string): { t: string; id: string }` (throws `AppError(422, 'cursor.invalid')`); `parseLimit(raw: string | undefined): number` (default 20, 1–50, else `AppError(422, 'limit.range')`).
- Produces: `GET /v1/drops?market=&limit=&cursor=` (public) and `GET /v1/drops/:id`. The repository for the list uses `PUBLIC_DB` only.

- [ ] **Step 1: Write the failing tests.**

```ts
// serializer (unit)
it('public view has no private keys', () => expect(Object.keys(serializeDrop(row, 'public', now))).not.toEqual(expect.arrayContaining(['exactPlace'])));
it('owner and reviewer views include exactPlace and meetDetail', ...);
it('unlocksLeft equals unlocksPerDay when nothing is used', ...);
// pagination (unit)
it('decodeCursor rejects garbage with cursor.invalid', ...);
it('parseLimit: undefined → 20; "0" and "51" and "abc" → limit.range', ...);
// e2e
it('lists only live, unexpired Drops, newest approval first', ...);
it('a live Drop past expires_at is absent even though the sweeper has not run', async () => { /* set expires_at in the past */ });
it('draft, pending, paused, gone, rejected and removed Drops are 404 publicly', ...);
it('the owner and a reviewer can read any status; another local gets 404', ...);
it('filters by market', ...);
it('pages with a cursor and returns nextCursor null at the end', ...);
it('a tampered cursor is 422 cursor.invalid and limit 51 is 422 limit.range', ...);
it('anonymous responses carry Cache-Control public, max-age=15 and Vary: Authorization; authenticated ones are private, no-store', ...);
it('public JSON never contains the exact place text or the keys exactPlace and meetDetail', async () => {
  const text = JSON.stringify((await http.get('/v1/drops')).body) + JSON.stringify((await http.get(`/v1/drops/${id}`)).body);
  expect(text).not.toMatch(/SECRET-PLACE-123|exactPlace|meetDetail/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** The expiry predicate (`status = 'live' AND expires_at > now()`) is in the repository SQL. Cursors encode `(approved_at, id)`.
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(drops): public list and detail through audience serializers"`

---

### Task 12: Events, host side for accounts

**Files:**
- Create: `src/events/event-state.ts`, `src/events/event-rules.ts`, `src/events/dto/create-event.dto.ts`, `src/events/dto/update-event.dto.ts`, `src/events/events.service.ts`, `src/events/events.controller.ts`, `src/events/events.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/events/event-rules.spec.ts`, `test/events.e2e-spec.ts`

**Interfaces:**
- Consumes: `resolveWallClock`, `formatInZone`, `MarketsService.require`, `ReviewService.enqueue`, `OutboxService.add`, validators.
- Produces: `validateEventTimes(startsAt: Date, endsAt: Date | null, now: Date): void` (throws `AppError(422, …)` with `start.too_soon`, `start.too_far`, `end.before_start`, `end.too_long`).
- Produces: `type EventStatus = 'pending'|'upcoming'|'past'|'cancelled'|'rejected'|'removed'` in `event-state.ts`; `hostBadge(hasVerifiedLocal: boolean): 'verified_local' | 'community_host'`.
- Produces: `POST /v1/events`, `PATCH /v1/events/:id`, `POST /v1/events/:id/cancel`, `GET /v1/me/events` (account path; the guest path is added in Task 13). `CreateEventDto` as spec §6 (`name, category, marketId, description, startsLocal, endsLocal?, dateNote?, area, exactAddress?, addressVisibility?, capacity?, photoMediaId?, link?`).

- [ ] **Step 1: Write the failing tests.**

```ts
// event-rules.spec.ts (now = 2026-11-19T12:00:00Z)
it('rejects a start 29 minutes ahead (start.too_soon)', ...);     it('accepts 30 minutes ahead', ...);
it('rejects a start 181 days ahead (start.too_far)', ...);          it('accepts 180 days ahead', ...);
it('rejects an end equal to the start (end.before_start)', ...);   it('rejects an end 24h01m after the start (end.too_long)', ...);
it('accepts an end exactly 24 hours after the start', ...);
// events.e2e-spec.ts
it('a first-time host creates a pending event, a review item and an event.submitted outbox row', ...);
it('a host with an approved earlier event creates an upcoming event and an event.approved outbox row', ...);
it('resolves startsLocal in the market zone (Boston 14:00 → 19:00Z in November)', ...);
it('Sigiriya 23:30 local is stored as 18:00Z (UTC+5:30)', ...);
it('a start in the spring-forward gap is 422 start.nonexistent_time', async () => { /* use a market-zone date 2027-03-14T02:30 America/New_York with now frozen */ });
it('a start in the fall-back repeat is 422 start.ambiguous_time', ...);
it('a start 10 minutes ahead is 422 start.too_soon with the spec message', ...);
it('an address without addressVisibility is 422 addressVisibility.required', ...);
it('capacity 0 and 501 are 422 capacity.range; 1 and 500 pass', ...);
it('a description of 19 characters is 422 description.too_short', ...);
it('https://bit.ly/menu is 422 link.shortened; http://example.com is 422 link.not_https', ...);
it('a duplicate (same host, name, market, start within one hour) is 409 event.duplicate', ...);
it('the exact address is stored in event_private and host_name/host_badge on the event', ...);
it('editing a past or cancelled event is 409 event.not_editable; cancel sets cancelled', ...);
it('GET /v1/me/events lists my events in every status', ...);
it('the market cannot be changed by PATCH', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** Use an injectable `Clock` (`now(): Date`) so tests freeze time; add it to `src/common/clock.ts` and override it in `createTestApp`. Duplicate detection compares `lower(name)`, market and `starts_at` within one hour, ignoring cancelled events.
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(events): account-host creation, editing and cancellation"`

---

### Task 13: Guest hosts, claim codes and mail

**Files:**
- Create: `src/guests/claim-codes.ts`, `src/guests/guest-identities.service.ts`, `src/guests/claims.controller.ts`, `src/guests/claims.dto.ts`, `src/guests/guest-auth.guard.ts`, `src/guests/manage-token.ts`, `src/mail/mailer.ts`, `src/mail/log-mailer.ts`, `src/mail/ses-mailer.ts`, `src/mail/mail.module.ts`, `src/guests/guests.module.ts`, `test/support/capturing-mailer.ts`
- Modify: `src/events/events.service.ts`, `src/events/events.controller.ts`, `src/events/dto/create-event.dto.ts` (guest fields), `test/support/create-test-app.ts` (override `Mailer`), `src/app.module.ts`
- Test: `src/guests/claim-codes.spec.ts`, `src/mail/ses-mailer.spec.ts`, `test/guests.e2e-spec.ts`

**Interfaces:**
- Consumes: `RateLimiter`, `hashKey`, `deviceKey`, `EventsService`, `DB`.
- Produces: `generateClaimCode(): string` (12 chars, alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`); `hashClaimCode(code: string, secret: string): string` (HMAC-SHA256 hex); `abstract class Mailer { send(msg: { to: string; subject: string; text: string }): Promise<void> }`; `signManageToken(payload: { sub: string; evt: string }, secret: string): Promise<string>` (HS256, 900 s); `verifyManageToken(token: string, secret: string): Promise<{ sub: string; evt: string }>`.
- Produces: `POST /v1/events` without a token and with `hostName`, `hostEmail`, `X-Device-Id` creates a guest event (always `pending` for a first-time email); response includes `claimCode` once and `message` (`event.guest_submitted`). `POST /v1/claims/recover`, `POST /v1/claims/exchange`. `PATCH /v1/events/:id` and `POST /v1/events/:id/cancel` accept `X-Claim-Code` or `Authorization: Manage <token>`.

- [ ] **Step 1: Write the failing tests.**

```ts
// unit
it('generateClaimCode returns 12 characters from the Crockford alphabet', () => expect(generateClaimCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/));
it('generateClaimCode does not repeat across 1000 calls', ...);
it('hashClaimCode is deterministic and secret-dependent', ...);
it('manage tokens round-trip and a tampered token fails', ...);
it('SesMailer sends one SendEmail command with from, to, subject and text (mocked client)', ...);
// e2e
it('a guest creates a pending event; the response has claimCode and the spec message; one email is captured', async () => {
  const res = await http.post('/v1/events').set('X-Device-Id', 'dev-1').send(validGuestEvent()).expect(201);
  expect(res.body).toMatchObject({ status: 'pending', message: "Thanks! We'll take a quick look before it goes up, and email you at guest@example.com." });
  expect(res.body.claimCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  expect(mailer.sent).toHaveLength(1);
  expect(await db.selectFrom('guest_identities').select('claim_hash').execute()).not.toEqual([{ claim_hash: res.body.claimCode }]);
});
it('a guest post without X-Device-Id is 422 device.required; without hostEmail is 422 hostEmail.required', ...);
it('the third guest post from one device in a day is 429 rate_limited; the sixth from one IP is 429', ...);
it('a guest can PATCH and cancel with the right X-Claim-Code; a wrong code is 401 claim.invalid', ...);
it('recover answers 202 ok for an unknown email and sends nothing', ...);
it('recover rotates the code: the old code stops working, the emailed one works', ...);
it('exchange returns a manage token that edits the event for 15 minutes', ...);
it('five wrong codes from one device lock it: the sixth try is 429 claim.locked even with the right code', ...);
it('recover is limited to 3 an hour per email and 10 an hour per IP (429 rate_limited)', ...);
it('a returning guest email with an approved event creates an upcoming event', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** per spec §7. `GuestAuthGuard` resolves the event from the route id and checks the claim hash or the manage-token `evt` claim. Failures (`claim_failure` rate events) are counted per device hash and per IP hash, 5 per hour.
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(guests): guest events, claim codes, recovery and mail port"`

---

### Task 14: Public events list and detail

**Files:**
- Create: `src/events/event.serializer.ts`, `src/events/public-events.controller.ts`, `src/events/public-events.repository.ts`
- Modify: `src/events/events.module.ts`
- Test: `src/events/event.serializer.spec.ts`, `test/public-events.e2e-spec.ts`

**Interfaces:**
- Consumes: `PUBLIC_DB`, `DB`, `Audience`, `parseLimit`, `encodeCursor`, `decodeCursor`, `formatInZone`, `Clock`.
- Produces: `serializeEvent(row: EventRow, audience: Audience, now: Date): EventView`; `EventView`: `id, name, category, market: { id, city, tz }, description, startsAt, startsAtLocal, endsAt, endsAtLocal, dateNote, area, spotsLeft (capacity or null), link, photo, host: { name, badge }`, plus `exactAddress` when visibility is `public`, or for `owner` and `reviewer`.
- Produces: `GET /v1/events?market=&from=&to=&category=&limit=&cursor=` and `GET /v1/events/:id`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('lists only upcoming events whose end (or start) plus 3 hours is in the future', async () => { /* ends 2h59m ago → visible; 3h01m ago → hidden; no end: start 2h59m ago → visible */ });
it('sorts by start then id and pages with a cursor', ...);
it('filters by category and market', ...);
it('from/to are dates in the market zone: a Colombo event at 23:30 local on 14 Nov shows for from=to=2026-11-14 and not for 2026-11-15', ...);
it('from or to without market is 422 market.required', ...);
it('pending, rejected, removed, cancelled and past events are 404 publicly; the owner (account or claim code) and reviewers can read them', ...);
it('exactAddress shows when visibility is public, and not for after_rsvp, for the public', ...);
it('spotsLeft equals capacity, or null without capacity', ...);
it('startsAtLocal carries the market offset', () => expect(view.startsAtLocal).toBe('2026-11-14T14:00:00-05:00'));
it('public JSON never contains hostEmail, claim codes, guest identity ids or after_rsvp addresses', async () => {
  expect(JSON.stringify(list.body) + JSON.stringify(detail.body)).not.toMatch(/guest@example\.com|claim|SECRET-ADDR-456|owner_user_id/i);
});
it('a tampered cursor is 422 cursor.invalid', ...);
it('anonymous responses are public, max-age=15 with Vary: Authorization; authenticated ones are private, no-store', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** The visibility predicate lives in the repository SQL (`status = 'upcoming' AND COALESCE(ends_at, starts_at) + interval '3 hours' > now()`); date filters convert the market-zone day boundaries to UTC with `resolveWallClock`. The owner/claim-code detail path reads through `DB`.
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(events): public list and detail with market-zone filters"`

---

### Task 15: Outbox relay and sweepers

**Files:**
- Create: `src/outbox/event-publisher.ts`, `src/outbox/log-publisher.ts`, `src/outbox/outbox-relay.service.ts`, `src/jobs/advisory-lock.ts`, `src/jobs/drop-sweeper.service.ts`, `src/jobs/event-sweeper.service.ts`, `src/jobs/jobs.module.ts`, `test/support/capturing-publisher.ts`
- Modify: `src/outbox/outbox.module.ts`, `test/support/create-test-app.ts` (override `EventPublisher`, set `JOBS_ENABLED=false`), `src/app.module.ts`
- Test: `test/jobs.e2e-spec.ts`

**Interfaces:**
- Consumes: `DB`, `OutboxService`, `Clock`, `nextDropStatus`.
- Produces: `abstract class EventPublisher { publish(envelope: Envelope): Promise<void> }`; `type Envelope = { id: string; type: string; v: 1; occurredAt: string; actor: { id: string | null }; subject: { kind: string; id: string }; data: Record<string, unknown> }`.
- Produces: `OutboxRelayService.run(): Promise<number>`; `DropSweeper.run(now?: Date): Promise<number>`; `EventSweeper.run(now?: Date): Promise<number>`; `withAdvisoryLock<T>(db: Kysely<Schema>, key: number, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>`.
- Schedules (only when `JOBS_ENABLED`): Drop sweeper every minute, event sweeper every 10 minutes, relay every 5 seconds.

- [ ] **Step 1: Write the failing tests.**

```ts
it('DropSweeper marks expired live and paused Drops gone and writes drop.ended once', async () => { /* run → 2; run again → 0; one outbox row per Drop */ });
it('DropSweeper leaves a live Drop whose expires_at is in the future', ...);
it('EventSweeper marks an upcoming event past 3 hours after its end, or after its start when it has no end', ...);
it('EventSweeper leaves an event 2h59m after its end', ...);
it('the relay publishes unpublished rows in order per subject and sets published_at', ...);
it('a publish failure leaves the row unpublished, and the next run retries it', ...);
it('withAdvisoryLock lets one of two concurrent runs execute', async () => {
  const [a, b] = await Promise.all([lock(slow), lock(slow)]);
  expect([a.ran, b.ran].sort()).toEqual([false, true]);
});
it('the envelope matches { id, type, v: 1, occurredAt, actor, subject, data }', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** each sweeper as a single conditional `UPDATE ... RETURNING` followed by outbox inserts in the same transaction, guarded by `withAdvisoryLock` (`pg_try_advisory_lock`).
- [ ] **Step 4: Run to verify pass**, then the full suite.
- [ ] **Step 5: Commit.** `git commit -m "feat(jobs): outbox relay and sweepers"`

---

### Task 16: OpenAPI, leak scan, CI and README

**Files:**
- Create: `src/openapi.ts`, `scripts/openapi.ts`, `.github/workflows/ci.yml`
- Modify: `src/main.ts` (serve docs at `/v1/docs` outside production), `README.md`, `package.json` (`"openapi"` script), DTO files (add `@ApiProperty` where the schema needs limits)
- Test: `test/openapi.e2e-spec.ts`, `test/leak-scan.e2e-spec.ts`

**Interfaces:**
- Produces: `buildOpenApi(app: INestApplication): OpenAPIObject`; `npm run openapi` writes `openapi.json`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('the OpenAPI document is valid', async () => await expect(SwaggerParser.validate(structuredClone(doc))).resolves.toBeDefined());
it('every registered route appears in the document', () => expect(missingRoutes(app, doc)).toEqual([]));
it('CreateDropDto documents the spec limits', () => {
  const title = doc.components.schemas.CreateDropDto.properties.title;
  expect([title.minLength, title.maxLength]).toEqual([5, 80]);
});
it('leak scan: no public route returns a private value or key', async () => {
  /* seed: live Drop with exactPlace 'SECRET-PLACE-123', meetDetail 'SECRET-MEET-789'; upcoming after_rsvp event with address 'SECRET-ADDR-456';
     guest event with hostEmail 'guest@example.com' and a claim code */
  for (const path of publicPaths) for (const headers of [{}, travelerAuth]) {
    const text = JSON.stringify((await http.get(path).set(headers).expect(200)).body);
    expect(text).not.toMatch(/SECRET-PLACE-123|SECRET-MEET-789|SECRET-ADDR-456|guest@example\.com|claimCode|claim_hash|exactPlace|meetDetail|hostEmail/);
  }
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** `.github/workflows/ci.yml`: Postgres 16 service, `npm ci --legacy-peer-deps`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run openapi`. README: setup, env variables, how to run tests with `TEST_DATABASE_URL`, project layout, the module list.
- [ ] **Step 4: Run the whole suite**: `npm run lint && npm test && npm run test:e2e && npm run build`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(api): OpenAPI document, leak-scan suite, CI and README"`
