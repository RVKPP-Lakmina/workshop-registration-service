# env/

Single source of truth for configuration. `APP_ENV` (development | staging | production,
default `development`) selects `env/.env.<APP_ENV>`.

- `*.example` files are committed templates (every variable is documented there).
- `env/.env.development|staging|production` are real, gitignored files. Create them with
  `pnpm env:init` (never overwrites). Staging/production templates contain `CHANGE_ME_*`
  secrets that MUST be replaced; the API refuses to boot otherwise.
- Real process environment variables always win over file values.
- Used by: the API (`apps/api/src/config`), prisma config + seed, Vite (`envDir`), and
  `docker compose --env-file env/.env.<APP_ENV>` (see `scripts/compose.mjs`).
