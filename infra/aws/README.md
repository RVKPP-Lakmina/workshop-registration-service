# AWS API Gateway (HTTP API) edge

Terraform for an alternative cloud edge in front of the Workshop Registration API
(intended origin: ECS service behind an ALB, set via `backend_url`).

**Status: never applied.** `terraform fmt -check` and `terraform validate` pass (hashicorp/terraform:1.9 via Docker). Re-run with:

```sh
terraform init -backend=false && terraform fmt && terraform validate
```

## What it defines
- HTTP API with a CORS allowlist (`cors_allowed_origins`, `Authorization` / `Content-Type`).
- `$default` stage throttling (100 rps / burst 200) plus a tighter route-level
  throttle on `POST /api/auth/login` (2 rps / burst 5).
- `HTTP_PROXY` integration to `var.backend_url` for `ANY /api/{proxy+}`.
- JSON access logs to CloudWatch.

## Rate-limit reasoning
Staff share one office IP, so global limits are generous; API Gateway throttles
are per stage/route (not per client) and act as a coarse flood guard. Per-user
limits live in the app (Redis-backed throttler); the strict login throttle
protects against credential stuffing.

The SPA is served separately (S3/CloudFront or nginx); this stack only fronts `/api`.

## Environments
`environment` (development | staging | production, same values as `APP_ENV`) is required and is
used in resource names (`<name>-<environment>`) and default tags. Start from
`environments/<env>.tfvars.example` (copy to `environments/<env>.tfvars`, which is gitignored):

```sh
terraform init -backend=false            # or configure a per-environment remote backend
terraform plan -var-file=environments/staging.tfvars
```

No remote backend is configured on purpose; use a separate state per environment (see the
note in `main.tf`).
