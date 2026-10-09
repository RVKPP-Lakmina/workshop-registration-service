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

## Session cookie

The browser signs in with an **HttpOnly session cookie** (name `SESSION_COOKIE_NAME`, default `wr_session`); the web app stores nothing in `localStorage`/`sessionStorage`. Cookie behaviour is configured per environment:

| Variable | Meaning |
|---|---|
| `COOKIE_SECURE` | `true` = HTTPS only. Required `true` in staging/production; `false` for http://localhost. |
| `COOKIE_SAMESITE` | `lax` (default), `strict`, or `none` (web and API on different sites; needs `COOKIE_SECURE=true`). |
| `COOKIE_DOMAIN` | Optional, e.g. `.example.com` to share the cookie between sub-domains. Empty = host-only. |
| `SESSION_COOKIE_NAME` | Cookie name. |

Because cookies are sent automatically, every write request must carry `X-Requested-With` (the web app does this) and `CORS_ORIGINS` must list the exact web origins; the API rejects the rest.
