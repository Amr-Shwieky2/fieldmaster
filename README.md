# FieldMaster

A workforce management platform for field construction, traffic-control,
traffic-sign, and traffic-light crews ("Ramzanim" crews) — attendance,
geofenced clock-in/out, Turan on-call scheduling, emergency call-outs, and
payroll, built around real field conditions (dead phones, poor coverage,
forgotten stamps, weather-shortened shifts).

**This repository ships the backend API, a full-featured Next.js admin web
app, and an Expo (React Native) mobile worker app**: authentication, RBAC,
geofenced attendance, **signed offline attendance sync** (real Ed25519
device-key signing, verified server-side, tested end-to-end), the
Turan/emergency-callout engine, the forgotten-stamp two-strike rule, the
payroll engine, PDF report generation, real-time (WebSocket/SSE)
notifications, BullMQ background jobs, and a `/health` endpoint, running
against a real Postgres/PostGIS database with a passing integration test
suite — plus a working admin dashboard (login, dashboard, workers,
sites/projects with a map-based geofence editor, scheduling,
Turan/emergency, attendance approval, payroll, reports, notifications,
audit log) with a real Vitest + React Testing Library test suite of its
own, verified live in a browser against the running API, and a mobile app
(login, home, GPS clock-in/out with a mandatory daily summary, history,
and an offline sync queue) verified via typecheck/lint, a real Metro
bundle build, and a live interactive pass through Expo's web target —
financial isolation between Owner and Field Manager roles is enforced at
both the UI and API layers throughout, with automated tests on both sides.
A production Docker image, GitHub Actions CI, and validated (never
applied) Terraform for an AWS ECS/RDS/ElastiCache/S3 deployment all exist
too, alongside a complete 14-file `docs/` set. Not built: a live AWS
deployment, an admin-web production Docker image, Playwright/Detox test
suites, device attestation, and on-device/simulator verification of the
mobile app (this environment has no full Xcode install and no
browser-automation tool) — see
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) for the exact
done/partial/not-started breakdown per feature, and
[`docs/technical-decisions.md`](docs/technical-decisions.md) for why, and
for every implementation-detail decision made along the way. The full
`docs/` set (`docs/system-architecture.md`, `docs/api.md`,
`docs/offline-sync.md`, `docs/deployment.md`, etc.) goes deeper on each
area than this README.

## Architecture

```text
fieldmaster/
├── apps/
│   ├── api/                  NestJS REST API
│   │   ├── prisma/           Schema + hand-reviewed SQL migrations + seed script
│   │   ├── src/common/       Prisma client, auth/RBAC guards, audit hash-chain,
│   │   │                     encryption, idempotency, error format
│   │   ├── src/modules/      auth, organizations, memberships, workers,
│   │   │                     sites (projects/geofences), shifts, attendance
│   │   │                     (clock-events/approvals/corrections/forgotten-stamp),
│   │   │                     turan (assignments/emergency-callouts), payroll,
│   │   │                     notifications, audit-logs, devices (offline-sync
│   │   │                     device-key registration), offline-sync, health
│   │   ├── src/modules/      ...notifications (WebSocket gateway + SSE), reports
│   │   │                     (Playwright PDF generation), audit-logs
│   │   ├── src/common/queue/ BullMQ queues + processors (check-in-point and
│   │   │                     onboarding-invitation expiry)
│   │   ├── Dockerfile         Multi-stage production image
│   │   └── test/             Supertest integration/e2e tests against real Postgres
│   │                         (including offline-sync.e2e-spec.ts)
│   ├── admin-web/            Next.js 15 (App Router) + React 19 admin dashboard
│   │   ├── src/app/(app)/    dashboard, workers, sites/projects (+ map geofence
│   │   │                     editor), shifts, attendance, payroll, reports,
│   │   │                     notifications, audit-log pages
│   │   └── src/**/__tests__/ Vitest + React Testing Library (format functions,
│   │                         the OwnerOnly financial-isolation guard)
│   └── mobile/                Expo (React Native) worker app
│       └── src/               screens (login/home/clock-in/clock-out/history/
│                               offline-queue), navigation, lib (auth, session
│                               storage via expo-secure-store, offline-queue,
│                               offline-sync-context, device-key signing)
├── packages/
│   ├── shared-types/         Enums + domain constants, shared by API, admin-web, mobile
│   ├── shared-validation/    Pure, unit-tested business math: payroll, geofence
│   │                         distance, emergency-callout timing, forgotten-stamp
│   │                         sequencing, Asia/Jerusalem business-date grouping,
│   │                         offline-event canonicalization + Ed25519 signing
│   ├── api-client/            Thin typed fetch wrapper over the API, shared by admin-web and mobile
│   ├── eslint-config/         Shared flat ESLint config
│   └── typescript-config/     Shared tsconfig bases
├── infrastructure/terraform/  AWS ECS/RDS/ElastiCache/S3 IaC -- validated, never applied (see docs/deployment.md)
├── docker-compose.yml         Postgres 17 + PostGIS 3.5, Redis, MinIO (S3-compatible)
├── .github/workflows/ci.yml   Lint/typecheck/build, unit + integration tests, Docker build
├── IMPLEMENTATION_STATUS.md   Section-by-section status against the full spec
└── docs/                      product-requirements, system-architecture, database-design,
                                api, security, authorization-matrix, payroll-calculations,
                                offline-sync, geofencing, deployment, testing,
                                technical-decisions, troubleshooting
```

