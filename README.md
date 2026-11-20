# Raahi NOW API

NestJS 12 (ESM, TypeScript) backend for Raahi NOW. Phase 1 covers Drops and events: creation, review and public listing. Data lives in PostgreSQL 16 (Kysely), images in S3, mail through SES, and every state change is written to a transactional outbox.

The binding spec is `docs/superpowers/specs/2026-11-19-raahi-now-phase1-spec.md`.

## Setup

Requires Node 22 or newer.

```
cp .env.example .env
npm install        # .npmrc sets legacy-peer-deps=true; CI uses npm ci --legacy-peer-deps
npm run start:dev
```

In non-production environments the OpenAPI UI is served at `/v1/docs`.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `production` turns off `/v1/docs` |
| `PORT` | no | `3000` | HTTP port |
| `DATABASE_URL` | yes | | Read/write PostgreSQL connection |
| `DATABASE_PUBLIC_URL` | yes | | Connection as the `raahi_public_read` role, used by the public GET endpoints |
| `S3_BUCKET` | yes | | Bucket for uploaded images |
| `S3_REGION` | yes | | AWS region of the bucket and SES |
| `SES_FROM` | yes | | Sender address for claim-code emails |
| `CLAIM_CODE_SECRET` | yes | | HMAC key for guest claim codes, at least 32 characters |
| `MANAGE_TOKEN_SECRET` | yes | | Signing key for guest manage tokens, at least 32 characters |
| `DEVICE_HASH_SALT` | yes | | Salt for hashing device ids and IPs in rate limits |
| `FIREBASE_PROJECT_ID` | yes | | Firebase project that issues the ID tokens |
| `JOBS_ENABLED` | no | `true` | `false` disables the sweepers and the outbox relay timers |
| `TRUST_PROXY` | no | `0` | Reverse-proxy hops to trust for the client IP (rate limits, claim lock). `0` is off; use `1` behind one load balancer |

## Test database

The e2e tests need PostgreSQL 16 and a superuser connection (the setup drops and recreates the `public` schema and creates a login role).

- No Docker: `npm run db:test` starts an embedded PostgreSQL 16 on port 5432 (user and password `postgres`, data in `.pgdata/`) and creates `raahi_now` and `raahi_now_test`. Leave it running; Ctrl-C stops it.
- Docker: `docker compose up -d` (PostgreSQL 16 with both databases).

Then set `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/raahi_now_test`.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit specs, no database |
| `TEST_DATABASE_URL=... npm run test:e2e` | End-to-end specs against the test database |
| `npm run lint` | oxlint with type-aware rules |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled app |
| `npm run openapi` | Write `openapi.json` (git-ignored). Needs no database |
| `npm run db:test` | Start the embedded test PostgreSQL |

## Project layout

```
src/
  main.ts, app.module.ts, configure-app.ts, openapi.ts
  config/    environment loading and validation
  db/        Kysely providers, schema types, migrations
  common/    errors, validation, pagination, rate limits, clock, cache headers
  auth/      Firebase ID token guard, roles, user lookup
  ...        one folder per module (below)
scripts/     test-db.mjs, openapi.ts
test/        e2e specs and support (fixtures, fakes)
```

## Modules

| Module | Responsibility |
| --- | --- |
| `health` | `GET /v1/health` |
| `markets` | Markets and their time zones |
| `me` | Profile and the caller's own Drops and events |
| `media` | Presigned upload, completion, image processing |
| `drops` | Drop creation, editing, lifecycle; public list and detail |
| `events` | Event creation (accounts and guests), editing, cancel; public list and detail |
| `guests` | Guest identities, claim codes, `/v1/claims/exchange` and `/recover`, manage tokens |
| `review` | Reviewer queue and approve, reject, remove decisions |
| `mail` | Mailer (SES, or a log mailer) |
| `outbox` | Transactional outbox and the relay that publishes events |
| `jobs` | Drop and event sweepers, relay timer |

## Phase 1 scope

In Phase 1: foundations, markets with time zones, profile, media upload, Drop and event creation and lifecycle, guest claim codes, the review queue, public lists and details, sweepers, outbox, OpenAPI.

Not in Phase 1: unlock, RSVP, bookings, offers, payments, Buddies, share, push, notification settings. Exact places, meet details and "after RSVP" addresses are reachable only by their owner and reviewers.
