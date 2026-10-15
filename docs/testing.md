# Testing

## Running the suites

```bash
docker compose up -d                  # tests need a real Postgres+PostGIS, Redis and MinIO
pnpm db:migrate                       # applies migrations to both fieldmaster and fieldmaster_test
pnpm test                             # unit + component tests across every package
pnpm --filter @fieldmaster/api test:e2e   # integration tests against a real database
```

`pnpm test` (root) runs, in parallel via Turborepo:

- `packages/shared-validation` — 115 pure-function unit tests (Jest),
  including the identity-document rules of Step 8 (Israeli check digit, the
  Palestinian ID's 9 digits, all zeros refused for every type) and, since
  the flexible organization model, the work rules (validation, the version
  in force on a date, every formula with other rules), a month calculated
  per worker equal to each worker alone, and month date ranges
- `apps/api` — 147 unit tests (Jest: RBAC and the permission catalog
  (built-in roles, what each permission needs, the money group), report
  access by permission, location validation, app
  environment, notification money stripping; Step 8: report access, filters,
  hashing, CSV and templates, PDF rendering; upload type detection, metadata
  stripping, invitation tokens and status; Step 9: audio type detection,
  transcription config, the push provider and its content, notification
  preferences, the offline canonical form)
- `packages/i18n` — 88 tests (Vitest): the shared Arabic formatter (including a
  check that its built-in Israel time-zone rules match Intl for every hour of
  2024-2030), error-code mapping, enum labels, ICU validity of the shared
  messages and the translation-check library
- `apps/admin-web` — 789 tests (Vitest + React Testing Library), all in
  Arabic: every page, notification text, the admin messages and the
  financial-isolation guards; since the flexible organization model, every
  page and menu item decided by permission (built-in and custom roles, a
  member restricted to some projects), the roles and work-rules pages, and
  the users page's role, scope and Owner limit
- `apps/mobile` — 496 tests (Jest + jest-expo + React Native Testing Library),
  all in Arabic.
  - Every screen and state: loading, empty, error from the API code,
    offline, Western digits, no other worker's data.
  - Step 9 adds: the shift map and live distance, photos, the voice
    summary, receipts, the emergency texts and breakdown, history and pay,
    salary and its estimate label, notifications and deep links, the
    supervisor, account states.
  - The library: the encrypted queue (tamper, wrong key, migration), the
    Keychain/Keystore-only storage, the session refresh, the revoked key,
    device registration, push.
  - The first test of a file may take longer than 5 s under `pnpm test`
    (every package at once), so the timeout is 15 s.

`apps/api`'s `test:e2e` (not part of `pnpm test` — it's slower and needs a
live database) runs 210 integration tests (Jest + Supertest) against a real
NestJS app instance, a dedicated `fieldmaster_test` Postgres database, Redis
and MinIO (the upload and report tests store real files; CI starts a MinIO
container for them). Run it with the machine awake: a sleep in the middle
stalls the jobs and skews Docker's clock (MinIO then refuses signed requests).

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
- **Payroll versions (Step 7, `payroll-versions.e2e-spec.ts`, 13 tests):**
  the spec's numbers (daily 45,000 / hourly 5,000 / overtime 7,000 agorot:
  9 h, 6 h with and without full-day credit, 10 h 30 m, hourly 6 h, a Night
  Turan emergency 02:00-03:00 = 135 min = 11,250, four forgotten stamps and
  a reversal), dates (a mid-month rate change, 00:30 on the 1st), the version
  lifecycle (finalize, every edit refused, reopen with a reason, version 1
  unchanged, version 2), the background job (same Idempotency-Key = same
  job, concurrent requests, a lost job, a failed job), warnings and pending
  counts, manual adjustments, the worker's own statements and the Owner
  dashboard. `test/payroll-helpers.ts` starts a calculation and waits for
  its job.
- **Reports (Step 8, `reports.e2e-spec.ts`, 15 tests):** every type as
  Owner, Field Manager and Worker. The PDF text is read in a child process
  and must contain the Arabic labels, the report ID and the data hash; a
  Field Manager's copy has no ₪. The CSV has a BOM, Arabic headers and
  Western digits. Also tested: the same Idempotency-Key gives the same
  report, a failed job, who sees which report (404 for the rest), and verify
  detecting a file changed after generation.
- **Onboarding (Step 8, `onboarding.e2e-spec.ts`, 13 tests):**
  - the full flow (invitation, public page, uploads, application, Owner
    review, approval, sign-in, dev quick login), and a Palestinian ID;
  - expired, used, revoked, unknown and malformed links (one 404);
  - files typed by content; oversized, wrong-type and malware-hook refusals,
    with nothing stored;
  - rate limits; audit rows without values;
  - every log line, audit row and notification captured, and searched for
    the ID numbers, bank details, tokens, file names and photo metadata.
- **Mobile worker API (Step 9, `mobile-worker.e2e-spec.ts`, 28 tests):**
  device registration, attachments and transcription, the new clock fields
  (DETECTED refused, UNAVAILABLE accepted, photos and voice notes claimed
  once), eligibility, the worker's own entry and pay, the current-month
  estimate, notification preferences and push (a spied provider, no money
  or names), account states after a valid code, revoked keys.
- **The leak scanner (Step 8, 60 GET routes since Step 9):** It now also searches every
  response for the seeded ID numbers, bank details and invitation tokens,
  as values in any string, not only as keys.
