# Raahi NOW API

NestJS 12 (ESM) backend for Raahi NOW. Phase 1: Drops and Events.

## Setup

```
cp .env.example .env
npm install        # .npmrc sets legacy-peer-deps=true
```

## Database

- Docker: `docker compose up -d` (PostgreSQL 16, databases `raahi_now` and `raahi_now_test`).
- No Docker: `npm run db:test` starts an embedded PostgreSQL 16 on port 5432 (user and password `postgres`, data in `.pgdata/`) and creates both databases. Leave it running; Ctrl-C stops it.

## Commands

- `npm test`: unit specs, no database.
- `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/raahi_now_test npm run test:e2e`
- `npm run lint`
