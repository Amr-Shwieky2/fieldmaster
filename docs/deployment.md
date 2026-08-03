# Deployment

## Local development

```bash
docker compose up -d      # Postgres+PostGIS, Redis, MinIO -- no paid credentials needed
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                  # API on :3000, admin-web on :3001
```

See the root `README.md` for the full command list and seeded login
phone numbers. `apps/mobile` runs separately: `pnpm --filter @fieldmaster/mobile start` (or `web`/`ios`/`android`).

## Production Docker image

`apps/api/Dockerfile` is a genuinely working multi-stage build — see
`technical-decisions.md` for the OpenSSL/Prisma engine-target bug that was
found and fixed while getting it to boot correctly. Build and run it
locally to reproduce what ECS would run:

```bash
docker build -f apps/api/Dockerfile -t fieldmaster-api:local .
docker run --rm -p 3000:3000 --env-file apps/api/.env fieldmaster-api:local
curl http://localhost:3000/api/v1/health
# {"status":"ok","timestamp":"..."}
```

There is currently no equivalent production Dockerfile for `apps/admin-web`
or `apps/mobile` in this repository — the Terraform ECS module
(`infrastructure/terraform/modules/ecs`) expects an `admin-web` image at
`<account>.dkr.ecr.<region>.amazonaws.com/fieldmaster-admin-web:<tag>`, but
building that image (a `next start` production server, or a static export
served from S3/CloudFront) is not yet implemented — see
`IMPLEMENTATION_STATUS.md`.

## Cloud infrastructure (Terraform)

```text
infrastructure/terraform/
├── modules/
│   ├── networking/   VPC, public+private subnets, NAT, security groups
│   ├── database/     RDS PostgreSQL 17 (PostGIS via CREATE EXTENSION, no
│   │                 special parameter group needed), Secrets Manager credentials
│   ├── redis/        ElastiCache Redis (TLS + AUTH token), Secrets Manager credentials
│   ├── storage/      KMS key, S3 (private files bucket, web-assets bucket),
│   │                 CloudFront distribution (OAC-gated, no public bucket access)
│   ├── secrets/      Secrets Manager containers for JWT keys, the local
│   │                 encryption key, and third-party integration credentials
│   │                 (Twilio, Firebase, Sentry) -- values set out-of-band, never
│   │                 as Terraform variables
│   └── ecs/          ECS Fargate cluster, ALB (path-routed: /api/* -> API
│                     service, everything else -> admin-web service),
│                     IAM execution/task roles, CloudWatch log groups,
│                     autoscaling for the API service
└── environments/
    ├── dev/          Smallest sizing, single NAT gateway, no deletion protection
    ├── staging/      Medium sizing
    └── production/   Multi-AZ RDS, one NAT gateway per AZ, Redis with a
                       replica, deletion protection enabled
```

**Honest status**: every module and environment `terraform validate`s
cleanly and is `terraform fmt`-clean (verified this session by installing
Terraform 1.15 via Homebrew and running `init -backend=false` +
`validate` against all three environments — no AWS credentials were used
or required for that). **None of this has ever been applied against a
real AWS account.** There is no live infrastructure, no verified `terraform
plan` output against real AWS APIs, and several details that only surface
under a real `plan`/`apply` (IAM policy edge cases, exact ECS deployment
behavior, CloudFront propagation) are unverified. Treat this as a
solid, syntactically-correct starting point for a real deployment, not a
proven one.

### First apply (not done in this repository — for whoever does this next)

1. Bootstrap remote state: create an S3 bucket + DynamoDB lock table by
   hand (or a tiny separate Terraform config, since the environments here
   assume the backend already exists), then uncomment the `backend "s3"`
   block in each environment's `versions.tf`.
2. Build and push `apps/api`'s Docker image to ECR; set
   `api_image_tag`/`admin_web_image_tag` accordingly (`admin_web` image
   doesn't exist yet — see above).
3. `terraform init && terraform plan` in `environments/dev` first, review
   the plan carefully, then `terraform apply`.
4. Set the actual values for the `secrets` module's containers
   (`aws secretsmanager put-secret-value ...`) — Terraform only creates
   the containers, never the values.
5. Run `prisma migrate deploy` against the new RDS instance (from a bastion,
   an ECS one-off task, or a CI job — there is no automated migration-runner
   task defined in the ECS module yet).

## GitHub Actions CI

`.github/workflows/ci.yml` runs on every push/PR: dependency install, lint,
typecheck, unit tests, migration + integration tests (against real
Postgres+Redis service containers), Docker image build, and a best-effort
dependency security scan (`continue-on-error: true`). YAML-validated; not
yet run against a live GitHub Actions runner in this environment (no CI
credentials/remote configured here).

## Required production credentials (not needed for local dev)

| Purpose | Provider | Where used |
|---|---|---|
| SMS OTP delivery | Twilio Verify | `TwilioVerifyProvider` — set `TWILIO_*` env vars |
| Push notifications | Firebase Cloud Messaging | Currently only a documented stub — see `IMPLEMENTATION_STATUS.md` |
| Object storage | AWS S3 | Falls back to MinIO locally; set `AWS_*`/`S3_*` env vars in production |
| Envelope encryption | AWS KMS | Falls back to a local base64 key locally (`LOCAL_ENCRYPTION_KEY_BASE64`) |
| Error tracking | Sentry | Optional; unset = no-op |
| Maps | Google Maps JS SDK | Not used in this build — admin-web uses Leaflet/OpenStreetMap instead (no key needed); see `technical-decisions.md` |

None of these are required to run `docker compose up -d && pnpm dev` — every
one has a working local/dev adapter. See `.env.example` in `apps/api` and
`apps/admin-web` for the complete variable list.
