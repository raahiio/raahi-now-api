# Raahi NOW API

Backend for Raahi NOW (Drops, Events, Buddies). This repo currently holds the Phase 1 spec and plan; the code is built from them.

## Start here

1. Read `docs/superpowers/specs/2026-11-19-raahi-now-phase1-spec.md` (binding spec).
2. Read `docs/superpowers/plans/2026-11-19-raahi-now-phase1-api.md` (16 tasks, tests first).
3. Execute the plan with `superpowers:subagent-driven-development`. Work in a git worktree, never directly on `main`. Do not merge or push without asking.

## Stack and commands

- Node 22, NestJS 12 (ESM, relative imports end in `.js`), TypeScript, Kysely + pg, PostgreSQL 16, class-validator, vitest, oxlint.
- `.npmrc` must contain `legacy-peer-deps=true` (the default `npm install` crashes on this dependency tree).
- `npm test` runs unit specs (no database). `npm run test:e2e` runs `test/*.e2e-spec.ts` against a real PostgreSQL 16 at `TEST_DATABASE_URL`, for example `postgres://postgres:postgres@localhost:5432/raahi_now_test`. `npm run lint` runs oxlint.
- Start Postgres with `docker compose up -d` once Task 1 has created `docker-compose.yml`, or use a local Postgres 16 and create the `raahi_now_test` database. The test setup needs a superuser connection because it creates database roles.

## Rules that matter

- The spec file wins over the plan if they disagree. Record any deviation as a `Ruling:` line in the SDD ledger.
- Public responses must never contain `exactPlace`, `meetDetail`, `exactAddress` (unless visibility is `public`), `hostEmail`, `claimCode` or `claim_hash`.
- Public list and detail queries run on the `PUBLIC_DB` connection (the read-restricted role), never the app connection.
- All validation messages come from `src/common/errors/messages.ts` and match the spec's section 10 exactly.
- Phase 1 only. Unlock, RSVP, bookings, payments, Buddies, share and push are later phases.
