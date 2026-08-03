# System Architecture

## Monorepo layout

```text
fieldmaster/
├── apps/
│   ├── api/            NestJS REST API (Node 22, TypeScript strict)
│   ├── admin-web/       Next.js 15 App Router admin dashboard
│   └── mobile/          Expo (React Native SDK 57) worker app
├── packages/
│   ├── api-client/      Hand-written typed fetch client shared by admin-web + mobile
│   ├── shared-types/    Enums + cross-cutting constants, mirrored 1:1 with Prisma's own enums
│   ├── shared-validation/  Pure business-logic functions: payroll math, geo distance,
│   │                       emergency compensation, forgotten-stamp sequencing, offline-event
│   │                       canonicalization/signing -- unit-tested independently of the DB
│   ├── eslint-config/, typescript-config/  Shared tooling config
├── infrastructure/
│   ├── docker/          Production Dockerfile support files
│   └── terraform/       AWS ECS/RDS/ElastiCache/S3 IaC (written, not applied -- see deployment.md)
├── docker-compose.yml    Postgres+PostGIS, Redis, MinIO for local dev
└── docs/
```

`pnpm` workspaces + Turborepo run `lint`/`typecheck`/`test`/`build` across
every package with dependency-aware caching. `packages/shared-types` and
`packages/shared-validation` are consumed as TypeScript source directly by
`apps/api` (Node/Jest) and `apps/mobile` (Hermes/Metro) alike — both
environments compile the same source, which is what makes an Ed25519
signature computed on a phone verifiable by the API without a parallel
reimplementation (see `offline-sync.md`).

## Backend (`apps/api`)

- **Framework**: NestJS, modules under `src/modules/*` (auth, organizations,
  memberships, workers, sites, shifts, attendance, turan, payroll,
  notifications, audit-logs, reports, devices, offline-sync).
- **Data layer**: Prisma ORM against Postgres 17 + PostGIS 3.5. Geofence
  distance checks bypass Prisma's query builder (no first-class PostGIS
  type) and run a raw parameterized `$queryRaw` using `ST_DWithin`/
  `ST_Distance` — see `geofencing.md`.
- **Cross-cutting request pipeline**: `JwtAuthGuard` re-resolves the caller's
  membership and status on every request (never trusts a stale token
  claim) → `PermissionsGuard` checks the route's declared `Permission`
  against the role's permission set → a global `ValidationPipe`
  (`whitelist: true, forbidNonWhitelisted: true`) rejects unexpected
  fields → `AllExceptionsFilter` normalizes every error to
  `{statusCode, code, message, details, correlationId}`.
- **Cross-organization isolation**: every service query is scoped by the
  *authenticated* user's `organizationId`, taken from the guard-resolved
  membership, never from a client-supplied value — structurally, not just
  by convention, since no service method accepts an organization ID as a
  raw request parameter.
- **Background work**: BullMQ (`@nestjs/bullmq`) against the Redis
  container runs two repeatable jobs today (expiring temporary check-in
  points, expiring unused onboarding invitations); there is no
  transactional outbox yet (notifications/audit writes are synchronous —
  see `technical-decisions.md`).
- **Real-time**: a Socket.io gateway (`/notifications` namespace, JWT-
  authenticated, per-user rooms) and an SSE endpoint
  (`GET /notifications/stream`) both subscribe to the same in-process
  `@nestjs/event-emitter` event `NotificationsService.notify()` fires —
  correct for the single-instance topology this slice runs, documented as
  a scaling limit in `technical-decisions.md`.
- **PDF generation**: Playwright's bundled Chromium renders an HTML
  template server-side (`page.setContent()` → `page.pdf()`), uploaded to
  S3/MinIO with a signed download URL.

## Admin web (`apps/admin-web`)

Next.js 15 App Router, React 19, TanStack Query for server state, React
Hook Form + Zod for forms, Tailwind (hand-rolled component primitives —
see `technical-decisions.md` for why not the shadcn/ui CLI), Leaflet +
OpenStreetMap for the geofence map editor (a substitute for the spec-named
Google Maps JS SDK — no billing account available in this environment).
Role-aware navigation and an `OwnerOnly` wrapper component gate financial
surfaces client-side as a UX layer; the real security boundary is the API
rejecting the same requests with `403` regardless of what the browser
renders (verified by both the API's own financial-isolation tests and
`apps/admin-web/src/components/__tests__/owner-only.test.tsx`).

## Mobile (`apps/mobile`)

Expo managed workflow (SDK 57) rather than the spec-named bare React Native
workflow — see `technical-decisions.md` for why. Session tokens live in
Keychain/Keystore via `expo-secure-store` (AsyncStorage fallback on the web
target only, used here as a stand-in for iOS Simulator verification). The
offline-sync engine (`src/lib/offline-sync-context.tsx`) watches
connectivity via `@react-native-community/netinfo` and flushes the local
event queue (`src/lib/offline-queue.ts`, AsyncStorage-backed) whenever
connectivity returns, on an interval, and on app foreground.

## Request flow: a geofenced clock-in, end to end

```text
Mobile app
  → GPS fix (expo-location)
  → POST /api/v1/clock-events/clock-in  (Idempotency-Key header)
API (JwtAuthGuard → PermissionsGuard → ValidationPipe)
  → ClockEventsService.clockInCore()
      - confirms shift assignment, no conflicting ACTIVE entry
      - LocationValidationService: device/server time deviation, mock-location flag
      - GeofenceValidationService: raw ST_DWithin query against the shift's geofence
      - creates TimeEntry (ACTIVE) + ClockEvent inside one transaction
  → AuditService.record() (SHA-256 hash-chained)
  → NotificationsService.notifyMany() → owners + manager, role-filtered content
  → response: { timeEntry, clockEvent }
```

The same `clockInCore`/`clockOutCore` methods are reused verbatim by the
offline-sync path (`OfflineSyncService`), with `origin: OFFLINE` changing
only how the authoritative timestamp and time-deviation tolerance are
computed — not the geofence/assignment/conflict rules themselves. See
`offline-sync.md`.

## Multi-organization model

Every business table carries `organizationId`. A user's *effective*
organization for a request comes from their JWT's `membershipId`, re-checked
against a live, `ACTIVE` `OrganizationMembership` row on every request — a
revoked or cross-org membership is rejected immediately, not just at login.
