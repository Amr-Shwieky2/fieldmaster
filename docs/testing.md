# Testing

## Running the suites

```bash
docker compose up -d                  # tests need a real Postgres+PostGIS+Redis
pnpm db:migrate                       # applies migrations to both fieldmaster and fieldmaster_test
pnpm test                             # unit + component tests across every package
pnpm --filter @fieldmaster/api test:e2e   # integration tests against a real database
```

`pnpm test` (root) runs, in parallel via Turborepo:

- `packages/shared-validation` — 35 pure-function unit tests (Jest)
- `apps/api` — 25 unit tests (Jest: RBAC, location validation, app
  environment, notification money stripping)
- `packages/i18n` — 69 tests (Vitest): the shared Arabic formatter (including a
  check that its built-in Israel time-zone rules match Intl for every hour of
  2024-2030), error-code mapping, enum labels, ICU validity of the shared
  messages and the translation-check library
- `apps/admin-web` — 172 tests (Vitest + React Testing Library), all in
  Arabic: every page, notification text, the admin messages and the
  financial-isolation guards
- `apps/mobile` — 131 tests (Jest + jest-expo + React Native Testing Library),
  all in Arabic: every screen and state (login with test mode, home, clock-in
  and clock-out with success / offline receipts and the geofence error with
  numbers, history, offline queue), the RTL bootstrap and the mirrored back
  arrow

`apps/api`'s `test:e2e` (not part of `pnpm test` — it's slower and needs a
live database) runs 39 integration tests (Jest + Supertest) against a real
NestJS app instance and a dedicated `fieldmaster_test` Postgres database.

## What's covered, by layer

### Pure business logic (`packages/shared-validation`, 35 tests)

The 9-hour standard-day rule, daily-rate proration, manual full-day credit,
hourly split, overtime, emergency ±60/+15-minute compensation, forgotten-
stamp monthly sequencing, `Asia/Jerusalem` timezone/DST month-boundary
handling, Haversine geo distance, and — added this pass — offline-event
canonicalization and genuine Ed25519 sign/verify round-trips (including
tamper detection and wrong-key rejection). This layer has no database or
HTTP dependency, so these tests run in well under a second and are the
cheapest place to add a new payroll/compensation edge case.

### API unit tests (`apps/api`, 10 tests)

The RBAC permission matrix (every role × permission combination) and
`LocationValidationService`'s time-deviation/mock-location branching logic.

### API integration tests (`apps/api/test/*.e2e-spec.ts`, 21 tests)

Against a real running NestJS app + Postgres, covering (see
`IMPLEMENTATION_STATUS.md` section 35 for the exact mapping to the spec's
14 acceptance scenarios):

- OTP login, refresh-token rotation and reuse detection, owner-limit
  enforcement, suspended-account lockout
- Financial isolation (Field Manager `403` on payroll routes; worker-list
  response never serializes compensation for a Field Manager viewer)
- Full geofenced clock-in → mandatory summary → approval → 9h/overtime split
- Manual full-day credit with zero money exposed to the approving Field Manager
- The forgotten-stamp two-strike sequence (exact 1000-agorot deduction on
  the 3rd infraction)
- `DEVICE_FAILURE` corrections never counting as a forgotten stamp
- Flexi-Check clock-in from any location
- Payroll calculate → finalize → block-further-edits → reopen
- **Offline sync** (5 tests, added this pass): full offline clock-in/out
  round trip using genuine Ed25519 signatures and the device timestamp as
  the authoritative business time; invalid-signature rejection creating no
  attendance record; unregistered-device rejection; duplicate-submission
  detection; Owner-revoked-key rejection

### Admin web (`apps/admin-web`, 172 tests)

The app is Arabic only, so every test renders the real `ar.json`
(`src/test/render-with-intl.tsx`). Each page has tests for its content,
right-to-left layout, Western digits, error and empty states, and (where
it has money) that a Field Manager never sees ₪. The original Step 1 tests
are still there:

`format.ts` pure-function tests (agorot/minutes/datetime formatting,
including the "null renders an em-dash, not ₪0.00" rule that matters for
not implying zero pay). `owner-only.test.tsx` — 3 tests proving the
`OwnerOnly` wrapper genuinely never puts financial children in the DOM for
a Field Manager or Worker session (not just CSS-hidden) and redirects,
using a real `AuthProvider` + seeded `localStorage` session, not a mocked
auth hook.

## What's not covered

- **Playwright web E2E** and **Detox mobile E2E** suites (spec sections
  34.3) are not implemented — there is no browser-automation tool or iOS
  Simulator available in this development environment (see
  `technical-decisions.md`). What exists instead: a live interactive pass
  through the admin-web app in a real browser and through the mobile app's
  Expo web target, done manually in earlier sessions and documented in
  `IMPLEMENTATION_STATUS.md` sections 26–27, plus this session's live
  `curl`-based verification of the offline-sync flow against the real dev
  database and a real Metro bundle build proving the mobile app's new
  dependencies resolve correctly.
- **Security-specific test suite** (spec 34.4): cross-organization access,
  expired/reused onboarding tokens, replayed clock events, and mock-location
  detection are exercised indirectly by the integration tests above, but
  there's no dedicated `security.e2e-spec.ts` enumerating every attack
  listed in the spec.
- **PDF report assertions**: PDF generation is implemented and was manually
  verified (a real PDF generated against seeded data, downloaded via its
  signed URL), but no automated test asserts on the PDF's content/hash.

## Database setup for tests

Tests run against a **separate** `fieldmaster_test` database on the same
Docker Postgres container, not the `fieldmaster` dev database — truncated
between test files via `resetDatabase()` in `apps/api/test/test-app.ts`.
**Migrations must be applied to both databases independently**:

```bash
pnpm db:migrate   # applies to $DATABASE_URL (fieldmaster)
DATABASE_URL="postgresql://fieldmaster:fieldmaster_dev_password@localhost:5433/fieldmaster_test?schema=public" \
  pnpm --filter @fieldmaster/api exec prisma migrate deploy
```

Forgetting the second command is the most common cause of `relation "..."
does not exist` when running `test:e2e` after adding a new migration — see
`troubleshooting.md`.

## Adding a new business-logic test

Prefer `packages/shared-validation` for anything that's pure math/logic
(no DB, no HTTP) — it's the fastest feedback loop and the same code the API
actually calls, not a reimplementation. Reserve `*.e2e-spec.ts` for
behavior that genuinely needs a real request/response cycle or database
state (authorization, persistence, transactions).