Money is always integer **agorot** (1 ILS = 100 agorot); business-day/month
grouping always happens in `Asia/Jerusalem`, computed from UTC timestamps via
`Intl.DateTimeFormat` (no date-tz dependency). See
`packages/shared-validation/src/business-date.ts` and `payroll.ts`.

## Prerequisites

- Node.js 22+
- pnpm (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker Desktop (or compatible) for Postgres/Redis/MinIO

## Installation

```bash
git clone <this repo>
cd fieldmaster
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/admin-web/.env.example apps/admin-web/.env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` starts the API and admin-web in parallel (via Turborepo). The
API listens on `http://localhost:3000`, prefixed at `/api/v1` (Swagger docs
live at `http://localhost:3000/api/v1/docs`); the admin web app listens on
`http://localhost:3001`.

The mobile app is not part of `pnpm dev` (it has its own Metro bundler and
targets a simulator/device rather than a browser tab). Run it separately:

```bash
pnpm --filter @fieldmaster/mobile ios      # requires Xcode + iOS Simulator
pnpm --filter @fieldmaster/mobile android   # requires Android Studio + emulator
pnpm --filter @fieldmaster/mobile web       # runs in a browser, useful for quick UI iteration
```

By default the mobile app points at `http://localhost:3000/api/v1`
(override with `EXPO_PUBLIC_API_URL`). If you run the `web` target, add
its origin (`http://localhost:8081` by default) to `CORS_ORIGINS` in
`apps/api/.env` — already included in `.env.example`.

> **Port note:** if you already have a native (non-Docker) Postgres running
> on 5432, this repo's Compose file maps the container to **5433** instead,
> to avoid silently talking to the wrong database. See
> `docs/technical-decisions.md` if you need to change this back.

## Environment variables

See [`apps/api/.env.example`](apps/api/.env.example) for the complete,
commented list. Every variable has a working local default —
**no paid external accounts are required for local development.** Dev
adapters are used automatically unless the corresponding production
credential is set:

| Feature | Dev adapter | Production adapter (needs credentials) |
|---|---|---|
| OTP delivery | Prints code to API log | Twilio Verify REST API |
| Push notifications | Logs the payload | Firebase Cloud Messaging (adapter selection wired; not exercised live) |
| Bank/ID encryption | Local AES-256-GCM key | AWS KMS envelope encryption (client code present; not exercised live) |
| Object storage | MinIO (started by Compose) | AWS S3 (same client, different endpoint/creds) |

## Local execution

```bash
pnpm dev            # start the API (:3000) and admin-web (:3001) in watch mode
pnpm lint            # ESLint across all workspaces
pnpm typecheck       # tsc --noEmit across all workspaces
pnpm test            # unit tests (shared-validation pure functions + a few API-side unit tests)
pnpm test:e2e        # integration tests against a real Postgres (see below)
pnpm build           # production build of every workspace
pnpm db:migrate      # apply Prisma migrations
pnpm db:seed         # wipe + repopulate with realistic fictional demo data
```

`apps/api` also exposes `pnpm --filter @fieldmaster/api verify-audit`, a
standalone command that walks every organization's audit-log SHA-256 hash
chain and reports the first broken link, if any (spec section 31.4).

### Running the integration test suite

`apps/api/test/*.e2e-spec.ts` runs against a **separate** database
(`fieldmaster_test`) on the same Postgres container, so it never touches
your seeded dev data. One-time setup:

```bash
docker exec fieldmaster-postgres psql -U fieldmaster -d fieldmaster -c "CREATE DATABASE fieldmaster_test;"
DATABASE_URL="postgresql://fieldmaster:fieldmaster_dev_password@localhost:5433/fieldmaster_test?schema=public" \
  pnpm --filter @fieldmaster/api exec prisma migrate deploy
pnpm test:e2e
```

## Seed / development accounts

After `pnpm db:seed`, sign in with any of these phone numbers — either
through the admin web app at `http://localhost:3001/login`, or directly via
`POST /api/v1/auth/otp/request` then `POST /api/v1/auth/otp/verify`. Either
way, the OTP code is printed to the **API's** console log (dev adapter),
not shown in the browser:

| Role | Phone | Name |
|---|---|---|
| Owner | `+972500000001` | Dana Owner-Levi |
| Owner | `+972500000002` | Amit Owner-Katz |
| Field Manager | `+972500000011` | Yossi Manager-Ben David |
| Field Manager | `+972500000012` | Noa Manager-Peretz |
| Worker | `+972500010002` | Moshe Traffic |
| Worker (has a forgotten-stamp deduction) | `+972500010010` | Nir Barrier |

> If accounts end up in an unexpected state from manual testing/exploring
> the API directly, re-run `pnpm db:seed` — it wipes and repopulates
> everything from scratch every time.

## Testing summary

- 35 pure-function unit tests (`packages/shared-validation`): 9-hour rule,
  proration, full-day credit, hourly overtime split, emergency ±60/+15
  timing, forgotten-stamp two-strike sequencing, geofence distance,
  Asia/Jerusalem month/day boundaries across DST transitions, and
  offline-event canonicalization + genuine Ed25519 sign/verify round-trips
- 10 unit tests inside the API (RBAC permission matrix, mock-location/
  device-time validation)
- 21 integration/e2e tests against a live Postgres+PostGIS database:
  OTP login, refresh-token rotation and theft detection, 2-owner-limit
  enforcement, suspended-account lockout, financial isolation (Field
  Manager 403s and DTO stripping), geofence rejection with distance
  detail, full clock-in→summary→approve→minute-split flow, full-day
  credit, the forgotten-stamp two-strike sequence end-to-end, non-counting
  of `DEVICE_FAILURE` corrections, Flexi-Check, payroll
  calculate→finalize→block-edit→reopen, and 5 offline-sync tests (signed
  round trip, invalid-signature rejection, unregistered-device rejection,
  duplicate detection, revoked-key rejection)
- 9 admin-web tests (Vitest + React Testing Library): format-function unit
  tests plus 3 tests proving the `OwnerOnly` financial-isolation wrapper
  never renders its children for a Field Manager/Worker session

Run `pnpm test && pnpm test:e2e` to reproduce all of the above (75 tests total: 35 + 10 + 21 + 9).

## Deployment

- ✅ `apps/api/Dockerfile` — a multi-stage production image that genuinely
  builds and boots (verified against a real Docker network in this
  session), including Playwright's Chromium for PDF generation, serving a
  real `/api/v1/health` endpoint.
- ✅ `.github/workflows/ci.yml` — lint/typecheck/build, unit tests,
  migration + integration tests against real Postgres+Redis service
  containers, a Docker build, and a best-effort security scan. YAML-valid;
  not yet exercised against a live GitHub Actions runner in this
  environment.
- ✅ `infrastructure/terraform/` — networking, database (RDS Postgres 17),
  redis (ElastiCache), storage (S3 + KMS + CloudFront), secrets (Secrets
  Manager), and ecs (Fargate + ALB + IAM) modules, with dev/staging/
  production environment root modules. `terraform validate`/`fmt -check`
  pass cleanly across all three (verified this session). **Never applied
  against a real AWS account** — see `docs/deployment.md`.

## Known external-service requirements for a real deployment

None are required to run this locally, including the mobile app in its web
target. For a production deployment you would eventually need: a Twilio
account (Verify service) for real SMS OTP, a Firebase project for real push
notifications, an AWS account (KMS + S3 + RDS Postgres with PostGIS +
ElastiCache Redis) if following the intended cloud architecture, and a
Google Maps Platform API key if you want to swap admin-web's Leaflet/
OpenStreetMap map for the spec-named Google Maps JS SDK. Native mobile
builds (as opposed to the Expo web target) additionally need an Apple
Developer account and/or Google Play Console access to actually distribute
the app, plus a machine with full Xcode installed to run the iOS Simulator
or build for a physical device — this repository's own dev environment
lacked that (Xcode Command Line Tools only), which is why mobile
verification this session was done via typecheck/lint and the Expo web
target rather than the Simulator; see `IMPLEMENTATION_STATUS.md` section 27.
