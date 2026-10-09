# Deployment guide (staging and production)

This guide is for people who have never deployed a web application. It explains what the pieces are, two practical ways to host them, how a release gets from GitHub to a server, and what to check before you tell users the system is live.

> **Honesty box.** This repository has **never been deployed** to a real server or cloud account. The Docker images are built and pushed by CI, and the Compose file is exercised locally, but nothing below has been run against a real VM, AWS account, DNS name or certificate. Steps are marked **(not verified)** where that matters. Treat the first deployment as a rehearsal on *staging*.

Contents

1. [What you are deploying](#1-what-you-are-deploying)
2. [Choose a host](#2-choose-a-host)
3. [The release flow (CI to server)](#3-the-release-flow-ci-to-server)
4. [Secrets handling](#4-secrets-handling)
5. [First-deploy checklist](#5-first-deploy-checklist)
6. [Option 1: one VM with Docker Compose and HTTPS](#6-option-1-one-vm-with-docker-compose-and-https)
7. [Option 2: AWS ECS Fargate, RDS and ElastiCache](#7-option-2-aws-ecs-fargate-rds-and-elasticache)
8. [Database migrations in production](#8-database-migrations-in-production)
9. [Backups](#9-backups)
10. [Health checks, monitoring, rollback](#10-health-checks-monitoring-and-rollback)
11. [Known gaps](#11-known-gaps)
12. [Go-live checklist](#12-go-live-checklist)

---

## 1. What you are deploying

Two container images, built from this repository by CI, plus two stock services:

```
                       Internet
                          |
                  HTTPS (port 443)
                          |
        +-----------------v------------------+
        |  TLS terminator / reverse proxy    |   Caddy, or an AWS load balancer
        |  (certificate lives here)          |   (HTTP to the web container)
        +-----------------+------------------+
                          | HTTP (port 80)
              +-----------v------------+
              |  web  (nginx image)    |   serves the React app,
              |  ghcr.io/<owner>/      |   rate-limits, proxies /api
              |  workshop-registration-web            |
              +-----------+------------+
                          | /api/*  -> http://api:3000
              +-----------v------------+
              |  api  (NestJS image)   |   ghcr.io/<owner>/workshop-registration-api
              |  runs migrations on    |   health: GET /api/health
              |  start                 |
              +------+-------------+---+
                     |             |
          +----------v---+     +---v-----------+
          | PostgreSQL 16|     |   Redis 7     |
          | (all data)   |     | (rate limits) |
          +--------------+     +---------------+
```

- **web**: the website. Its nginx also forwards anything under `/api` to the API, so the browser only ever talks to one address.
- **api**: the business logic. On every start it applies pending database migrations (`prisma migrate deploy`) and, only if `SEED_ON_START=true`, loads demo data.
- **PostgreSQL**: the single source of truth. **Back it up.**
- **Redis**: only holds rate-limit counters. Losing it loses nothing important.

Optional extra (see [TERRAFORM.md](TERRAFORM.md)): an AWS API Gateway in front of the API. It has never been applied and is not required.

## 2. Choose a host

| | Option 1: single VM + Docker Compose | Option 2: AWS ECS Fargate + RDS + ElastiCache |
|---|---|---|
| Best for | Staging, small teams, getting live quickly | Production that needs managed databases, scaling, no server upkeep |
| You manage | One Linux server (updates, disk, backups) | AWS resources (many pieces, more cost) |
| HTTPS | Caddy (automatic Let's Encrypt certificates) | Application Load Balancer + AWS Certificate Manager |
| Database | PostgreSQL container with a volume | RDS PostgreSQL (automatic backups) |
| Cost | Roughly the price of one small VM | Noticeably higher (Fargate tasks, RDS, ElastiCache, load balancer) |
| Effort | Hours | Days |

Recommendation: rehearse on Option 1 as `staging`; choose Option 2 only if you need managed databases or high availability.

## 3. The release flow (CI to server)

The workflow `.github/workflows/ci.yml` does this:

1. On every pull request and on pushes to `main` and `dev`, job **verify** installs dependencies, runs `lint`, `check-types` and `build`, applies migrations to a throwaway Postgres and runs the e2e tests. Two more workflows (`unit-tests.yml`, `api-tests.yml`, `web-tests.yml`) run the unit, API-integration and web tests.
2. **Only on a push to `main`**, once `verify` passes, job **images** builds both Dockerfiles and pushes to the GitHub Container Registry (GHCR):

   | Image | Tags |
   |---|---|
   | `ghcr.io/<github-owner>/workshop-registration-api` | `sha-<short-commit>` and `latest` |
   | `ghcr.io/<github-owner>/workshop-registration-web` | `sha-<short-commit>` and `latest` |

   `<github-owner>` is your GitHub user or organisation name, in lower case.
3. **CI does not deploy.** Nothing contacts a server. Someone (or a future workflow) must pull the new images and restart the services. That step is described in the options below.

Always deploy a **specific `sha-...` tag** rather than `latest`: it tells you exactly what runs and makes rollback a one-line change.

Making the images pullable: GHCR packages created by CI are **private** by default. Either log in on the server (below) with a token that has `read:packages`, or make the packages public in GitHub (Packages > package settings).

## 4. Secrets handling

Secrets are passwords and keys: `JWT_SECRET`, `POSTGRES_PASSWORD` and any `DATABASE_URL` containing a password.

Rules:

- **Never commit** `env/.env.staging` or `env/.env.production`. They are git-ignored; keep it that way. Only the `*.example` templates (with `CHANGE_ME_*` placeholders) are committed.
- Create the files on the target machine, not on your laptop:
  ```sh
  pnpm env:init            # or copy env/.env.production.example to env/.env.production by hand
  ```
  then edit the file. The API refuses to start in staging/production while `JWT_SECRET` is shorter than 32 characters or still contains a `CHANGE_ME` placeholder, while `CORS_ORIGINS` is empty or mentions `localhost`, or while `THROTTLE_DISABLED=true`.
- Generate strong values (any OS with Node): `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Use a different value for staging and production.
- Use a password manager for the master copy. Do not paste secrets in chat or tickets.
- **GitHub Actions secrets** (Settings > Secrets and variables > Actions) are the place for anything a future deploy workflow needs (SSH key, AWS role). The current workflows need none: they use the automatic `GITHUB_TOKEN`.
- **AWS (Option 2):** store `JWT_SECRET` and the database password in **AWS Secrets Manager** (or SSM Parameter Store, type `SecureString`) and reference them from the ECS task definition's `secrets` section, so they never appear in plain text in the console or in the repository.
- If a secret leaks: change it, redeploy, and note that changing `JWT_SECRET` logs everyone out.

## 5. First-deploy checklist

Do these in order the first time, for each environment:

1. [ ] Decide the public address (for example `https://workshops.example.com`) and point its DNS at the server or load balancer.
2. [ ] Create the real env file from the template (see section 4).
3. [ ] Set `JWT_SECRET` to a new random value of at least 32 characters.
4. [ ] Set a strong `POSTGRES_PASSWORD` (letters and digits are safest; special characters must be URL-encoded inside `DATABASE_URL`) and make `DATABASE_URL` use the same password. Inside Docker Compose the API container builds its own database address from the `POSTGRES_*` values; `DATABASE_URL` is what you use when running tools such as migrations from outside the containers, and the API's start-up check still requires it, so keep both consistent.
5. [ ] Set `CORS_ORIGINS` to your real site address(es), exactly, with `https://` and no trailing slash, for example `https://workshops.example.com`.
6. [ ] Set `TRUST_PROXY` to match your proxy chain (`true` means "one proxy in front"; see Known gaps for the Caddy + nginx case).
7. [ ] Set `SEED_ON_START=false`. Demo users have **public passwords** (they are in the README). They must never exist in a real system.
8. [ ] Start the system; check `/api/health` (section 10).
9. [ ] Create the first real admin (below).
10. [ ] Sign in as that admin and create the other real users.

### Creating the first real admin (what exists today)

The API has **no self-service sign-up and no "create first admin" command**. Users can only be created by an existing Admin, and the only built-in way to get users into an empty database is the demo seed (`prisma/seed.ts`), which creates the three demo accounts with known passwords. So today there are two mechanisms:

**Mechanism A (recommended): insert one admin row directly with SQL.** Works on an empty database after the first start (migrations have created the tables).

1. Generate a bcrypt hash of your chosen password on any machine with the repository installed (replace the password, keep the single quotes; run from the repository root):

   ```sh
   cd apps/api
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'YourLongUniquePassword'
   ```
   You should see a string starting with `$2b$10$` or `$2a$10$`.
2. Run this SQL against the production database, pasting the hash (bash on the VM, with the Compose project name used in section 6; use `psql` against RDS in Option 2):

   ```sh
   docker compose --env-file env/.env.production exec postgres \
     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
     "INSERT INTO users (id, email, name, password_hash, role, is_active, updated_at)
      VALUES (gen_random_uuid(), 'you@yourcompany.com', 'Your Name', '<PASTE_HASH_HERE>', 'ADMIN', true, now());"
   ```
   You should see `INSERT 0 1`. (This statement was checked against the development database and rolled back; it was not run against a real production system.)
3. Sign in on the website with that email and password. From then on, create managers and staff through the **Users** page. An Admin can also reset any user's password there.

Careful with the shell: a `$` in the hash can be interpreted by your shell. Keep the SQL inside the quotes as shown, or run `psql` interactively and paste the statement.

**Mechanism B (works, but less safe): use the demo seed once, then replace it.** Start with `SEED_ON_START=true`, sign in as `admin@workshop.local`, create your real admin, sign in as that admin and **deactivate all three demo accounts**, then set `SEED_ON_START=false` and restart. The demo accounts and sample workshops exist, with public passwords, between the first start and the clean-up, so only do this on a server not yet reachable by users. Note that seeded sample workshops remain unless you delete them in the database.

## 6. Option 1: one VM with Docker Compose and HTTPS

**(not verified on a real server)**

### 6.1 Prepare the server

1. Create a Linux VM (Ubuntu 22.04/24.04 LTS, 2 vCPU / 4 GB RAM is plenty) at any provider.
2. In the provider's firewall (security group) allow inbound **22** (SSH, ideally only from your IP), **80** and **443**. Do **not** open 5432 (PostgreSQL), 6379 (Redis), 3000 or 9229.
3. SSH in and install Docker Engine plus the Compose plugin: <https://docs.docker.com/engine/install/ubuntu/>. Check with `docker compose version`.
4. Install Node 22 and pnpm only if you want to use the `pnpm docker:*` helpers. They are optional: the raw `docker compose` commands below work without them.

### 6.2 Get the files and configuration

```sh
git clone <repository-url> /opt/workshop-registration && cd /opt/workshop-registration
cp env/.env.production.example env/.env.production
nano env/.env.production        # follow the first-deploy checklist
```

Because the repository's `docker-compose.yml` *builds* images from source, create a small override file `docker-compose.images.yml` so the server instead *pulls* the CI-built images (replace `<owner>` and the tag):

```yaml
services:
  api:
    image: ghcr.io/<owner>/workshop-registration-api:sha-abc1234
  web:
    image: ghcr.io/<owner>/workshop-registration-web:sha-abc1234
```

(Keep this file on the server or commit it once you have tested it. It is not part of the repository today.)

If the packages are private, log in once (create a token at GitHub > Settings > Developer settings > Personal access tokens with `read:packages`):

```sh
echo <TOKEN> | docker login ghcr.io -u <github-username> --password-stdin
```

### 6.3 Start it

```sh
docker compose --env-file env/.env.production \
  -f docker-compose.yml -f docker-compose.images.yml pull
docker compose --env-file env/.env.production \
  -f docker-compose.yml -f docker-compose.images.yml up -d --no-build
docker compose --env-file env/.env.production ps
```

You should see all four services `running`, with `postgres`, `redis` and `api` reported `healthy` after about a minute. The Compose project name for production is `workshop-registration-production` (staging: `workshop-registration-staging`), so containers and volumes do not collide between environments on one machine. Watch the API start with:

```sh
docker compose --env-file env/.env.production logs -f api
```

If it exits immediately, the log lists every configuration problem (weak secret, missing `CORS_ORIGINS`, ...). Fix the env file and run `up -d` again.

Test from the server: `curl -s http://localhost:8080/api/health` should print `{"status":"ok"}` (use your `WEB_PORT` if you changed it).

### 6.4 Add HTTPS with Caddy

Browsers and passwords need HTTPS. The web container only speaks plain HTTP, so put a reverse proxy in front. Caddy fetches and renews free certificates automatically.

1. Make sure DNS for `workshops.example.com` points to the server's IP.
2. Install Caddy: <https://caddyserver.com/docs/install>.
3. Put this in `/etc/caddy/Caddyfile`:

   ```
   workshops.example.com {
       reverse_proxy localhost:8080
   }
   ```
4. `sudo systemctl reload caddy`. Open `https://workshops.example.com`.

You should see the login page with a padlock. Remember `CORS_ORIGINS=https://workshops.example.com`.

(Because the web container publishes `WEB_PORT` on all interfaces, rely on the firewall rule from 6.1 so only Caddy on 80/443 is reachable from outside.)

### 6.5 Updating to a new release

1. Wait for CI on `main` to finish green; note the new `sha-...` tag in GitHub > Packages.
2. Edit the two tags in `docker-compose.images.yml`.
3. Run the `pull` and `up -d --no-build` commands from 6.3. The API container restarts, applies new migrations, and serves again within seconds. Expect a short interruption.
4. Check `/api/health`, sign in, open a workshop.

## 7. Option 2: AWS ECS Fargate, RDS and ElastiCache

**(not verified: nothing below has been created in AWS)**. This is an outline of what to build; each step has good AWS documentation, which you should follow for the clicking details.

Layout (one region, one VPC with public and private subnets):

```
Route 53 / DNS -> Application Load Balancer (HTTPS, ACM certificate)
                        |
                  ECS Fargate service (private subnets), one task with TWO containers:
                     - web  (workshop-registration-web image, port 80)   <- receives the load balancer traffic
                     - api  (workshop-registration-api image, port 3000) <- web proxies /api to it on localhost
                        |                         |
               RDS PostgreSQL 16          ElastiCache Redis
               (private subnets)          (private subnets)
```

Steps:

1. **Container images.** CI pushes to GHCR. ECS can pull from GHCR if you store a GitHub token in Secrets Manager and reference it as the task's `repositoryCredentials`. Alternatively copy the images to Amazon ECR.
2. **RDS PostgreSQL 16**: create a database `workshop_registration` and a user; enable automated backups (7+ days) and encryption; place in private subnets; security group allows 5432 only from the ECS tasks' security group.
3. **ElastiCache Redis 7**: a small single node is enough; security group allows 6379 only from the ECS tasks. For in-transit encryption use `rediss://` in `REDIS_URL`.
4. **Secrets**: put `JWT_SECRET` and the database password in Secrets Manager; reference them in the task definition `secrets`.
5. **Task definition** (Fargate, awsvpc): two containers sharing the task network:
   - `api`: image `workshop-registration-api`; environment `APP_ENV=production`, `PORT=3000`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (from secret), `JWT_EXPIRES_IN`, `CORS_ORIGINS=https://workshops.example.com`, `TRUST_PROXY=2` (load balancer plus the web nginx), `SEED_ON_START=false`. Health check: `wget -qO- http://127.0.0.1:3000/api/health`.
   - `web`: image `workshop-registration-web`, port 80; set `API_UPSTREAM` to `http://127.0.0.1:3000` (containers in one Fargate task reach each other on localhost). See the comments in `env/.env.production.example` for `API_UPSTREAM` and `DNS_RESOLVER`.
6. **Load balancer**: ALB with an ACM certificate for your domain, HTTPS listener forwarding to a target group on the web container's port 80 with health check path `/healthz` (served by nginx itself).
7. **ECS service**: desired count 1 to start (2 for availability); deploy new releases by registering a task definition with the new `sha-...` image tags and updating the service. Enable the deployment circuit breaker with rollback.
8. **Logs**: use the `awslogs` driver to send both containers' logs to CloudWatch.
9. Optionally add the API Gateway from [TERRAFORM.md](TERRAFORM.md) in front of `/api`. This is not needed for the app to work.

Terraform in this repository only covers the API Gateway, **not** any of the above (see [TERRAFORM.md](TERRAFORM.md)).

## 8. Database migrations in production

- Migrations are SQL files in `apps/api/prisma/migrations/`. The API container's entrypoint runs `prisma migrate deploy` every time it starts: it applies only migrations not yet recorded as applied, and does nothing otherwise. It never resets or drops data.
- So a release that includes a migration migrates the database automatically when the new API container starts. If the migration fails, the container exits and the old schema stays as it was; read the logs.
- Running migrations by hand (for example from a laptop, against a database you can reach): `pnpm with-env production pnpm db:migrate` runs `prisma migrate deploy` using `env/.env.production`.
- Before a release with a migration: take a backup (next section) and write migrations so the **previous** release still works on the new schema (add columns before using them, remove columns in a later release). That is what makes rollback safe.
- With several API containers starting at once, Prisma serialises concurrent `migrate deploy` runs with a database lock; still, prefer one task at a time for the very first deploy.
- Never run `prisma migrate dev` or `prisma migrate reset` against staging/production.

## 9. Backups

- **Option 1 (container PostgreSQL).** Nightly dump to a file, copied off the machine:

  ```sh
  docker compose --env-file env/.env.production exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > backup-$(date +%F).dump
  ```
  Schedule with `cron`, copy to object storage or another machine, and keep several days. Restore into an empty database with `pg_restore -U ... -d ... --clean --if-exists backup.dump`.
- **Option 2 (RDS).** Enable automated backups with point-in-time recovery and take a manual snapshot before risky releases.
- **Test a restore** into a scratch database at least once before go-live. A backup that has never been restored is a hope, not a backup.
- Redis needs no backup.

## 10. Health checks, monitoring and rollback

**Health checks**

| Where | What | Meaning |
|---|---|---|
| `GET /api/health` (via the website address) | `{"status":"ok"}` | The API process is up |
| `GET /healthz` on the web container | `ok` | nginx is up |
| Docker | `docker compose ps` shows `healthy` | The images carry built-in health checks |

Point your uptime monitor (UptimeRobot, Better Stack, CloudWatch alarm, ...) at `https://workshops.example.com/api/health` and have it alert you by email or chat.

**Monitoring basics**

- Logs: `docker compose --env-file env/.env.production logs --tail 200 -f api` (Option 1) or CloudWatch Logs (Option 2).
- Watch disk space on the VM (the database volume grows) and database connections.
- A burst of HTTP 429 responses means the rate limiter is firing: legitimate (a busy office) or an attack; check the logs.
- The audit page in the app records who changed workshops, registrations and accounts.

**Rollback**

1. Put the previous known-good `sha-...` tag back in `docker-compose.images.yml` (or the previous ECS task definition revision).
2. Run `pull` and `up -d --no-build` again.
3. If the bad release included a migration, the database keeps the new schema; this is why migrations should stay backward compatible (section 8). Only if data is damaged, restore the pre-release backup (this loses changes made since the backup).

## 11. Known gaps

Things that do not exist today and that you should know about:

- **No automated deploy.** CI builds and pushes images only. No workflow connects to a server.
- **No first-admin command or sign-up flow.** Use the SQL mechanism in section 5. A small CLI script (`create-admin`) would be a good improvement.
- **No password-change screen for users themselves**; an Admin resets passwords on the Users page.
- **`docker-compose.yml` builds from source.** Pulling CI images needs the override file shown in 6.2 (not committed).
- **Extra proxy in front of the web container.** The bundled nginx limits requests per client IP using the connection's source address. Behind Caddy or a load balancer that address is the proxy's, so all users would share one limit (login: 5 per minute!). Before relying on this in production, add real-IP handling to `infra/nginx/nginx.conf` (nginx `real_ip_header X-Forwarded-For;` with `set_real_ip_from` set to your proxy's network) and set `TRUST_PROXY` to the number of proxies in front of the API. Not implemented or tested here.
- **No metrics or tracing**, only logs and the health endpoint.
- **The AWS Terraform** covers only API Gateway and has never been applied.

## 12. Go-live checklist

Configuration
- [ ] `APP_ENV=production` and the file in use is `env/.env.production` (not committed)
- [ ] `JWT_SECRET` random, 32+ characters, different from staging
- [ ] Strong database password; database and Redis not reachable from the internet
- [ ] `CORS_ORIGINS` is exactly the public `https://` address
- [ ] `SEED_ON_START=false`; no `*@workshop.local` demo accounts exist
- [ ] `THROTTLE_DISABLED` is `false`

Platform
- [ ] HTTPS works with a valid certificate; HTTP redirects to HTTPS
- [ ] Only ports 80/443 (and SSH from trusted IPs) are open
- [ ] Image tags are pinned `sha-...`, not `latest`
- [ ] `/api/health` returns ok from outside; uptime monitor alerts a real person

Data and people
- [ ] First real admin created; other users created through the app
- [ ] Backup job scheduled and a **restore tested**
- [ ] Rollback steps rehearsed on staging
- [ ] Someone owns: renewing secrets, applying server updates, watching alerts

Functional smoke test (5 minutes, as a Manager and as Staff)
- [ ] Sign in; create a workshop; register an attendee; fill a workshop and see the waitlist; cancel a registration and see the promotion
- [ ] Sign in as Admin; create a user; check the audit page
