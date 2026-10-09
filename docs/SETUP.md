# Setup guide

This guide takes you from "I just cloned the repository" to a running, debuggable copy of the Workshop Registration Service. It assumes you have never used Docker, pnpm or the VS Code debugger before. Every command says what it does and what you should see.

> Commands are shown for **Windows (PowerShell)** and **macOS / Linux (bash/zsh)** only where they differ. If there is just one block, it works everywhere.

Contents

1. [Prerequisites](#1-prerequisites)
2. [How configuration works (environments)](#2-how-configuration-works-environments)
3. [Three ways to run the project](#3-three-ways-to-run-the-project)
   - [Option A: everything in Docker](#option-a-everything-in-docker)
   - [Option B: local development with hot reload](#option-b-local-development-with-hot-reload)
   - [Option C: debugging in VS Code](#option-c-debugging-in-vs-code)
4. [Seeded logins](#4-seeded-logins)
5. [Running the tests](#5-running-the-tests)
6. [Resetting the database](#6-resetting-the-database)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Prerequisites

| Tool | Why you need it | Install | Check it |
|---|---|---|---|
| Git | Download the code | <https://git-scm.com/downloads> | `git --version` |
| Node.js 22 or newer | Runs the API and the web build tools | <https://nodejs.org> (choose the LTS, 22 or higher) | `node --version` shows `v22.x` or higher |
| pnpm 11 | Installs the project's JavaScript packages (like npm, but faster and strict) | Comes with Node through *corepack* (below) | `pnpm --version` shows `11.x` |
| Docker Desktop | Runs PostgreSQL, Redis and (optionally) the whole app in containers, so you do not install databases by hand | <https://www.docker.com/products/docker-desktop/> | `docker --version` and `docker compose version` |
| VS Code | Editor with the debugger (only needed for Option C) | <https://code.visualstudio.com> | `code --version` |

**Docker must be running** before you use any `docker` command. On Windows and macOS, start "Docker Desktop" and wait until it says it is running.

### Enable pnpm (one time)

Corepack ships with Node and installs the exact pnpm version the project asks for (`packageManager` in the root `package.json`).

```sh
corepack enable
pnpm --version
```

You should see `11.25.0` (or another 11.x). If `corepack enable` fails with a permission error, open the terminal as Administrator (Windows) or run `sudo corepack enable` (macOS/Linux). Alternative: `npm install -g pnpm@11`.

### Get the code and install packages

```sh
git clone <repository-url> workshop-registration-service
cd workshop-registration-service
pnpm install
```

`pnpm install` downloads every dependency for the whole repository (about a minute the first time). You should end with no red errors. If you see `ERR_PNPM_IGNORED_BUILDS`, jump to [Troubleshooting](#pnpm-says-err_pnpm_ignored_builds).

---

## 2. How configuration works (environments)

The project has three **environments**. You pick one with the `APP_ENV` variable. If you do not set it, it is `development`.

| `APP_ENV` | For | Config file |
|---|---|---|
| `development` | Your own computer | `env/.env.development` |
| `staging` | A test copy of production on a server | `env/.env.staging` |
| `production` | The real system | `env/.env.production` |

Rules to remember:

- `env/.env.<name>.example` files are **committed templates**. They are safe to read and share.
- `env/.env.<name>` files are **your real settings** and are **git-ignored**. Never commit them: staging/production ones contain passwords.
- Create the real files from the templates with one command (it never overwrites a file that already exists):

  ```sh
  pnpm env:init
  ```

  You should see `created  env/.env.development` (and the same for staging and production, followed by a warning that those contain `CHANGE_ME_*` placeholders you must replace).
- A value that is already set in your terminal always wins over the value in the file.
- The API finds `env/.env.<APP_ENV>` by itself (it walks up to the repository root), so you do not need to copy files into `apps/api`.
- To work with another environment, set `APP_ENV` for one command.

  PowerShell:
  ```powershell
  $env:APP_ENV = "staging"; pnpm docker:up
  ```
  macOS / Linux:
  ```sh
  APP_ENV=staging pnpm docker:up
  ```
  Cross-platform helper: `pnpm with-env staging pnpm db:migrate`.

### The variables

Open `env/.env.development.example`: every variable is documented there. The ones that matter:

| Variable | What it does |
|---|---|
| `APP_ENV` | `development`, `staging` or `production`. Chooses which file is loaded and how strict validation is. |
| `PORT` | Port the API listens on (usually `3000`). |
| `DATABASE_URL` | How the API reaches PostgreSQL, e.g. `postgresql://user:password@host:port/database?schema=public`. |
| `REDIS_URL` | How the API reaches Redis (used for rate limiting). |
| `JWT_SECRET` | Secret used to sign login tokens. **At least 32 characters in staging/production**; anyone who knows it can forge logins. |
| `JWT_EXPIRES_IN` | How long a login lasts (e.g. `8h`). |
| `COOKIE_SECURE` | Send the session cookie only over HTTPS. `false` for local http; **must be `true` in staging/production** (the API refuses to start otherwise). |
| `COOKIE_SAMESITE` | `lax` (default) when the web app and API share a site, `none` when they are on different sites (needs HTTPS and `COOKIE_SECURE=true`). |
| `COOKIE_DOMAIN` / `SESSION_COOKIE_NAME` | Optional cookie domain (e.g. `.example.com`) and the cookie name (default `wr_session`). |
| `CORS_ORIGINS` | Comma-separated list of website addresses allowed to call the API from a browser, e.g. `http://localhost:5173,http://localhost:8080`. In staging/production it must be set and must not contain `localhost`. |
| `TRUST_PROXY` | `true` when the API sits behind nginx or a load balancer, so it sees the real visitor IP. |
| `THROTTLE_DISABLED` | `true` turns API rate limiting off (handy for tests; refused in staging/production). |
| `SEED_ON_START` | `true` loads the demo users and workshops every time the API container starts. Set `false` for real deployments. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Credentials for the PostgreSQL container and the port it is published on (on your computer). |
| `REDIS_PORT` | Port Redis is published on. |
| `WEB_PORT` | Port the website is published on in Docker (default `8080`). |
| `API_UPSTREAM`, `DNS_RESOLVER` | How the nginx container finds the API container. You normally do not change these. |
| `VITE_API_BASE_URL`, `VITE_API_PROXY_TARGET`, `VITE_APP_NAME` | Web app settings: where the browser sends API calls, where the Vite dev server forwards `/api`, and the name shown in the UI. |

In **staging and production** the API checks its settings when it starts and **refuses to boot with a clear error listing every problem** (secret shorter than 32 characters, `CHANGE_ME` placeholder left in, `localhost` in `CORS_ORIGINS`, `THROTTLE_DISABLED=true`).

More detail: [`env/README.md`](../env/README.md).

### Adding a new variable

1. Add it, with a comment, to all three `env/.env.<name>.example` files.
2. Add it to your own `env/.env.<name>` files.
3. Add it to the API's startup validation (`apps/api/src/config/validate.ts`) so a missing or wrong value is caught at boot.
4. If Docker needs it, pass it to the service under `environment:` in `docker-compose.yml`.
5. Mention it in the table above.

Variables for the web app must start with `VITE_`; anything else is invisible to the browser (this is a feature: it stops secrets leaking into the website).

---

## 3. Three ways to run the project

### Option A: everything in Docker

Best for: "just show me the app", demos, checking that the production images work. Needs only Docker.

1. Create the config files (once):
   ```sh
   pnpm env:init
   ```
2. Build and start everything:
   ```sh
   pnpm docker:up
   ```
   This runs `docker compose --env-file env/.env.development up --build`, which builds the API and web images, starts PostgreSQL and Redis, applies database migrations, loads demo data (when `SEED_ON_START=true`), and starts the API and nginx. The first build takes a few minutes.

   You should see log lines like `[entrypoint] prisma migrate deploy` and `[entrypoint] seeding demo data`, then the API reporting it started. Leave this terminal open; `Ctrl+C` stops it.
3. Open <http://localhost:8080> (or your `WEB_PORT`) and sign in with a [seeded login](#4-seeded-logins).
4. Check the API: <http://localhost:8080/api/health> should show `{"status":"ok"}`.

Stop it:

```sh
pnpm docker:down
```

The data stays in a Docker volume. To delete the data too, see [Resetting the database](#6-resetting-the-database).

Raw equivalent without pnpm: `docker compose --env-file env/.env.development up --build`.

Port 8080 refused (common on Windows)? Set `WEB_PORT=8181` in `env/.env.development`, run again, and open <http://localhost:8181>.

### Option B: local development with hot reload

Best for: changing code. PostgreSQL and Redis run in Docker; the API and web app run on your computer and reload when you save a file.

1. Create the config files and install packages (once): `pnpm env:init` then `pnpm install`.
2. Start only the databases:
   ```sh
   pnpm docker:dev-deps
   ```
   You should see the `postgres` and `redis` containers reported as `Healthy`. They are published on your computer at `POSTGRES_PORT` / `REDIS_PORT` from `env/.env.development` (check the file for the numbers; they are usually not 5432/6379 so they do not collide with a Postgres you may already have).
3. Create the tables and the demo data:
   ```sh
   pnpm db:migrate
   pnpm db:seed
   ```
   You should see the migrations being applied (or "No pending migrations") and the seed finishing without errors. Both are safe to run again.
4. Start the API and the web app together:
   ```sh
   pnpm dev
   ```
   - Web: <http://localhost:5173>
   - API: <http://localhost:3000/api/health>

   The Vite dev server forwards every `/api/...` request to the API, so the browser only talks to port 5173.
5. Stop with `Ctrl+C`. Stop the databases with `pnpm docker:dev-deps:down`.

### Option C: debugging in VS Code

A debugger lets you pause the program on a line (a *breakpoint*), look at variable values and step forward line by line. The project ships ready-made configurations in `.vscode/`.

#### One-time VS Code preparation

1. Open the **workshop-registration-service folder** in VS Code (`File > Open Folder...`, the folder that contains `package.json`).
2. Click **Install** on the popup "Do you want to install the recommended extensions?" (or open the Extensions panel and type `@recommended`). The useful ones: Prisma, ESLint, Oxc, Docker, HashiCorp Terraform, Vitest Explorer, Tailwind CSS IntelliSense.
3. In the VS Code terminal run `pnpm install` and `pnpm env:init` if you have not already.

#### C1. Debug the API on your computer (recommended)

Example goal: stop inside the code that registers an attendee.

1. Open `apps/api/src/registrations/registrations.service.ts`.
2. Click in the grey margin just left of a line number inside the method that creates a registration. A **red dot** appears: that is a breakpoint.
3. Open **Run and Debug** (the play-with-bug icon on the left, or `Ctrl+Shift+D`).
4. In the dropdown at the top choose **API: debug (Nest, node)** and press the green triangle (`F5`).

   What happens: VS Code runs the task *api: prepare (env, deps, build)* (creates `env/.env.development` if missing, starts Postgres and Redis in Docker, builds the API), then starts `dist/main.js` under the debugger. The Debug Console shows the API's start-up logs and the status bar turns orange.
5. Start the web app in a terminal: `pnpm --filter web dev`. Open <http://localhost:5173>, sign in as `staff@workshop.local` and register an attendee on a workshop. (Or use C3 to do all this with one click.)
6. VS Code jumps to your red dot and pauses. You can now:
   - Hover over variables to see their values; look at the **Variables** panel on the left.
   - `F10` step over, `F11` step into, `Shift+F11` step out, `F5` continue.
   - Type an expression in the Debug Console to evaluate it.
7. Stop with the red square (`Shift+F5`).

Notes
- The API runs the **compiled** code in `dist/` and maps it back to your `.ts` files through source maps, so breakpoints appear in the TypeScript. After you edit code, stop and press `F5` again (the build step re-runs).
- If the red dot turns **grey** ("Unbound breakpoint"), see [Troubleshooting](#breakpoints-are-grey-or-never-hit).

**Alternative with auto-reload:** run the task *api: watch (debug :9229)* (`Terminal > Run Task...`), which executes `nest start --debug --watch`. Then choose **API: attach (local :9229)** and press `F5`. The debugger re-attaches by itself every time Nest restarts after a file change.

#### C2. Attach to the API running in Docker

Use this when the bug only shows up inside the container setup.

1. Start the stack with the debug override (it publishes the debug port 9229 on `127.0.0.1` only):
   ```sh
   pnpm docker -f docker-compose.debug.yml up --build
   ```
   Raw equivalent: `docker compose --env-file env/.env.development -f docker-compose.yml -f docker-compose.debug.yml up --build`. You should see `Debugger listening on ws://0.0.0.0:9229/...` in the API logs.
2. Choose **API: attach (Docker)** in Run and Debug and press `F5`. The status bar turns orange.
3. Set a breakpoint as in C1 and trigger it from <http://localhost:8080>.

`docker-compose.debug.yml` is for development only: never use it for staging or production, because an open debug port lets anyone who reaches it run code inside the API.

#### C3. API and web together

Choose the compound **Full stack: API + Web**. It starts the API under the debugger and the Vite dev server, then opens Chrome on <http://localhost:5173> with the browser debugger attached, so you can also set breakpoints in React code (`apps/web/src/...`). Stopping one stops both.

#### C4. Debug a test

Open a test file (for example `apps/api/src/registrations/registrations.service.spec.ts`), put a breakpoint inside a test, choose one of these configurations and press `F5`:

| Configuration | Debugs the open file as |
|---|---|
| Test: API unit (current file) | an API unit test (`*.spec.ts`) |
| Test: API e2e (current file) | an API e2e test (`apps/api/test/*.e2e-spec.ts`) |
| Test: API integration test-api (current file) | an HTTP integration test (`apps/api/test-api/*.api-spec.ts`) |
| Test: Web (current file) | a web test (`*.test.ts(x)`) |

The e2e and integration ones need the databases (`pnpm docker:dev-deps`). The **Vitest Explorer** extension also adds a beaker icon in the sidebar to run or debug single tests with a click.

#### Useful tasks

`Terminal > Run Task...` lists: *setup: first time*, *env: init*, *deps: up*, *db: migrate*, *db: seed*, *dev: API + Web*, *check: lint, types, build*, and one task per test suite.

> **What was and was not verified.** The configuration files were written and the underlying mechanics were checked from a terminal: the built API starts with the inspector open, its compiled files carry source maps, a debugger client could set a breakpoint on `registrations.service` through the inspector, and the Docker override passes `docker compose config`. The graphical flow inside VS Code itself (pressing F5, the Chrome launch, the compound, the Docker attach) was **not** exercised by hand. If a step behaves differently on your machine, check Troubleshooting.

---

## 4. Seeded logins

Created by `pnpm db:seed` (and by the API container when `SEED_ON_START=true`). Development only.

| Role | Email | Password | Can do |
|---|---|---|---|
| Admin | `admin@workshop.local` | `Admin123!` | Create users and set roles (nothing else) |
| Manager | `manager@workshop.local` | `Manager123!` | Add/edit workshops, register/cancel, view everything |
| Staff | `staff@workshop.local` | `Staff123!` | Register/cancel, view workshops, registrations and history |

Eight sample workshops are created too, including a full one with a waitlist (`COD-310`), a cancelled one and a completed one. Re-running the seed does not duplicate anything.

---

## 5. Running the tests

All commands run from the repository root. "Needs databases" means run `pnpm docker:dev-deps` first.

| Command | Needs databases | What it proves |
|---|---|---|
| `pnpm --filter api test:unit` | No | The business logic of each service (auth, users, workshops, registrations, audit, guards, filters) works in isolation with fakes. Fast. Also prints a coverage table. |
| `pnpm --filter api test:api` | Yes | Every HTTP endpoint behaves correctly against a **real** Postgres and Redis, including role permissions, filters, waitlist promotion and 30 simultaneous registrations. It uses its own **`workshop_registration_test`** database (created automatically, wiped at the start of every run) and Redis db 1, so development data is never touched. It refuses to start if the database name does not contain `test`. |
| `pnpm --filter api test:e2e` | Yes | The original end-to-end suite against the **development** database: capacity (30 parallel registrations on a 5-seat workshop), role matrix and rate limiting. It removes the data it creates afterwards. |
| `pnpm --filter web test` | No | The React app: login, routing/role protection, workshop list/form/detail, users and audit pages, API client (against a fake API). |
| `pnpm --filter web test:coverage` | No | Same, plus a coverage report in `apps/web/coverage`. |
| `pnpm exec turbo run lint check-types build` | No | Code style, TypeScript types, and that both apps compile. CI runs this first. |

You should see `Test Files  N passed` and `Tests  N passed` at the end of each run. For re-run-on-save: `pnpm --filter api test:watch` or `pnpm --filter web test:watch`.

If your test databases use other ports or passwords, set `TEST_DATABASE_URL` and `TEST_REDIS_URL` (see `apps/api/test-api/README.md`). The built-in defaults point at the ports of the example development setup.

CI runs these on GitHub for every push and pull request (`.github/workflows/`).

---

## 6. Resetting the database

**This deletes all data in that environment.**

*Docker full stack (Option A):*
```sh
pnpm docker:down -v
pnpm docker:up
```
`-v` also deletes the data volume. The next start migrates and seeds from scratch.

*Local development databases (Option B):*
```sh
pnpm docker:dev-deps:down -v
pnpm docker:dev-deps
pnpm db:migrate
pnpm db:seed
```

*Only the test database:* nothing to do, `test:api` resets `workshop_registration_test` on every run.

---

## 7. Troubleshooting

### "Cannot connect to the Docker daemon" / "error during connect"
Docker Desktop is not running. Start it, wait until it says it is running, then retry. On Linux: `sudo systemctl start docker`.

### Windows refuses to bind port 8080 ("ports are not available", "forbidden by its access permissions")
Windows (Hyper-V / WSL) reserves some port ranges, and other programs may hold 8080. Pick another port: set `WEB_PORT=8181` in `env/.env.development` and open <http://localhost:8181>. If you open the site on a different address, add that origin to `CORS_ORIGINS`. To see reserved ranges: `netsh interface ipv4 show excludedportrange protocol=tcp`.

### Another PostgreSQL already uses the port
Symptoms: `port is already allocated`, or the API connects to the *wrong* database and reports a password failure. Find what holds the port.

PowerShell:
```powershell
Get-NetTCPConnection -LocalPort 5434 | Select-Object OwningProcess
Get-Process -Id <number>
```
macOS / Linux: `lsof -i :5434`

Fix: change `POSTGRES_PORT` in `env/.env.development` **and** the port inside `DATABASE_URL` to match, then run `pnpm docker:dev-deps` again.

### pnpm says `ERR_PNPM_IGNORED_BUILDS`
pnpm 11 blocks packages from running install scripts unless you allow them. The repository allows the ones it needs in `pnpm-workspace.yaml` under `allowBuilds` (`@prisma/engines`, `@swc/core`, `esbuild`, `prisma`). If you add a dependency that needs a build script, pnpm prints its name; add `name: true` under `allowBuilds`, then run `pnpm install` again. Do not disable the check.

### `pnpm: command not found` or wrong pnpm version
Run `corepack enable` (see Prerequisites), close and reopen the terminal, and check `pnpm --version`.

### `\r: command not found`, "bad interpreter", or `exec ./docker-entrypoint.sh: no such file or directory`
A shell script was saved with Windows line endings (CRLF). Linux containers need LF. The repository's `.gitattributes` forces LF for `*.sh`, so re-checkout the file:
```sh
git rm --cached apps/api/docker-entrypoint.sh
git checkout -- apps/api/docker-entrypoint.sh
```
Or in VS Code click `CRLF` in the bottom-right status bar, choose `LF`, save, and rebuild with `pnpm docker:up`.

### `Cannot find module '.../generated/prisma/client'`
The Prisma client (generated database code) was never generated. Run `pnpm db:generate`. It also runs automatically as part of `pnpm --filter api build`.

### API exits at start with "Invalid environment configuration" / JWT_SECRET
The API lists every problem. Typical ones: `JWT_SECRET` shorter than 32 characters or still `CHANGE_ME...`, `localhost` inside `CORS_ORIGINS`, `THROTTLE_DISABLED=true` in staging/production, or a missing `DATABASE_URL`. Generate a secret:

- macOS / Linux: `openssl rand -base64 48`
- Any OS (Node): `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`

Paste it into `env/.env.<APP_ENV>` as `JWT_SECRET=...`. Changing it logs everyone out.

### `Missing env/.env.development. Run pnpm env:init`
You skipped the config step. Run `pnpm env:init`.

### Login says "Too many requests" (HTTP 429) while testing
Rate limits protect login (nginx: 5 per minute per IP; API: 10 attempts per minute per IP and email; 120 requests per minute per user). Wait a minute, or for local work set `THROTTLE_DISABLED=true` in `env/.env.development` (turns off the API limits only; nginx limits in Docker remain, so use `pnpm dev` at <http://localhost:5173> for heavy manual testing). The automated tests already disable throttling except in the dedicated throttle test.

### Browser shows a CORS error
The address in the browser bar is not in `CORS_ORIGINS`. Add it (exact scheme and port, no trailing slash, comma-separated) and restart the API.

### Web shows "Network Error" or empty data in `pnpm dev`
The API is not running or `VITE_API_PROXY_TARGET` points at the wrong port. Check <http://localhost:3000/api/health>.

### Breakpoints are grey or never hit
- Use the **launch** configuration (it rebuilds), or restart after editing.
- Check that `apps/api/dist/**/*.js.map` files exist (`pnpm --filter api build`).
- Docker attach: the API logs must say `Debugger listening`, and `localhost:9229` must not be used by another debug session.
- Chrome: if Vite moved to 5174 because 5173 was busy, close the other dev server and restart.

### Port 5173 or 3000 already in use
Another dev server is running. Stop it (`Ctrl+C` in its terminal) or find the process as described above.

### Still stuck
Run `pnpm docker:config` (validates the compose files and environment), then `docker compose --env-file env/.env.development ps` and `docker compose --env-file env/.env.development logs api`, and include the output when asking for help.
