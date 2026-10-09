# API integration tests (`test-api/`)

End-to-end HTTP tests for every endpoint (supertest against a real Nest app, real Postgres and Redis).
They run against a **dedicated** database, never the dev one.

## Run

```sh
docker compose -f docker-compose.dev.yml up -d     # postgres :5434, redis :6380
pnpm --filter api test:api
```

Defaults (override with env vars):

| Variable | Default |
|---|---|
| `TEST_DATABASE_URL` | `postgresql://workshop_registration:workshop_registration@localhost:5434/workshop_registration_test?schema=public` |
| `TEST_REDIS_URL` | `redis://localhost:6380/1` |

The run refuses to start if the database name does not contain `test` or Redis is db `0`.

## What happens on each run

`global-setup.ts` creates `workshop_registration_test` if missing, runs `prisma migrate deploy`, TRUNCATEs all tables,
loads the deterministic fixtures from `fixtures.ts` (users per role plus an inactive one, workshops in every
status/date/capacity case, registrations in every status, a waitlist, audit rows) and flushes Redis db 1.
Every run therefore starts from the same state and can be repeated back to back.

Spec files (`*.api-spec.ts`) run one at a time. Read-only specs use the fixtures; anything that mutates state
creates its own `S-xxxx` scratch workshop or `u-xxxx@test.local` user through the API, so files do not depend
on each other or on order. Rate limiting is disabled (`THROTTLE_DISABLED=true`); throttling is covered by `test/`.

Fixture logins (password `Passw0rd!test`): `admin@`, `manager@`, `staff@`, `inactive@` (deactivated) `test.local`.

## Files

`auth`, `rbac` (role x endpoint matrix), `users`, `workshops` (all list filters), `registrations`
(waitlist and promotion), `concurrency` (30 parallel registers, parallel cancels), `audit`, `health`.

Known backend issues are marked with `it.fails(...)` and a `BUG` comment so the suite stays green; remove
`.fails` once fixed.
