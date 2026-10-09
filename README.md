# Workshop Registration Service

Full-stack app for a training centre: staff register attendees for workshops with limited seats, and a workshop can **never** hold more active registrations than its capacity, even when several people book the last seat at the same moment.

- **API:** NestJS 12, Prisma 7, PostgreSQL 16, Redis 7 (rate limiting) in `apps/api`
- **Web:** React 19, Vite, Tailwind v4, React Query in `apps/web`
- **Edge/infra:** nginx (SPA, reverse proxy, rate limits), Docker Compose, GitHub Actions CI, Terraform for AWS API Gateway (validated, never applied) in `infra/`

## Quick start

Needs Node 22+, pnpm 11 (`corepack enable`) and Docker running. New to these tools? Read [docs/SETUP.md](docs/SETUP.md) first.

```sh
pnpm install
pnpm env:init        # creates env/.env.development from the committed template
pnpm docker:up       # builds and starts everything; open http://localhost:8080
```

Port 8080 refused (common on Windows)? Set `WEB_PORT=8181` in `env/.env.development`.

Coding with hot reload instead (databases in Docker, apps on your machine):

```sh
pnpm docker:dev-deps && pnpm db:migrate && pnpm db:seed
pnpm dev             # web http://localhost:5173, api http://localhost:3000/api
```

## Documentation

| Document | What is in it |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Prerequisites, environments, three ways to run, VS Code debugging, tests, resetting data, troubleshooting |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying to staging/production: hosting options, release flow, secrets, first admin, backups, rollback, go-live checklist |
| [docs/TERRAFORM.md](docs/TERRAFORM.md) | The AWS API Gateway Terraform: install, credentials, plan/apply/destroy, remote state, cost and safety |
| [docs/DESIGN.md](docs/DESIGN.md) | Design decisions: concurrency, access control, audit, rate limiting, trade-offs |
| [env/README.md](env/README.md) | How `APP_ENV` and the `env/.env.*` files work |
| [apps/api/test-api/README.md](apps/api/test-api/README.md) | The HTTP integration test suite and its `workshop_registration_test` database |

## Seeded logins (dev only)

| Role    | Email                    | Password    | Can do |
|---------|--------------------------|-------------|--------|
| Admin   | admin@workshop.local     | Admin123!   | Create users and set roles (nothing else) |
| Manager | manager@workshop.local   | Manager123! | Add/edit workshops, register/cancel, view everything |
| Staff   | staff@workshop.local     | Staff123!   | Register/cancel, view workshops, registrations and history |

Eight sample workshops are seeded (this week and next, three locations), including one full workshop with a waitlist (`COD-310`), one cancelled and one completed. Seeding runs automatically in Docker while `SEED_ON_START=true`; turn it off for any real deployment.

## Tests and checks

```sh
pnpm --filter api test:unit      # service logic, no database needed
pnpm docker:dev-deps             # start Postgres + Redis for the next two
pnpm --filter api test:api       # every endpoint against a clean workshop_registration_test database
pnpm --filter api test:e2e       # includes 30 parallel registrations on a 5-seat workshop
pnpm --filter web test           # React app
pnpm exec turbo run lint check-types build
```

What each one proves is explained in [docs/SETUP.md](docs/SETUP.md#5-running-the-tests). Details of the integration suite: `apps/api/test-api/README.md`.

## Project map

| Path | What it is |
|---|---|
| [`apps/api`](apps/api) | NestJS API: auth, users, workshops, registrations, audit, health, plus the Prisma schema and seed |
| [`apps/web`](apps/web) | React single-page app |
| [`env`](env) | Environment templates (`.env.<APP_ENV>.example`); your real `.env.*` files stay git-ignored |
| [`scripts`](scripts) | Cross-platform helpers behind `pnpm env:init`, `pnpm docker:*` and `pnpm with-env` |
| [`infra/nginx`](infra/nginx) | nginx config template: SPA fallback, `/api` proxy, rate limits |
| [`infra/aws`](infra/aws) | Terraform for an API Gateway HTTP API with CORS and throttling (validated, never applied) |
| [`docs`](docs) | Setup, deployment, Terraform and design guides |
| [`.vscode`](.vscode) | Debug configurations, tasks and recommended extensions |
| [`.github/workflows`](.github/workflows) | CI: lint, typecheck, build and tests; image build and push to GHCR on `main` |
| [`docker-compose.yml`](docker-compose.yml) | Full stack: Postgres, Redis, API and nginx |
| [`docker-compose.dev.yml`](docker-compose.dev.yml) | Postgres and Redis only, for local coding (`pnpm docker:dev-deps`) |
| [`docker-compose.debug.yml`](docker-compose.debug.yml) | Optional override that publishes the API debug port 9229 |

## API summary (`/api`)

| Endpoint | Roles |
|---|---|
| `POST /auth/login`, `GET /auth/me` | public / any user |
| `GET/POST /users`, `PATCH /users/:id` | Admin |
| `GET /workshops` (`from,to,status,hasSeats,q,location`), `GET /workshops/:id` | Manager, Staff |
| `POST /workshops`, `PATCH /workshops/:id` | Manager |
| `GET/POST /workshops/:id/registrations`, `POST /registrations/:id/cancel` | Manager, Staff |
| `GET /audit` | Admin (account events); Manager/Staff (workshop and registration events) |
| `GET /health` | public |

Errors are always `{ statusCode, code, message }`. A route without an explicit role list is refused (default deny).