- **Flexible organization model** (28 new tests in 5 new files, plus 2 in
  the leak scanner):
  - `roles-permissions.e2e-spec.ts` (8): built-in roles unchanged, custom
    roles created from the catalog, money behind `VIEW_FINANCIALS`, changes
    applied on the next request, last-administrator protection (including
    two simultaneous demotions, decided by the advisory lock), audit old →
    new;
  - `member-scope.e2e-spec.ts` (7): a member restricted to one project, in
    lists, by id (not found, cannot change), reports, notifications (new and
    old), the live channel, the organization-wide permissions gone while
    restricted, and no Turan call-outs or onboarding applicants;
  - `work-rules.e2e-spec.ts` (7): 540 → 480 from next month (this month
    still 540, next month 480, a finalized month unchanged); a new penalty
    leaving the adjustments already recorded as they were; a change needs a
    date after today, valid values, a reason and a real change; only a money
    viewer changes the penalty; the months a change reaches; the clock-in
    window and the emergency minutes from the rules in force;
  - `query-counts.e2e-spec.ts` (1): the heavy pages and jobs send the same
    number of SQL statements for 4 workers as for 40 (and log the counts);
  - `pagination.e2e-spec.ts` (3): every growing list as a page and whole,
    malformed values refused;
  - the leak scanner adds custom roles (one with every permission but money,
    one restricted to another project) and a positive control with money;
  - changed on purpose: the 2-Owner limit test in `auth-and-rbac` became
    the configurable-limit test, and two tests in `users-devices` set the
    limit to 2 to keep checking the limit reached.
- **Mobile manager mode** (13 tests: two new suites and one new work-rules
  test, plus the scanner's new routes):
  - `manager-mode.e2e-spec.ts`: two managers share one subject (the Field
    Manager approves, the Owner's copy shows who handled it and when);
    a requested correction settles with its note; an open entry's alert
    marked followed up by a member who may settle attendance, and reopened
    by the clock-out; a restricted member's subjects and counters; the home
    counters per permission («محاسب» gets none) matching the approvals list;
    the application summary (nothing decrypted, the bank masked by
    permission, settled by approving, a late rejection refused); a
    supervisor report resolved once, the supervisor told; a work location
    in one transaction (a failing step leaves nothing), the budget only with
    money permission, edits audited per field and new geofence versions; a
    shift with its workers (conflicts listed and refused together); an entry
    photo per view, audited; one worker's offline records; a notification
    stored before subjects asks for its action only while its record waits.
  - `seeded-salary.e2e-spec.ts`: runs the development seed and signs in as
    every seeded member: 200 from both salary endpoints with a worker
    profile, `404 NO_WORKER_PROFILE` otherwise; the pending applicant cannot
    sign in.
  - `work-rules.e2e-spec.ts`: an eight-hour day set from next month, once
    in force: the emergency's estimate (notification and estimated cost),
    the overtime alert, the clock-out split (480 + 60) for the manager and
    the Owner's 540.00 ₪, the list's and evidence's `dayRules`, the cost,
    the approval and the worker's own pay all use 480.
  - changed on purpose: the work-rules test that expected defaults and a
    "baseline" now expects the stored version 1; `mobile-worker` expects
    `NO_WORKER_PROFILE` instead of `NOT_FOUND`, and the subject id in a
    manager's push.
- **Load test** (not part of `test:e2e`): `apps/api/scripts/load-test/`, see
  `scalability.md` for how to run it and the numbers.
- **Offline sync** (5 tests, added this pass): full offline clock-in/out
  round trip using genuine Ed25519 signatures and the device timestamp as
  the authoritative business time; invalid-signature rejection creating no
  attendance record; unregistered-device rejection; duplicate-submission
  detection; Owner-revoked-key rejection

### Mobile app (`apps/mobile`, 773 tests)

Every screen renders the real Arabic messages. Mobile manager mode adds the
manager home for an Owner, a Field Manager, a custom «محاسب» and a member
restricted to some projects (no ₪ without `VIEW_FINANCIALS`, and the
financial dashboard never called), live operations, approvals, the
attendance review (each action, no cost without the money permissions, the
day rules' preview), the work-location editor and the new shift, every
notification action screen, the notifications list (tabs, grouping, the
handled state), the salary empty state and «راتبي» hidden from members who
do not clock in.

### Admin web (`apps/admin-web`, 792 tests)

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
auth hook. Since the flexible organization model `OwnerOnly` is
`RequirePermission` with the financial permission, and
`require-permission.test.tsx` adds custom roles, a restricted member and the
wait for `GET /auth/me`.

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
  replayed clock events and mock-location detection are exercised by the
  integration tests above (expired, reused and revoked onboarding tokens
  have their own tests since Step 8), but there's no dedicated
  `security.e2e-spec.ts` enumerating every attack listed in the spec.
- **Browser checks** of Step 8 (every report type as Owner and Field
  Manager, the onboarding at phone size) and of Step 9 (the mobile app's web
  target against the real API) were driven with headless Playwright scripts
  against the dev servers, not a committed suite.
- **Mobile E2E on a device:** the Maestro flows in `apps/mobile/.maestro/`
  (sign-in, clock-in inside the geofence, the mandatory summary, clock-out,
  offline then sync, the Night Turan emergency) are written but were not run
  here: there is no emulator, simulator or Maestro on the development
  machine. See `apps/mobile/.maestro/README.md`.

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
