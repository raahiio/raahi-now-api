# PR Review Rules — raahi-now-api

NestJS 12 (ESM, TypeScript, strict), Node 22, Kysely + PostgreSQL 16, class-validator,
vitest, oxlint. Phase 1 backend for Drops and Events (see `docs/superpowers/specs/2026-11-19-raahi-now-phase1-spec.md`,
the binding spec — the plan and code must defer to it). A sibling repo/worktree
(`raahi-now-api-vendor`, branch `feat/vendor-project-auth`) and a vendor-facing client consume
this API's contract, so treat public response shapes and the generated OpenAPI document as a
cross-repo contract, not an internal detail.

## Flag these

- **Privacy leaks in public views.** Any change touching `*.serializer.ts`, `owner-view.ts`,
  `public-*.repository.ts`, or the `drops`/`events` DTOs must keep `exactPlace`, `meetDetail`,
  `exactAddress` (unless `addressVisibility: public`), `hostEmail`, `claimCode`, `claim_hash`,
  and the `review` key out of public responses. `test/leak-scan.e2e-spec.ts` is the enforcement
  mechanism — if a diff touches these files without updating or at least considering that spec,
  flag it. Public queries must go through `PUBLIC_DB` (`src/db/tokens.ts`), never `DB`; a public
  controller/repository reaching for the `DB` token (app read-write role) instead of `PUBLIC_DB`
  is a data-leak bug.
- **OpenAPI / contract breaking changes.** `src/openapi.ts` + `npm run openapi` generate the
  spec consumed elsewhere. Renaming, removing, or narrowing a field on `PublicDropView`,
  `PublicEventView`, or any request DTO (`src/*/dto/*.ts`) is a breaking change — flag it
  explicitly and ask whether the vendor-facing consumer needs to move in lockstep.
  `test/openapi.e2e-spec.ts` pins exact required/optional field lists per DTO; a PR that changes
  a DTO without a matching update to that test is suspect.
- **Validation message drift.** All user-facing strings must come from `src/common/errors/messages.ts`
  and match spec §10 verbatim (see the file's own comment: "Every user-facing message, verbatim
  from spec §10"). A hardcoded string in a controller/service/DTO instead of a `messageFor`/code
  lookup is a bug here, not a style nit.
- **State machine changes.** `src/drops/drop-state.ts` and `src/events/event-rules.ts` /
  `event-state.ts` encode the only legal transitions (spec §5). Any new action/status must update
  the transition table, not just the call site, or it will silently 409 or silently allow an
  illegal transition.
- **Outbox payload safety.** `src/outbox/outbox.service.ts` enforces `assertNoPrivateKeys` on every
  outbox payload. A new `outbox.add()` call site that includes private fields in `data` is a real
  bug the runtime check exists to catch — the check is intentional defense-in-depth, not dead code.
- **Role/guard placement.** `AuthGuard`, `RolesGuard`, `LocalRequiredGuard`, `GuestAuthGuard` are
  layered (global guards + per-route `@RequireAuth()`/`@OptionalAuth()`/`@Roles()`). A new
  authenticated route missing `@RequireAuth()` (or relying on implicit behavior) can become
  accidentally public — check this explicitly, since the default (no marker) is "optional auth,"
  not "no auth required."
- **Rate limiting / abuse surfaces.** New unauthenticated or guest-writable endpoints (claim
  exchange, guest event creation, media upload) should go through `RateLimiter`/`deviceKey`
  (`src/common/rate-limit.ts`, `src/common/device.ts`) or justify why not.
- **Missing tests.** This repo is test-first (unit specs beside the code as `*.spec.ts`, e2e specs
  in `test/*.e2e-spec.ts`). A new DTO, serializer, state transition, or controller route added
  without a corresponding spec/e2e test is a gap — flag it. New DTOs in particular should appear
  in `test/openapi.e2e-spec.ts`'s `DTOS` table.
- **Migration safety.** `src/db/migrations/*.ts` run via `npm run db:migrate`; flag destructive
  migrations (dropped columns/tables, narrowed types) without a clear backward-compat story, since
  `deploy-develop.yml` runs migrations as a one-off ECS task against live data.
- **Security-sensitive crypto.** Claim codes (`src/guests/claim-codes.ts`) and device/rate-limit
  hashing (`src/common/device.ts`) use HMAC-SHA256 with a server secret. Flag any change that
  weakens this (e.g., switching to unsalted hashing, logging raw codes/tokens, or widening what
  `normalizeClaimCode` accepts in a way that increases collisions).

## Ignore / do not flag

- Generated/build output: `dist/`, `dist-openapi/`, `tsconfig.build.tsbuildinfo`, `openapi.json`
  (all gitignored; `openapi.json` is produced by `npm run openapi` and not committed).
- `package-lock.json` lockfile diffs.
- `.pgdata/` (embedded Postgres data directory from `npm run db:test`).
- Anything under `node_modules/`, `coverage/`.

## Patterns that are intentional, not bugs

- **`RateLimiter.hit` (`src/common/rate-limit.ts`) is not atomic.** Its own doc comment says the
  insert-then-count runs without a lock, so concurrent requests can overshoot the limit "by the
  number of concurrent requests," and this is explicitly "Accepted for abuse throttling." Do not
  flag this race as a bug.
- **Dual DB connections (`DB` and `PUBLIC_DB`) to the same Postgres instance** (`src/db/db.module.ts`,
  `src/db/tokens.ts`) are deliberate: `PUBLIC_DB` connects as a restricted-grant login role so public
  endpoints cannot physically select private columns even if application code tried. Don't suggest
  collapsing these into one pool.
- **`serializeDrop`/`serializeEvent` overloaded signatures** (`src/drops/drop.serializer.ts`,
  `src/events/event.serializer.ts`) deliberately return different types per `audience` — this is
  the single chokepoint for what a given audience may see; don't suggest "simplifying" it into one
  shape.
- **`exactAddress` is conditionally present on `PublicEventView`** only when
  `addressVisibility === 'public'` (optional field, `?:`), vs. always-present-but-possibly-null on
  the private view. This asymmetry is intentional, matching the spec's visibility rule, not an
  inconsistent API.
- **ESM relative imports end in `.js`** (e.g. `from './app.module.js'`) even though the source
  files are `.ts`. This is required by `"type": "module"` + `nodenext` resolution — not a typo.
- **`oxlintrc.json` turns off `typescript/no-explicit-any`** project-wide; don't flag bare `any`
  usages as a lint violation the project itself doesn't enforce.
