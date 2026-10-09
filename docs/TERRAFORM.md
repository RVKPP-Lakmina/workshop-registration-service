# Terraform guide (`infra/aws`)

Terraform lets you describe cloud resources in text files and have a tool create them for you. This guide explains what the Terraform in this repository does, how to run it safely, and what it does **not** do.

> **Status: this Terraform has never been applied.** It was checked with `terraform fmt` and `terraform validate` only (see `infra/aws/README.md`). No AWS resources have ever been created from it, so its behaviour in a real account is **not verified**. Read "Known issues" before your first `apply`.

Contents

1. [What it creates, and what it does not](#1-what-it-creates-and-what-it-does-not)
2. [Install Terraform](#2-install-terraform)
3. [AWS account and credentials](#3-aws-account-and-credentials)
4. [Configuration: variables and tfvars files](#4-configuration-variables-and-tfvars-files)
5. [Commands, step by step](#5-commands-step-by-step)
6. [Remote state (recommended before real use)](#6-remote-state-recommended-before-real-use)
7. [How API Gateway sits in front of the backend](#7-how-api-gateway-sits-in-front-of-the-backend)
8. [Cost and safety notes](#8-cost-and-safety-notes)
9. [Known issues found by reading the code](#9-known-issues-found-by-reading-the-code)

---

## 1. What it creates, and what it does not

Files: `infra/aws/main.tf` (resources), `variables.tf` (inputs), `outputs.tf` (results). Requires Terraform 1.5 or newer and the `hashicorp/aws` provider version 5.x.

**Creates (in one AWS region):**

| Resource | Purpose |
|---|---|
| `aws_apigatewayv2_api` (HTTP API) | The public entry point. Has a CORS allowlist (`cors_allowed_origins`; headers `Authorization` and `Content-Type`; methods GET, POST, PATCH, DELETE, OPTIONS). |
| `aws_apigatewayv2_integration` (`HTTP_PROXY`) | Forwards requests to `backend_url`. |
| Routes `ANY /api/{proxy+}` and `POST /api/auth/login` | Everything under `/api` goes to the backend; login is a separate route so it can have its own, stricter throttle. |
| `aws_apigatewayv2_stage` `$default` (auto-deploy) | Throttling: all routes `default_rate_limit` / `default_burst_limit` (100 / 200 per second by default); login `login_rate_limit` / `login_burst_limit` (2 / 5). Writes JSON access logs. |
| `aws_cloudwatch_log_group` | Access logs, kept `log_retention_days` (30 by default). |

**Outputs:** `api_endpoint` (the public URL, like `https://abc123.execute-api.us-east-1.amazonaws.com`), `api_id`, `access_log_group`.

**Does NOT create** (you must provide or build these yourself; see [DEPLOYMENT.md](DEPLOYMENT.md)):

- The backend itself: no ECS, EC2, load balancer, containers or images.
- Databases: no RDS PostgreSQL, no ElastiCache Redis.
- The website hosting: no S3 bucket, CloudFront or nginx.
- DNS records, TLS certificates, a custom domain for the API.
- A VPC, subnets, security groups, IAM roles for your application.
- Secrets (Secrets Manager / SSM), backups, alarms, WAF.
- Remote state storage (see section 6).

You do not need this Terraform to run the application. It is an optional edge layer.

## 2. Install Terraform

Pick one.

**Native install (recommended)**

- Windows (PowerShell): `winget install Hashicorp.Terraform` or `choco install terraform`
- macOS: `brew tap hashicorp/tap && brew install hashicorp/tap/terraform`
- Linux: follow <https://developer.hashicorp.com/terraform/install>

Check it:

```sh
terraform version
```
You should see `Terraform v1.5` or newer (the repository was validated with 1.9).

**No install: use Docker** (Docker must be running). Run these from the repository root. The folder `infra/aws` is mounted into the container.

macOS / Linux:
```sh
docker run --rm -it -v "$PWD/infra/aws:/work" -w /work hashicorp/terraform:1.9 version
```
PowerShell:
```powershell
docker run --rm -it -v "${PWD}/infra/aws:/work" -w /work hashicorp/terraform:1.9 version
```

Everywhere below, `terraform <args>` can be replaced with the same `docker run ... hashicorp/terraform:1.9 <args>`. To use real AWS from the container you must also pass credentials, for example `-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_REGION`. For offline checks (`init -backend=false`, `fmt`, `validate`) no credentials are needed.

## 3. AWS account and credentials

You only need this for `plan` against a real account and for `apply`/`destroy`. Formatting and validating need nothing.

1. Get an AWS account: <https://aws.amazon.com/free>. Turn on MFA for the root user and **do not use the root user** for day-to-day work.
2. Create credentials. Either:
   - **IAM Identity Center (SSO)**, best for teams: <https://docs.aws.amazon.com/singlesignon/latest/userguide/>. Then `aws configure sso` and `aws sso login --profile <name>`.
   - **An IAM user** for yourself: IAM > Users > Create user, attach a policy that allows API Gateway, CloudWatch Logs (and S3/DynamoDB if you use remote state), then create an access key. Start with a narrow custom policy, not `AdministratorAccess`, if you can.
3. Install the AWS CLI (<https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>) and run:
   ```sh
   aws configure
   ```
   It asks for the access key id, secret, default region (for example `us-east-1`) and output format (`json`).
4. Check who you are:
   ```sh
   aws sts get-caller-identity
   ```
   You should see your account id and the user/role. **Make sure it is the account you intend to change.**
5. Never put access keys in files in this repository. If you use a named profile, select it with `AWS_PROFILE=<name>` (PowerShell: `$env:AWS_PROFILE = "<name>"`).

## 4. Configuration: variables and tfvars files

| Variable | Default | Meaning |
|---|---|---|
| `environment` | *(required)* | `development`, `staging` or `production` (same values as `APP_ENV`). Used in resource names (`<name>-<environment>`) and tags. |
| `aws_region` | `us-east-1` | Where to create things |
| `name` | `workshop-registration` | Name prefix of the API and log group. |
| `backend_url` | *(required)* | Public base URL of the backend, e.g. `https://api-origin.example.com` (see section 7) |
| `cors_allowed_origins` | `["https://workshops.example.com"]` | Website addresses allowed to call the API from a browser |
| `default_rate_limit`, `default_burst_limit` | 100, 200 | Requests per second / burst for all routes |
| `login_rate_limit`, `login_burst_limit` | 2, 5 | Same for `POST /api/auth/login` |
| `log_retention_days` | 30 | CloudWatch log retention |

Per-environment values live in `infra/aws/environments/`:

```
infra/aws/environments/development.tfvars.example
infra/aws/environments/staging.tfvars.example
infra/aws/environments/production.tfvars.example
```

Copy the one you need to a real file without `.example` and edit it (replace the placeholder URL and origins):

```sh
cp infra/aws/environments/staging.tfvars.example infra/aws/environments/staging.tfvars
```
(PowerShell: `Copy-Item infra/aws/environments/staging.tfvars.example infra/aws/environments/staging.tfvars`)

Real `infra/aws/environments/*.tfvars` files are git-ignored. Keep each environment's state separate (section 6), otherwise applying staging values could overwrite production. Note that `development.tfvars.example` points `backend_url` at `http://localhost:3000`: that is only a placeholder, because API Gateway in AWS cannot reach your laptop. Use the development file only for `validate`/`plan` experiments.

## 5. Commands, step by step

Run all of these from `infra/aws` (`cd infra/aws`).

1. **Initialise** (downloads the AWS provider; creates `.terraform/` and a lock file):
   ```sh
   terraform init
   ```
   For a purely offline check without any remote state: `terraform init -backend=false`.
   You should see `Terraform has been successfully initialized!`.
2. **Format** (fixes indentation; safe):
   ```sh
   terraform fmt
   ```
   Use `terraform fmt -check` in CI to only report.
3. **Validate** (checks syntax and references; makes no network calls to AWS):
   ```sh
   terraform validate
   ```
   You should see `Success! The configuration is valid.`
4. **Plan** (shows what *would* change; changes nothing):
   ```sh
   terraform plan -var-file=environments/staging.tfvars -out=staging.plan
   ```
   You should see a list of resources marked `+` (to be created) and a summary such as `Plan: 7 to add, 0 to change, 0 to destroy.` **Read it.** Check the region and that nothing says `destroy` that you did not expect.
5. **Apply** (creates the resources; this is the step that can cost money and affect real systems):
   ```sh
   terraform apply staging.plan
   ```
   Applying the saved plan file guarantees you get exactly what you reviewed. Without a plan file Terraform asks you to type `yes`.
6. **Outputs** (the public URL):
   ```sh
   terraform output
   terraform output -raw api_endpoint
   ```
7. **Destroy** (deletes everything this configuration created; asks for `yes`):
   ```sh
   terraform plan -destroy -var-file=environments/staging.tfvars   # preview
   terraform destroy -var-file=environments/staging.tfvars
   ```

**Never apply without reviewing a plan, and never apply to production before it has worked in staging.** Because this configuration has not yet been applied anywhere, the first apply is an experiment: use a throwaway AWS account or a test region.

## 6. Remote state (recommended before real use)

Terraform remembers what it created in a **state file**. By default that is a local file `terraform.tfstate` inside `infra/aws`, which is easy to lose, must never be committed (it can contain sensitive data) and cannot be shared with teammates. For anything real, store it in S3 with a DynamoDB table for locking, so two people cannot apply at once.

**This is documented advice only; it is not configured or applied in the repository.**

Create once (by hand or a separate small Terraform project), in your AWS account:

- an S3 bucket, e.g. `workshop-registration-terraform-state-<account-id>`, with versioning and encryption enabled and public access blocked;
- a DynamoDB table, e.g. `workshop-registration-terraform-locks`, with partition key `LockID` (type String).

Then add a backend block (for example in a new file `infra/aws/backend.tf`):

```hcl
terraform {
  backend "s3" {
    bucket         = "workshop-registration-terraform-state-123456789012"
    key            = "workshop-registration/api-gateway/staging.tfstate"   # one key per environment
    region         = "us-east-1"
    dynamodb_table = "workshop-registration-terraform-locks"
    encrypt        = true
  }
}
```

and run `terraform init` again (answer `yes` to migrate existing local state). Use a different `key` (or `terraform workspace`) per environment. Newer Terraform versions can also lock in S3 without DynamoDB (`use_lockfile = true`); check the docs for the version you use.

## 7. How API Gateway sits in front of the backend

```
Browser  ->  https://<id>.execute-api.<region>.amazonaws.com/api/...   (API Gateway: CORS, throttling, logs)
                         |   HTTP_PROXY integration
                         v
              backend_url  (a PUBLIC HTTPS address: ALB, or the server running the web/API containers)
```

- `backend_url` must be **reachable from the internet** by API Gateway. API Gateway's `HTTP_PROXY` integration to a private address needs a VPC link, which this configuration does not define. A load balancer's public DNS name or your server's HTTPS domain works. Include the scheme, e.g. `https://origin.example.com`, with no trailing slash needed.
- API Gateway applies the CORS rules from `cors_allowed_origins`. These should list the same origins as the application's `CORS_ORIGINS`.
- Throttles are per stage/route, **not per client**: a coarse flood guard. Fine-grained limits (per user, per login attempt) are enforced by the app with Redis (see [DESIGN.md](DESIGN.md)).
- If you serve the API through the gateway URL, set the web app's API base (`VITE_API_BASE_URL`) to that URL, and make sure the application's `TRUST_PROXY` reflects the extra hop.
- The gateway only fronts `/api`. The website is served separately (the nginx `web` image, or S3 + CloudFront).

## 8. Cost and safety notes

- API Gateway HTTP APIs are billed per request (about one US dollar per million requests, plus data transfer) and CloudWatch Logs per GB ingested/stored. For this app's traffic expect cents per month, but check <https://aws.amazon.com/api-gateway/pricing/> and your region.
- The remote-state bucket and lock table cost almost nothing.
- Everything else in [DEPLOYMENT.md](DEPLOYMENT.md) Option 2 (Fargate, RDS, ElastiCache, load balancer) costs far more than this Terraform does. Set an AWS Budget alert (Billing > Budgets) before experimenting.
- `terraform destroy` removes only what Terraform created. It will delete the access log group and its logs.
- Safety habits: review every plan; one state per environment; do not share `.tfstate` files; use least-privilege credentials; do not run `apply` from a shell where `AWS_PROFILE` points at production unless you mean to.

## 9. Known issues found by reading the code

These were noticed while writing this guide. They have **not** been confirmed in a real AWS account because the configuration has never been applied. Test them in staging before relying on the gateway.

1. **The `/api` prefix may be dropped.** The route is `ANY /api/{proxy+}` and the integration URI is `<backend_url>/{proxy}`. API Gateway fills `{proxy}` with the part *after* `/api/`, so a request to `/api/workshops` would reach the backend as `/workshops`. The NestJS API serves everything under the global prefix `/api`, so that request would probably return 404. A likely fix in `main.tf` is `integration_uri = "${trimsuffix(var.backend_url, "/")}/api/{proxy}"`.
2. **The login route shares the integration but has no `{proxy}` parameter.** Route `POST /api/auth/login` uses the same integration URI, which contains `{proxy}`; a route without that path parameter cannot fill it in. The login route probably needs its own integration with a fixed `integration_uri` ending in `/api/auth/login`.
3. **CORS is configured twice** (API Gateway and the NestJS app). Keep the lists identical, and test a browser preflight request in staging.

Fixing these is outside the scope of this documentation change; they are recorded here so the first person to apply the configuration is not surprised.
