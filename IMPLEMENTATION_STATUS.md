# FieldMaster — Implementation Status

## Step 3 of 10 — mobile app in Arabic only + Arabic seed data (2026-10-09)

Scope: `apps/mobile` and the seed data. PDF templates were not touched (later
step).

- **One shared i18n package**, `packages/i18n` (`@fieldmaster/i18n`), used by
  both apps instead of copying. It holds:
  - the shared Arabic messages: common/glossary, states, errors, enums, auth,
    test-mode login;
  - the formatter;
  - the API error → Arabic mapping;
  - enum labels;
  - the translation-check library.

  The admin web moved to it with no visible change except the requested
  geofence wording. The notification renderer stays in the admin web,
  because mobile has no notifications screen. The decision is in
  `docs/technical-decisions.md`.
- **Mobile is Arabic only and right-to-left:**
  - there is no switcher and no English file;
  - `src/i18n/messages/ar.json` (110 keys) plus the 295 shared keys, read
    with use-intl;
  - every screen and state was converted: login (test-mode banner,
    quick-login list, OTP, organization choice), home, clock-in, clock-out,
    history and offline queue, with loading, empty, error + retry, offline,
    pending sync, and success / offline receipts.
- **RTL in every environment:**
  - Expo Go: `extra.forcesRTL`;
  - development / production builds: the expo-localization plugin;
  - web: `dir="rtl"` on `<html>` and the root view;
  - a one-time reload safety net that cannot loop.

  Only start/end styles are used (lint fails on left/right), the back arrow
  is mirrored, and phone numbers and coordinates are isolated LTR. The
  details of Expo Go vs. builds are in `docs/technical-decisions.md`.
- **Font:** IBM Plex Sans Arabic, loaded before the first frame. Text is
  large for workers (body 18, buttons 20, 56-point touch targets) with an
  Arabic line height of 1.6×.
- **Digits and time:** Western digits, Asia/Jerusalem, durations like
  "1 س 30 د". The shared formatter does not rely on Hermes' Intl; it was
  proven against Intl in tests.
- **Geofence error:** "أنت خارج نطاق الموقع. المسافة: 184 م، المسموح: 100 م."
  (same wording on the web).
- **Checks:** mobile `pnpm lint` runs ESLint `i18next/no-literal-string`
  (Text/TextInput must come from AppText/AppTextInput) and
  `scripts/check-i18n.mjs`. The script checks for a single ar.json, no
  English values, used keys that exist, every API error code translated,
  the glossary, Hebrew/Arabic-Indic digits, and no left/right styles.
- **Seed data in Arabic:**
  - people, the organization, projects, clients, sites, shift titles, daily
    summaries and reasons;
  - phone numbers, amounts, coordinates and every business rule are
    unchanged;
  - `docs/seed-accounts.md` was updated.

  No test depended on the old names: the API and admin-web tests use their
  own fixtures.
- **Found and handed off as a separate task (not fixed here):** the API
  marks an OTP code as used before the organization is chosen, so a user in
  two organizations cannot finish OTP sign-in
  (`apps/api/src/modules/auth/auth.service.ts`).

**Checked:**
- **Web target** (375×812, every screen, real API):
  - login: test-mode banner and quick login, empty-field message, code step
    with the LTR phone number, sign-in;
  - home: no active shift, active shift, a clock-out pending sync, the error
    + retry state;
  - clock-in: the geofence error from the real server ("المسافة: 1996 م،
    المسموح: 150 م"), then the success receipt;
  - clock-out: summary required, offline receipt;
  - offline queue: pending, then accepted after "مزامنة الآن";
  - history.

  Everything was right-aligned, with Western digits and no English UI text
  (only the brand name).
- **Native bundles:** `expo export` built the Android and iOS bundles to
  Hermes bytecode.
- **Not run on a phone, emulator or simulator:** this machine has no Xcode
  and no Android SDK. The Expo Go steps are in the README.

**Tests** (runtime counts):

| | Before Step 3 (249ea81) | After |
|---|---|---|
| shared-validation | 35 | 35 |
| @fieldmaster/i18n (new) | — | 69 |
| admin-web | 227 | 172 |
| API unit | 25 | 25 |
| mobile | 0 | 131 |
| API e2e | 39 | 39 |
| **Total** | **326** | **471** |

Admin-web went down by 58 because its format, error, enum and check-library
tests moved with the code into `@fieldmaster/i18n`; none were deleted. The
package added 11 more, and admin-web gained 3 (its own messages file).

`pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ 432 · `pnpm test:e2e` ✅ 39 ·
`pnpm build` ✅ · `expo export` (Android + iOS) ✅

---

## Admin web is Arabic only (2026-10-07, after Step 2)

At the product owner's request, English was removed from the admin web. It now
works only in Arabic, right-to-left. Details and reasoning are in
`docs/technical-decisions.md` ("Admin web is Arabic only").

- Removed:
  - `en.json`, the العربية/English switcher (header, login, worker notice,
    404/error pages), the `fm_locale` cookie and `useAppLocale`;
  - the English branches in formatting and in the notification renderer
    (stored English text is never shown).
- The root layout always renders `<html lang="ar" dir="rtl">` and no longer
  reads cookies.
- API errors: an unknown code now shows the Arabic message for its HTTP status
  instead of the API's English message.
- `scripts/check-i18n.mjs` was rewritten for one language. It now fails when:
  - any messages file other than `ar.json` appears;
  - a message is not Arabic;
  - the API has an error code without an Arabic message.
- Tests: every test now renders Arabic only. Tests that only checked English
  text or the language switch were removed. Every behavior they checked
  (payloads, navigation, filtering, financial isolation, LTR isolation of
  money/phones/ids) is still asserted in Arabic. A coverage audit compared
  each converted test file with the previous version.
- Also fixed:
  - the map credit is now Arabic;
  - empty login fields show Arabic messages instead of the browser bubble;
  - a translated `global-error` page;
  - the emergency title is shown in Arabic inside notifications;
  - old English default reasons are shown in Arabic in the audit log;
  - an unknown enum value shows its raw code instead of made-up English.
- New guards:
  - a test that every message in `ar.json` is valid ICU;
  - lint fails on any API error code without an Arabic message.
- Not changed, known gaps:
  - the mobile app is still English-only (Step 3);
  - the Worker Attendance Ledger PDF from the API is English (later step);
  - seed demo data is English;
  - native date/time pickers follow the browser's language.

**Tests** (runtime counts):

| | Before Step 2 (9be8f9d) | After this change |
|---|---|---|
| shared-validation (unit) | 35 | 35 |
| API unit | 21 | 25 |
| admin-web | 16 | 227 |
| API e2e | 35 | 39 |
| **Total** | **107** | **326** |

No count went down. Removing English deleted tests that only checked
English text or the language switch: 13 "renders … in English" page tests, plus the
English cases inside the root-layout, error-page, format, errors, enum and
notification tests. New Arabic tests replaced them, so admin-web went from
225 to 227. Two independent audits compared every test with the Step 1 and
Step 2 versions and found no weakened assertion and no lost behavior. The
API financial-isolation tests are byte-identical to Step 1, and the
admin-web ones are the same or stronger.

**Browser check** (dev server; a fresh tab per role; console read after
every page):
- **As Owner:**
  - login;
  - dashboard;
  - workers, a worker's page, the approve page;
  - sites (map);
  - scheduling, an emergency shift, new shift;
  - Turan;
  - attendance;
  - payroll and September 2026;
  - reports;
  - notifications;
  - audit log;
  - a 404 URL.
- **As Field Manager:** the same pages. Payroll, the payroll period and the
  audit log redirect to the dashboard, and no ₪ appears on any page.

On every page: `lang="ar" dir="rtl"`, no horizontal overflow, no raw keys,
no Arabic-Indic digits, and no English interface text. The only Latin text
is the brand name and seed data such as names and sites. There were no
hydration warnings in either role. A stale `fm_locale=en` cookie is ignored.

`pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ 287 · `pnpm test:e2e` ✅ 39 ·
`pnpm build` ✅

## Step 2 of 10 — Arabic + RTL for the admin web (2026-10-07)

> English was removed after this step; see the section above. The language
> switch described below no longer exists.

Scope: `apps/admin-web` only (mobile is Step 3, PDF reports later). One small
API change was needed for notifications (see below).

- **Languages.** Arabic (default) and English, no Hebrew. The choice is saved
  in the `fm_locale` cookie. `<html lang dir>` is rendered on the server from
  that cookie, so the first HTML already has `lang="ar" dir="rtl"` (checked
  with `curl` and with a root-layout test) and there is no hydration warning
  when switching. The switcher is in the header and on the login page, and it
  changes language without leaving the page. Built on `next-intl` without
  URL prefixes.
- **All UI text** is in `src/i18n/messages/ar.json` / `en.json` (734 keys).
  `pnpm lint` in admin-web now also runs `scripts/check-i18n.mjs`, which fails
  when:
  - a key exists in only one language, or the placeholders differ;
  - a key is used in code but missing from the files;
  - a glossary term changed;
  - the files contain Hebrew or Arabic-Indic digits;
  - a component uses physical direction classes (`ml-`, `pl-`, `left-`,
    `text-left`, …).

  ESLint's `i18next/no-literal-string` rule catches hard-coded JSX text.
- **RTL.**
  - Only logical Tailwind classes are used.
  - Directional icons (chevrons, arrows) are mirrored.
  - The sidebar border and active marker sit on the start edge.
  - Tables align to the start and scroll inside their own box.
  - Forms keep phone and code inputs LTR.
  - The Turan schedule and the dashboard bar list follow RTL.
  - On the Leaflet map, the zoom control moves to the top right and the
    attribution to the bottom left in Arabic.

  The app has no Recharts charts and no calendar widget yet, so there was
  nothing to convert for those.
- **Font.** IBM Plex Sans Arabic via `next/font`, with a Latin fallback.
- **Formatting** (`src/lib/format.ts`):
  - Western digits (`ar-u-nu-latn`) and Gregorian dates in `Asia/Jerusalem`.
  - Money from integer agorot as `₪ 1,234.50`, isolated with `<bdi dir="ltr">`
    so it never reorders inside Arabic text. Phones and IDs are isolated the
    same way.
- **API errors** are translated from their code, including details: for
  `GEOFENCE_OUTSIDE_ALLOWED_RADIUS` the message shows the distance and the
  allowed radius. GPS accuracy and device-clock errors work the same way. For
  an unknown code the API's own message is shown.
- **Notifications** are rendered from `type` + `data_json` in the reader's
  language. The English `title`/`body` stay in the database as a fallback.
  The API now fills `data_json` for every notification type and strips
  `*Agorot` amounts from non-Owner recipients. The decision is recorded in
  `docs/technical-decisions.md`.
- **Test mode banner and quick login** are translated.
- **Glossary** terms are exact and enforced by the checker. The Arabic copy
  had a separate native-language review: 37 wording fixes applied.
- **Taken from `wip/phase1-arabic-rtl`** (branch left untouched): the locale
  config/cookie helpers, the enum-label helper, the test render helper, and
  parts of the translation files. Their wording was redone to match the
  glossary.
- **Left on that branch:** the Tailwind v4 upgrade, the shadcn migration,
  the Pino/health API changes, and the Husky/Prettier/Docker changes.

**Checked in the browser** (Arabic and English, as Owner and as Field
Manager, desktop width; automated pass for `dir`, horizontal overflow, raw
keys, Arabic-Indic digits, left-aligned cells and stray English text, then
screenshots):
- login;
- dashboard;
- workers, worker detail, approve worker;
- sites (with map);
- shifts, shift detail, new shift;
- Turan;
- attendance;
- payroll and a payroll period (Owner only; the Field Manager is redirected);
- reports;
- notifications;
- audit log (Owner only).

Also checked:
- the Worker "use the mobile app" notice;
- the Field Manager sees no ₪ amounts on any page.

One RTL bug found and fixed: screen-reader table captions pushed `/turan` wider
than the screen in Arabic.

**Adversarial review.** Three code lenses ran, and each finding went to two
skeptics. 13 findings came back; 7 were confirmed and fixed:

1. Emergency call-out shifts showed the API's English title. They now show
   "استدعاء طوارئ".
2. The audit log showed raw error codes as reasons. They are now translated.
3. Fixed English reasons were sent for payroll reopen and worker reject. They
   are now sent in the user's language.
4. 429 and 503 errors showed a generic message. They now get their own
   messages.
5. Messages already on screen did not follow a language switch. They now do.
6. The map marker's tooltip did not follow a language switch. It now does.
7. Unknown URLs and crashes showed Next's English pages. There are now
   translated `not-found` and `error` pages.

Hardening from the refuted findings:
- The money-stripping guard now also catches nested fields.
- The RTL class check now also catches negative insets, `origin-*` and
  `bg-left/right`, and it covers `components/ui`.
- ESLint now also checks `description`, `message` and `hint` props.

### Final run after this step

`pnpm lint` ✅ (incl. i18n check, 734 keys) · `pnpm typecheck` ✅ ·
`pnpm test` ✅ 285 (35 shared-validation + 25 API + 225 admin-web) ·
`pnpm test:e2e` ✅ 39 · `pnpm build` ✅.

---

## Step 1 of 10 — verification + test login (2026-10-05)

### Part A: does the existing project run?

| Command | Result |
|---|---|
| `docker compose up -d` | ✅ Postgres+PostGIS, Redis, MinIO healthy |
| `pnpm install` | ✅ |
| `pnpm db:migrate` | ✅ (8 migrations, none pending; this step adds 1 more) |
| `pnpm db:seed` | ✅ 16 accounts, demo data |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 54 unit tests before this step |
| `pnpm test:e2e` | ✅ 21 e2e tests before this step |
| `pnpm build` | ✅ |
| `pnpm dev` | ❌ → ✅ see below |

**Exercised live:** logged in through the real OTP flow as a seeded Owner,
Field Manager and Worker. 36 API checks across the three roles all returned
the expected status (200 for allowed routes, 403 for payroll and audit log
as Field Manager or Worker, workers list and own shifts for the Worker), and
no compensation data leaked to the Field Manager. All 10 admin-web pages
rendered real data for the Owner (dashboard, workers, sites, shifts, Turan,
attendance, payroll list and period detail, reports, notifications, audit
log).

**Found broken and fixed:**

1. **`pnpm dev` could not start the API.** Port 3000 was taken by an
   unrelated app on the machine (`EADDRINUSE`), and Turborepo's strict env mode
   dropped `PORT`/`NEXT_PUBLIC_API_URL` from the shell, so the port couldn't
   even be overridden. Fixed: `turbo.json`'s `dev` task now passes
   `PORT`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`, `APP_ENV` and `DEV_LOGIN_ENABLED`
   through, so `PORT=3010 NEXT_PUBLIC_API_URL=http://localhost:3010/api/v1 pnpm dev`
   works (documented in README and `docs/troubleshooting.md`).
2. **React hydration error on every authenticated admin-web page load.**
   `AuthProvider` read `localStorage` during render, so the server HTML
   (loading state) never matched the client's first render (full shell).
   Fixed: the session is read after mount and exposed with an `isReady` flag
   that the redirect guards wait for. Regression test added.
3. Found while doing Part B: `DEVICE_TIME_DEVIATION_SECONDS` was read by the
   API but missing from `.env.example` (now documented), and the Terraform ECS
   task set `NODE_ENV=staging`/`dev`, which the new `APP_ENV` logic would have
   read as "development" (now sets `APP_ENV` and `DEV_LOGIN_ENABLED=false`
   explicitly; `terraform validate` passes for dev/staging/production).

### Part B: test login without SMS

- **API.** `APP_ENV` (development | staging | production) and
  `DEV_LOGIN_ENABLED` are validated at boot. Production + enabled exits with
  "FieldMaster API configuration error…" (checked with the built `dist`
  server and in an automated test that spawns `src/main.ts`).
  `DevFixedCodeOtpProvider` makes every seeded number accept `123456`; the
  console and Twilio providers are unchanged and can be pinned with
  `OTP_PROVIDER`. `GET /api/v1/auth/dev/users` and
  `POST /api/v1/auth/dev/login` return the same session as OTP verification
  (same code path: device registration, refresh-token family, rotation) and
  write a `DEV_LOGIN` audit event. Both return 404 when dev login is off.
- **Admin web.** The login page shows a "TEST MODE — login without SMS" banner,
  a "Quick test login" list grouped into Owners / Field Managers / Workers, and
  the `code: 123456` hint, but only when the API says dev mode is on. A Worker
  signing in on the web gets a "use the mobile app" notice instead of a page
  full of 403s.
- **Mobile.** The login screen has the same banner, quick-login list and hint.
  Verified through the Expo web target: worker quick login opens the worker's
  own shifts, and phone + `123456` works.
- **Hardening from an adversarial review** (4 reviewers, every finding checked
  by 2 skeptics; 17 findings, 4 confirmed and fixed):
  - Sessions started through quick login or the fixed code now end as soon as
    dev login is turned off, instead of staying valid for up to 30 days. Each
    session records its origin; the guard, the WebSocket gateway and the SSE
    stream reject test-mode tokens, and refresh revokes the session.
  - In dev login mode the OTP provider must be the fixed-code one, so the
    `123456` hint is always true.
  - The admin web clears its query cache on every login and logout. After a
    quick switch from Owner to Field Manager, the Field Manager briefly saw the
    Owner's cached worker compensation.
  - The "403 on every financial route" test now matches an exact,
    hand-maintained route list and explicitly covers the service-layer guarded
    `GET /workers/:id/compensation-profiles`.
- **Docs:** `docs/seed-accounts.md` (all 16 seed users + both ways to log in),
  README, `docs/deployment.md`, `docs/deployment-free-tier.md` (staging + true
  for a test deployment, with the rules for going live), `render.yaml`
  (production keeps `APP_ENV=production`, `DEV_LOGIN_ENABLED=false`).

### Final run after this step

`pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ 72 (35 shared-validation +
21 API + 16 admin-web) · `pnpm test:e2e` ✅ 35 (the 21 existing + 14 dev-login) ·
`pnpm build` ✅ · mobile `tsc` ✅. 107 automated tests in total.

Not done in this step: on-device testing on a physical phone through Expo Go.
The checklist is in the step report. The parked Arabic/RTL work from the
earlier plan is on branch `wip/phase1-arabic-rtl` and has not been verified.

---


This tracks real status against the full FieldMaster specification. The
delivered slice is the **backend API, a full-featured Next.js admin web
app, a working Expo (React Native) mobile worker app with offline
attendance sync, PDF report generation, real-time notifications,
background jobs, a CI pipeline, Terraform IaC (validated, never applied),
and the full 14-document `docs/` set** — chosen and scoped deliberately
(see `docs/technical-decisions.md`) because parts of the full spec (a live
AWS deployment, Detox/Playwright suites, device attestation) remain a
multi-month, multi-person build that cannot be honestly claimed complete in
one session. Everything marked **Done** below has been implemented,
migrated against a real Postgres+PostGIS database, compiled, and exercised
by an automated test (backend, including 5 new offline-sync integration
tests using genuine Ed25519 cryptography), a live browser/web-preview
session against the running API (admin-web, mobile — earlier sessions), or
this session's own live `curl`-based verification against the real running
dev API and database (see section 20).

**This pass's baseline check found and fixed one real bug**: `prisma/seed.ts`
computed a seeded `DAY_TURAN` shift's start time from the current wall-clock
hour while hardcoding only its end hour, so running the seed script after
18:00 local time produced an end time before the start time and violated
the database's own `shifts_end_after_start` CHECK constraint — the
constraint is what caught it. Fixed by hardcoding both ends of the interval.
Also fixed this pass: `apps/admin-web` had zero test files, so the root
`pnpm test` failed outright (`vitest run` exits non-zero on an empty
suite) — added real tests (format-function unit tests + a component test
proving the `OwnerOnly` financial-isolation guard never renders financial
children for a non-Owner session) and a working `vitest.config.ts`/setup
file, which surfaced and required fixing two unrelated environment quirks
(Node 22's experimental global `localStorage` shadowing jsdom's own, and
esbuild's JSX transform needing explicit configuration) — see
`docs/troubleshooting.md`.

Legend: ✅ Done and tested · 🟡 Partial (real code, narrower than spec) · ⬜ Not started

## 1–4. Monorepo, stack, execution rules

- ✅ pnpm workspaces + Turborepo, TypeScript strict mode, shared config packages
- ✅ Docker Compose: Postgres 17 + PostGIS 3.5, Redis, MinIO (S3-compatible)
- ✅ `.env.example` with every variable the API reads, dev adapters requiring no paid credentials
- ⬜ ESLint/Prettier/Husky/lint-staged git hooks (ESLint config exists and passes; Husky hooks not wired)

## 5. Multi-organization architecture — ✅

Every business table carries `organizationId`. `JwtAuthGuard` re-resolves the
membership (and re-checks `ACTIVE` status) on every request instead of
trusting the token payload alone. Cross-org access is structurally
impossible because every service query is scoped by the authenticated
user's `organizationId`, never a client-supplied one. Verified by an
automated test (a worker cannot read another worker's records even inside
the same org; a Field Manager gets `403` on every financial route).

## 6. Roles and authorization — ✅ (Owner/Field Manager/Worker), 🟡 (Temporary Supervisor)

- ✅ `Permission` catalog + `PermissionsGuard`, enforced per-route
- ✅ Financial fields (`VIEW_COMPENSATION`, `VIEW_PAYROLL`, `VIEW_FINANCIAL_DASHBOARD`, …) are **never** in the Field Manager's permission set — enforced at the guard layer *and* the DTO-serialization layer (`worker-response.mapper.ts` strips `compensation` unless the viewer is an Owner or the worker themself)
- ✅ Max-2-active-Owners enforced twice: `OwnerLimitService` inside the same transaction, and a Postgres trigger (`trg_enforce_max_two_owners`) as the DB-level backstop — both paths tested
- ✅ Temporary Supervisor implemented as a time-boxed capability (`TemporarySupervisorAssignment` with `activatedAt`/`expiresAt`/`revokedAt`), checked live rather than granted as a static role
- 🟡 A Temporary Supervisor's *read* scope (only their shift's workers) is enforced for the one action they're modeled to take (opening a check-in point); a dedicated "temp supervisor view" of attendance was not built as a separate endpoint

## 7. Authentication and sessions — ✅

- ✅ Phone + OTP login; **dev adapter prints the code to the API log**; **production adapter calls the real Twilio Verify REST API** (untested against a live account — no credentials in this environment)
- ✅ **Test login (Step 1)**: `APP_ENV` (development/staging/production) + `DEV_LOGIN_ENABLED`. In dev login mode every phone accepts the fixed code `123456` (`DevFixedCodeOtpProvider`; console/Twilio providers unchanged, selectable via `OTP_PROVIDER`), and `GET /api/v1/auth/dev/users` + `POST /api/v1/auth/dev/login` give one-click login with the same session as OTP (device registration, refresh rotation) plus a `DEV_LOGIN` audit event. 404 when off; `APP_ENV=production` + `DEV_LOGIN_ENABLED=true` refuses to boot. Web and mobile login screens show a "TEST MODE — login without SMS" banner + quick-login list only when the API says dev mode is on. 25 API tests (11 unit + 14 e2e) plus 7 admin-web tests — see `docs/seed-accounts.md`
- ✅ Short-lived JWT access token + opaque rotating refresh token; refresh-token **reuse triggers full session-family revocation** (tested)
- ✅ Device registration (`UserDevice`), Owner-triggered device revocation (`AuthService.revokeDevice`)
- ✅ Account status gating: `SUSPENDED`/`ARCHIVED` users are rejected at login (tested) and mid-session (guard re-checks every request)
- 🟡 Web-specific concerns (httpOnly cookie storage, CSRF token) are not implemented — admin-web stores the access token in memory/localStorage rather than an httpOnly cookie
- ✅ Mobile Keychain/Keystore storage — `apps/mobile` stores the session via `expo-secure-store` (real iOS Keychain / Android Keystore on-device). Verified live in the Expo web preview (the one environment reachable here — no full Xcode install, see section 27), where `expo-secure-store` has no web implementation so the mobile app falls back to `AsyncStorage` on that platform only; native builds always use the real Keychain/Keystore path

## 8. Worker onboarding — 🟡

- ✅ Single-use, hashed, expiring invitation tokens (`OnboardingInvitation`), revocable, org-scoped
- ✅ Public redemption endpoint creates `User` + `Membership` + `WorkerProfile` in `PENDING_APPROVAL`, encrypts bank details, records consent + privacy-notice version
- ✅ Owner approval sets the worker `ACTIVE` and creates their first `CompensationProfile` in one transaction; push/in-app notification fires both ways (submission → Owners, approval → worker)
- 🟡 Identity-document upload (image capture, private S3 storage, signed URLs) is **not implemented** — the `identity_documents` table exists but nothing writes to it. This is the one piece of section 8 genuinely deferred; see technical-decisions.md.

## 9. Compensation model — ✅

Daily and hourly rules (9-hour standard day, proration, full-day-credit
semantics, one-standard-day cap, overtime split) live in
`packages/shared-validation/src/payroll.ts`, unit-tested independently of
the database (11 tests). Effective-dated profiles use a Postgres
`EXCLUDE USING gist` constraint so **no worker can ever have overlapping
compensation profiles**, checked at the DB level, not just in application
code. All monetary values are integer agorot; every calculation does a
single division-then-round, never chained float arithmetic.

## 10–11. Shifts, clock-in/out — ✅

- ✅ Full shift model (type, status, geofence, check-in method, grace, manager, business date)
- ✅ Overlap prevention for normal shifts (excludes `EMERGENCY_CALLOUT`), DB-level one-active-time-entry-per-worker constraint (partial unique index)
- ✅ Geofence check is **server-side only**, via real PostGIS `ST_DWithin`/`ST_Distance` — the client's own belief about being "inside" is never trusted
- ✅ Flexi-Check records exact GPS + accuracy without gating
- ✅ Device-time deviation: online events beyond 120s are rejected; offline events are flagged, never rejected outright (full signed-offline-event verification is out of scope — see section 20 below)
- ✅ Mock-location flag blocks the event outright (both check-in and check-out)
- ✅ Idempotency-Key enforced on clock-in, clock-out, emergency start/end, payroll calculation (persisted replay, conflict on key-reuse-with-different-body)
- ✅ Mandatory daily summary before clock-out (text or voice-note URL; empty rejected) — tested
- ✅ Temporary check-in points: created only by an active Temporary Supervisor or a manager, auto-treated as inactive once `expiresAt` passes (lazy check) or the shift closes (eager expiry), audit history retained

## 12–14. Full-day credit, manual corrections, forgotten-stamp rule — ✅

- ✅ Full-day-credit toggle: gated on shift-ended + under-9-hours + payroll-period-not-finalized, mandatory reason, full audit trail (old/new value)
- ✅ Manual corrections cover missing clock-in, missing clock-out, and unpaid-break-minutes, each with a typed reason and append-only `ManualTimeCorrection` row (organization, worker, field, old/new value, actor, IP, correlation ID)
- ✅ Two-strike forgotten-stamp rule: first two infractions/month free, third+ deduct exactly 1000 agorot — verified with an automated test asserting the exact sequence and the resulting `PayrollAdjustment`
- ✅ `DEVICE_FAILURE`/`BROKEN_PHONE`/etc. reasons never create a forgotten-stamp infraction (tested)
- ✅ Owner-only reversal of a deduction creates a new offsetting adjustment; the original is never deleted or mutated

## 15–16. Turan + emergency call-outs — ✅

- ✅ Day/Night Turan scheduling with overlap detection (`confirmOverlap` to proceed anyway)
- ✅ Emergency-eligibility check: active Night Turan assignment, **or** a manager starting it on the worker's behalf (this is the "manual authorization" path — see technical-decisions.md for why no separate authorization table was added)
- ✅ -60min retroactive start / +15min return buffer computed by `computeEmergencyCompensation` (shared, unit-tested), stored alongside — never overwriting — the raw click timestamps
- ✅ Full breakdown (actual vs. compensated) returned to the client and stored on `EmergencyCallout`

## 17–18. Sites, geofences, temporary check-in points — ✅

Covered above; also: project `budgetAgorot` is stripped from every non-Owner
response (tested).

## 19. Anti-tampering — ✅ (server time, mock-location), ⬜ (device attestation)

Server-authoritative time and mock-location blocking are implemented as
above. Play Integrity / App Attest / DeviceCheck device-attestation calls
are **not implemented** — they require a mobile app and platform SDKs that
don't exist in this backend-only slice. The schema has columns for them
(`attestationState`, `riskState`) so a mobile client can populate them later
without a migration.

## 20. Offline attendance — ✅ (backend), 🟡 (mobile)

Full protocol implemented this pass — see `docs/offline-sync.md` for the
complete design writeup, including a real signature-canonicalization bug
this session's own tests caught and fixed (server and client were signing
different byte strings for logically-identical events; see that doc for
the exact fix and the standing rule to prevent a recurrence).

- ✅ Ed25519 device-key registration (`POST /devices/public-key`, Owner-only
  revoke at `POST /devices/:userId/:deviceId/revoke-key`), new
  `device_public_keys` table
- ✅ `POST /offline-sync/batches` (+ `GET /offline-sync/batches[/:id]`):
  verifies each event's signature against the registered key, sorts by
  device timestamp before processing, detects duplicates via the existing
  `clock_events (device_id, client_event_id)` unique constraint, and
  dispatches every event through the *same* `ClockEventsService.clockInCore`/
  `clockOutCore` the online endpoints use (refactored this pass to extract
  those from the idempotency wrapper so both entry points share one rule
  engine) — new `offline_sync_batches`/`offline_sync_events` tables
- ✅ **Authoritative-timestamp fix**: `clockInCore`/`clockOutCore` now use
  the *device* timestamp (not `serverReceivedAt`) as the TimeEntry's
  `clockInAt`/`clockOutAt` when `origin: OFFLINE` — without this, a worker
  who clocked in offline at 6am and synced at 6pm would have been recorded
  as starting at 6pm. `serverReceivedAt` is still stored separately on the
  `ClockEvent` row as evidence of when the batch was actually processed.
- ✅ Per-event outcomes: `VERIFIED`/`FLAGGED`/`REJECTED`/`DUPLICATE`, never
  a single pass/fail for a batch; every outcome (rejections included)
  persisted as an `OfflineSyncEvent` row, never silently dropped
- ✅ Conflict handling (spec 20.4): reused the existing online-path checks
  rather than reimplementing them, so "clock-in after one already active,"
  "clock-out with nothing active," and "clock-out before clock-in" all
  resolve deterministically for free. Added one real gap this pass closed:
  `clockInCore` previously didn't check shift status at all, so a
  `CANCELLED`/`CLOSED` shift could still be clocked into online *or*
  offline — now rejected with `409` regardless of origin.
- 🟡 Mobile: `apps/mobile/src/lib/offline-queue.ts` (AsyncStorage-backed
  signed-event queue, not the spec-named encrypted SQLite — see
  `technical-decisions.md`) + `offline-sync-context.tsx` (NetInfo
  connectivity watcher, auto-flush on reconnect/foreground/60s interval) +
  a new `OfflineQueueScreen` (spec 27.10). `ClockInScreen`/`ClockOutScreen`
  now catch a new `NetworkError` (vs. `ApiRequestError`) from
  `@fieldmaster/api-client` and fall back to signing-and-queueing locally.
  **Verified**: `tsc`/ESLint clean, and a real Metro/webpack production
  bundle for the Expo web target succeeded (545 modules, no resolution
  errors) proving `tweetnacl`, `expo-crypto`'s web module, and
  `@react-native-community/netinfo`'s web module all resolve correctly.
  **Not verified**: an actual interactive offline→online transition on a
  device or simulator — this environment has no browser-automation tool
  (unlike the admin-web/mobile verification passes recorded elsewhere in
  this document, which used one) and no iOS Simulator, so the on-device UX
  wiring (does `NetInfo` behave as expected on real hardware, does the
  queue survive an app restart) is unexercised, even though the protocol
  and cryptography it depends on are proven correct by the tests below.

**Verification performed this session**: 5 new integration tests
(`apps/api/test/offline-sync.e2e-spec.ts`) against a real Postgres database
using genuine Ed25519 signatures (not mocked) — full round trip proving the
device-timestamp-as-authoritative-time behavior, invalid-signature
rejection, unregistered-device rejection, duplicate detection, and
Owner-revoked-key rejection. 4 new crypto unit tests
(`packages/shared-validation/src/__tests__/offline-sync-crypto.test.ts`) —
genuine keypair generation/signing/verification, tamper detection,
wrong-key rejection. **Additionally**, this session ran the actual compiled
API against the real (non-test) dev database and, using a small Node
script calling the same `@fieldmaster/shared-validation` signing functions
a real device would, registered a device key and submitted a real signed
offline clock-in for a seeded worker's real shift over `curl` — the
resulting `TimeEntry.clockInAt` came back exactly equal (to the
millisecond) to the 3-hours-ago device timestamp that was signed, not the
time the `curl` request was made, confirming the authoritative-timestamp
fix live against the real stack, not just the isolated test database.

## 21. Daily task summary — 🟡

Text and voice-note-URL summaries, task category, materials, problems,
follow-up flag are all implemented and required at clock-out. Actual audio
transcription (a pluggable provider interface) and photo attachments are
**not implemented**.

## 22. Approval workflow — ✅

Approve / reject / request-correction, each producing an immutable
`AttendanceApproval` row. Field-Manager-visible fields exclude every
monetary figure, enforced by TimeEntry never carrying money fields at all
(money lives only in `PayrollItem`, which Field Managers cannot query).

## 23. Payroll engine — ✅ (core), 🟡 (dashboard depth)

- ✅ Effective-dated-profile lookup per time entry (a worker's mid-month rate change is honored correctly, per entry)
- ✅ Standing `PayrollAdjustment`s (e.g. forgotten-stamp penalties) exist independently of a `PayrollItem` and get linked the first time the period is calculated — this is what lets a penalty apply the instant the 3rd infraction happens, not at month-end
- ✅ Calculate → Review → Finalize → Reopen state machine; **finalized periods block further edits** (both full-day-credit and manual corrections check this — tested); reopening requires a reason and bumps the version
- ✅ `PayrollCalculationSnapshot` recorded on every calculation
- 🟡 Financial dashboard implements: current vs. previous month totals, overtime total, forgotten-stamp deductions, cost-by-project, pending-approval financial exposure. Not implemented: cost-by-worker ranking, "highest earners," overtime-spike detection.
- 🟡 Payroll "reopen" increments version on the *same* `PayrollPeriod` row rather than creating a fully separate immutable row-per-version with duplicated historical `PayrollItem`s — see technical-decisions.md.

## 24. Notifications — ✅ (in-app + real-time), 🟡 (push)

In-app persistence + a "delivery" record per channel is implemented and
role-content-filtered (Owner notifications include cost estimates, Field
Manager notifications never do — tested for clock-out and emergency-end).
- ✅ Real-time fan-out: `NotificationsService.notify()` emits an internal
  event (`@nestjs/event-emitter`) picked up by both a JWT-authenticated
  Socket.io gateway (`/notifications` namespace, per-user rooms) and an SSE
  endpoint (`GET /notifications/stream`, token via query param since
  `EventSource` can't set headers) — clients no longer have to poll.
- ✅ BullMQ-backed background jobs now actually run against the Redis
  container (see section 30) — this doesn't retry notification delivery
  specifically, but proves the Redis/BullMQ wiring the spec calls for is real.
- **Not implemented**: real push delivery (Firebase adapter is a documented
  stub selected only when `FIREBASE_PROJECT_ID` is set, but was never
  exercised against a live project).

## 25. PDF dispute ledger — ✅

Implemented: `POST /reports/worker-attendance-ledger` renders a real PDF via
Playwright (`chromium.launch()` → `page.setContent()` → `page.pdf()`),
computing per-entry compensation through the same `PayrollCalculationService`
used by payroll itself (never a re-derived/duplicated calculation), embeds a
SHA-256 hash of the *source data* (not the PDF bytes, to avoid a
hash-of-itself circularity) in the footer, uploads to MinIO/S3, and persists
a `GeneratedReport` row. Authorization mirrors the rest of the financial
surface: Owner can generate for any worker with financials included,
Field Manager can generate for any worker *without* financials, a worker can
generate their own with financials. Verified live: generated a real PDF
against seeded data from the admin-web Reports page and downloaded it via
its signed URL.

## 26. Admin web app — 🟡

A working Next.js 15 (App Router) + React 19 + TanStack Query app in
`apps/admin-web`, verified in a live browser session against the running
API (not just typecheck/build — actually logged in as both a seeded Owner
and a seeded Field Manager and clicked through every page). Implemented:

- ✅ Phone/OTP login (with the multi-organization disambiguation step)
- ✅ Role-aware navigation and dashboard: Owner sees financial widgets
  (payroll totals, overtime cost, cost-by-project, pending-approval
  exposure); Field Manager's nav has no Payroll link at all and the
  dashboard shows an explicit "Financial figures are visible to Owners
  only" message instead
- ✅ Workers: roster list + detail, pending-onboarding queue, approve
  (with compensation form) / reject. **Verified live**: the Compensation
  column and detail-page compensation panel show real rates for the
  Owner and show `—` / "No compensation profile visible" for the Field
  Manager — driven entirely by the API's own DTO stripping, not a
  frontend-only check
- ✅ Scheduling: shift list, create-shift form (project → site →
  geofence cascading selects), shift detail with worker assignment
- ✅ Attendance approval queue: approve / reject / "Credit as Full Day",
  with a live-verified example of the finalized-payroll-period guard
  correctly blocking an edit and surfacing the API's `PAYROLL_PERIOD_FINALIZED`
  error in the UI
- ✅ Payroll (Owner-only, double-gated): calculate / view breakdown /
  finalize / reopen. **Verified live**: a Field Manager hitting
  `/payroll` directly is redirected client-side, *and* a direct
  `fetch` call to `/api/v1/payroll-periods` using that Field Manager's
  own valid access token returns a real `403 FORBIDDEN` from the API —
  confirmed in the browser console during this session, not assumed
- ✅ Sites & Projects: project list/create, site list/create (auto-creates
  a matching geofence). **Verified live**: Owner sees each project's
  budget; Field Manager's page renders the identical list with the budget
  field entirely absent from the DOM (`document.body.innerText.includes('Budget') === false`),
  again driven by the API's own serializer, not a frontend `if`
- ✅ Turan & Emergency: Day/Night Turan assignment scheduling (create/
  list/cancel). Emergency call-outs aren't a separate page -- they're
  visible in **Scheduling**, since `EmergencyCalloutsService` creates a
  real `EMERGENCY_CALLOUT`-typed shift for each one, and the seeded
  example shows up there correctly
- ✅ Notifications center: list + mark-as-read, **verified live**
  (clicked "Mark read" on the seeded "Payroll finalized" notification via
  a real mutation; the unread indicator and action link both correctly
  disappeared after refetch)
- ✅ Audit log viewer (Owner-only, double-gated like Payroll): paginated
  event list + a "Verify chain integrity" button that calls the real
  SHA-256 hash-chain verification endpoint. **Verified live**: returned
  "Chain verified — no tampering detected" against real seeded + session
  audit events; a Field Manager hitting `/audit-log` is redirected
  client-side *and* gets a genuine `403 FORBIDDEN` /
  `Missing required permission(s): VIEW_AUDIT_LOG` from the API itself

- ✅ Reports page: pick a worker + date range, generate a real PDF worker
  attendance ledger, list past reports, download via signed URL
- ✅ Map-based geofence editor: Leaflet + OpenStreetMap tiles (an explicit
  substitute for the spec-named Google Maps JS SDK — no billing account
  available; see technical-decisions.md) on the site-creation form,
  click-to-place marker + draggable radius circle, two-way synced with the
  underlying lat/lng/radius fields

Not implemented in admin-web: worker attendance history detail view,
RTL/Hebrew UI, shadcn/ui's actual CLI-generated components (hand-rolled
Tailwind equivalents were used instead — see technical-decisions.md), and
a Playwright E2E suite. A real Vitest + React Testing Library suite *was*
added this pass (see section 34) — 9 tests, including a genuine test that
the `OwnerOnly` financial-isolation wrapper never renders its children for
a Field Manager/Worker session, which was previously only verified
manually/live.

**A tooling note from this verification pass**: this session's browser
automation tool had an intermittent issue where its synthetic `left_click`
on a `<button type="submit">` would not reliably trigger React's submit
handler (the network request fired, but the resulting state update never
rendered), while a real DOM `.click()` call always worked correctly and a
direct `fetch()` against the API always succeeded. This was diagnosed as a
tool-environment quirk, not an application bug -- it doesn't affect real
users or real browsers.

## 27. Mobile app — 🟡

A working Expo (React Native, SDK 57) worker app in `apps/mobile` — an
explicit substitute for the spec-named "bare React Native workflow" (see
technical-decisions.md for why). Implemented and verified:

- ✅ Phone/OTP login (same flow as admin-web, React Native components),
  multi-organization disambiguation step
- ✅ Session persisted via `expo-secure-store` (real Keychain/Keystore on
  device); `AuthProvider` handles the async load correctly (unlike
  admin-web's synchronous localStorage read)
- ✅ Home screen: the worker's own assigned shifts only (backend fix made
  in this pass — see below), current clocked-in state with a live "since
  HH:MM" readout, pull-to-refresh
- ✅ Clock-in screen: requests real device GPS via `expo-location`,
  submits with an `Idempotency-Key`, surfaces the API's own geofence/
  permission errors instead of a generic failure
- ✅ Clock-out screen: task-category chips, **mandatory** summary text
  (submit button is disabled until non-empty, mirroring the backend's own
  requirement rather than duplicating separate validation logic), optional
  problems-encountered field
- ✅ History screen: past time entries with status badges, worked
  duration, and the submitted daily summary
- ✅ React Navigation native-stack wiring Login → Home → Clock-in/
  Clock-out (modal presentation) → History, gated on `isAuthenticated`

**Backend fix required to make this possible**: `GET /shifts` and
`GET /shifts/:id` previously required `Permission.MANAGE_SHIFTS`, which
only Owner/Field Manager hold — a plain Worker could never fetch their own
assigned shifts through the existing endpoint. Fixed by adding a `scope`
parameter to `ShiftsService.list()`/`getById()` that filters to the
caller's own `workerProfileId` when the caller is a Worker (mirroring the
self-scoping pattern already used by `TimeEntriesService`); the controller
now derives `scope` from the caller's role instead of gating the whole
route behind `MANAGE_SHIFTS`. Verified live: a Worker's token now returns
only their 3 assigned shifts (12 exist org-wide), `GET /shifts/:id` on an
unassigned shift correctly 404s (not a data leak) rather than 403ing, and
a Field Manager's token still returns the full 12-shift org list
unaffected — confirmed via direct `curl` calls against the running API,
and the existing 16-test e2e suite still passes unmodified.

**Verification method and its limit**: this environment has only Xcode
Command Line Tools installed, not full Xcode (`xcrun simctl` /
`xcodebuild` both fail with "requires Xcode"), so the iOS Simulator could
not be used this session — that specific gap needs `xcode-select --switch`
run with the user's own password, which I cannot do myself. Verification
was instead done via (1) `tsc --noEmit` and ESLint both clean across the
whole app, and (2) a real, interactive end-to-end pass through Expo's web
target (`expo start --web`) in the browser tool: logged in as a real
seeded worker over OTP, clocked in (GPS mocked via the browser's
`navigator.geolocation`, since this sandboxed browser has no location
permission to grant — geofence math itself was already covered by
existing backend tests and this session's earlier curl verification),
watched the Home screen flip to "Currently clocked in," clocked out with a
mandatory summary, and confirmed the new entry appeared correctly on the
History screen with `PENDING_APPROVAL` status and the exact submitted
text — all against the real running API, not a mock. `expo-secure-store`
has no web implementation (its web module is an empty stub), so
`session-store.ts`/`device-id.ts` fall back to `AsyncStorage` specifically
on `Platform.OS === "web"`; native builds are unaffected and still use the
real Keychain/Keystore path. This web pass exercises the same
business-logic code paths a native build would (screens, navigation,
`AuthProvider`, the API client), but does not prove the native GPS/
Keychain modules themselves link and run correctly on-device — that
requires either the Simulator (blocked as above) or a physical device.

**Added this pass**: offline queueing is now real (see section 20) —
`ClockInScreen`/`ClockOutScreen` fall back to signing-and-queueing on a
`NetworkError`, `OfflineQueueScreen` (spec 27.10) shows pending/verified/
flagged/rejected events with plain-language explanations and a manual
"Sync now" retry, and `HomeScreen` shows an offline/pending-count banner.
`tsc --noEmit` and ESLint remain clean with the new dependencies
(`tweetnacl`, `expo-crypto`, `@react-native-community/netinfo`), and a real
Metro bundle build for the web target succeeded — see section 20 for what
was and wasn't verified about the on-device UX specifically.

**Still not implemented**: push notification registration, background
location, biometric app-lock, Detox test suite, and iOS/Android
device-attestation calls (see section 19). Every endpoint the mobile app
doesn't yet use is documented via Swagger at `/api/v1/docs`.

## 28. API standards — ✅

REST under `/api/v1`, OpenAPI/Swagger UI live, consistent
`{statusCode, code, message, details, correlationId}` error shape (verified
by tests asserting `.code` on 400/403/409 responses), `Idempotency-Key`
enforced where specified, cursor-based pagination on `/audit-logs`.
🟡 Rate limiting is a single global `@nestjs/throttler` rule (300 req/min),
not per-route-tuned; OTP-specific rate limiting is separate and stricter.

## 29. Database — ✅

39 of the spec's ~39 tables exist (`file_assets`, `push_tokens`,
`outbox_events` remain omitted — tied to the deferred features noted
above; `generated_reports`, and this pass's `device_public_keys`/
`offline_sync_batches`/`offline_sync_events`, were added as real features
landed rather than pre-created speculatively). UUIDv7 primary keys
generated in application code. Every constraint called out in section 29.4
is implemented and verified to actually fire: max-2-owners trigger,
no-overlapping-compensation exclusion constraint, one-active-time-entry
partial unique index, clock-out-after-clock-in check, non-negative-rate
checks, plus this pass's shift-status check (a `CANCELLED`/`CLOSED` shift
can no longer be clocked into, online or offline).

## 30. Background jobs / outbox — 🟡

- ✅ BullMQ (`@nestjs/bullmq`) now genuinely runs against the Redis
  container: a global `QueueModule` registers two repeatable jobs —
  expiring temporary check-in points past their `expiresAt` (60s interval)
  and expiring unused onboarding invitations (5min interval) — verified by
  watching them fire in the API logs against real seeded data.
- ⬜ No transactional outbox table. Notifications and audit writes still
  happen synchronously inside the same request transaction rather than via
  an outbox-and-relay pattern. Documented as a real gap, not silently
  dropped.

## 31. Security — ✅ (core), 🟡 (breadth)

- ✅ Envelope encryption for bank accounts (AES-256-GCM; local key in dev, real AWS KMS client code for production — untested against live AWS)
- ✅ Audit log is an app-level append-only SHA-256 hash chain, verified by both an automated test and a standalone CLI (`pnpm --filter @fieldmaster/api verify-audit`)
- ✅ Financial-isolation tests: Field Manager gets 403 on payroll/dashboard routes; worker list never serializes `compensation` for a Field Manager viewer
- ✅ Helmet, global validation pipe (`whitelist`/`forbidNonWhitelisted`), throttling
- 🟡 Not implemented: malware-scanning integration point, file-size/type validation (no file upload exists yet), explicit brute-force lockout beyond the OTP attempt counter

## 32. Privacy and retention — 🟡

Consent timestamp + privacy-notice version captured at onboarding. Configurable
retention policies, legal-hold flags, and a "export my data" endpoint are
**not implemented**.

## 33. UX / accessibility — ⬜

No UI exists in this slice.

## 34. Testing — 🟡

- ✅ 35 pure-function unit tests (`packages/shared-validation`) covering the 9-hour rule, proration, full-day credit, hourly split, overtime, emergency ±60/+15, forgotten-stamp sequencing, geofence distance, timezone/DST month boundaries, and (added this pass) offline-event canonicalization + genuine Ed25519 sign/verify round-trips including tamper and wrong-key detection
- ✅ 10 unit tests inside the API itself (RBAC permission matrix, time/mock-location validation)
- ✅ 21 integration/e2e tests against a real Postgres+PostGIS database (Supertest + a live Nest app) — the original 16 (OTP login, refresh-token rotation and reuse detection, owner-limit enforcement, suspended-account lockout, financial isolation ×3, geofence rejection with distance detail, full clock-in→summary→approve→minute-split flow, full-day credit, the forgotten-stamp two-strike sequence, DEVICE_FAILURE non-counting, Flexi-Check, payroll calculate→finalize→block-edit→reopen), unaffected by this pass's refactor, plus 5 new offline-sync tests (full round trip with device-timestamp-as-authoritative-time, invalid-signature rejection, unregistered-device rejection, duplicate detection, revoked-key rejection)
- ✅ 9 admin-web tests (Vitest + React Testing Library, added this pass — the app previously had zero test files, which made the root `pnpm test` fail outright): 6 pure-function format tests, 3 tests proving the `OwnerOnly` guard never puts financial content in the DOM for a Field Manager/Worker session
- ⬜ No Testcontainers (tests run against a dedicated `fieldmaster_test` database on the same Docker Postgres instead — see technical-decisions.md), no Playwright/Detox suites (see section 26/27 for what live-browser/bundle verification was done instead)

## 35. Required acceptance scenarios

Of the 14 listed scenarios, automated tests cover: 1 (normal workday), 2
(short day no credit), 3 (short day with credit), 5 (forgotten stamps), 6
(broken phone), 7 (Night Turan emergency math — unit-tested), 8 (geofence
failure), 9 (Flexi-Check), **10 (offline attendance — now covered, see
section 20: signed capture, later sync, server verification, and a
receipt the worker sees, tested both automated and live via `curl` against
the real dev database)**, 12 (financial isolation), 14 (finalized payroll
blocks edits, reopen). Verified manually but not by an automated test: 13
(PDF report — implemented, generated live against seeded data, no
assertion-based test written against the PDF/report endpoints). Not
covered at all: 4 (overtime notification content — implemented, not
asserted in a test), 11 (temporary supervisor full lifecycle — core
mechanics built, not end-to-end tested).

## 36. Seed data — ✅

`prisma/seed.ts` creates: 1 organization, 2 Owners, 2 Field Managers, 12
workers (mixed daily/hourly compensation), 3 projects, 6 sites + geofences,
8 standard shifts + 1 Day Turan + 1 Night Turan, approved/pending/rejected
attendance, a manual full-day-credit example, exactly 3 forgotten-stamp
infractions for one worker (2 free, 1 deducting 1000 agorot — matching the
spec's own worked example), 1 completed emergency call-out with full
compensation breakdown, 1 Temporary Supervisor assignment + an expired
temporary check-in point, 1 finalized payroll period, and a handful of
notifications — all fictional data.

## 37–40. Local dev, CI, deployment, docs — 🟡

- ✅ `docker compose up -d` brings up Postgres+PostGIS, Redis, MinIO with no paid credentials required
- ✅ `pnpm install / db:migrate / db:seed / dev / lint / typecheck / test / test:e2e / build` all work as documented in the root README (`pnpm test` specifically was broken before this pass — see the admin-web note at the top of this document)
- ✅ Production Docker image (`apps/api/Dockerfile`, multi-stage) — genuinely
  builds and boots against the real `fieldmaster` Docker network; a live
  `curl` to `/api/v1/auth/otp/request` inside that container returned 204
  with the OTP visible in `docker logs`. Playwright's Chromium (needed for
  PDF generation) is installed in the image itself, not assumed present.
  A new `GET /api/v1/health` endpoint (added this pass, unauthenticated,
  checks the database connection) backs the ALB target-group health
  checks in the new Terraform ECS module — verified live against a real
  running instance, not just added to satisfy the Terraform config.
- ✅ GitHub Actions CI (`.github/workflows/ci.yml`): 5 jobs —
  lint/typecheck/build, unit tests, migration + integration tests (with
  real Postgres+Redis service containers), Docker image build, and a
  best-effort security scan (`continue-on-error: true`). YAML-validated;
  not yet run against a live GitHub Actions runner in this environment
  (no CI credentials/remote to trigger it against).
- ✅ **Terraform** (added this pass, `infrastructure/terraform/`): networking,
  database (RDS Postgres 17), redis (ElastiCache), storage (S3 + KMS +
  CloudFront), secrets (Secrets Manager containers), and ecs (Fargate
  cluster, ALB, IAM roles, autoscaling) modules, plus dev/staging/production
  environment root modules. Verified this session by installing Terraform
  1.15 via Homebrew and running `terraform init -backend=false` +
  `terraform validate` + `terraform fmt -check` against all three
  environments — all clean, no AWS credentials used or required. **Never
  applied against a real AWS account** — no live infrastructure exists; see
  `docs/deployment.md` for exactly what that means and what a real first
  apply would still need (remote state bootstrap, an admin-web production
  image, which doesn't exist yet either).
- ✅ **Documentation** (added this pass): all 13 previously-missing
  `docs/*.md` files now exist alongside the pre-existing
  `technical-decisions.md` — product-requirements, system-architecture,
  database-design, api, security, authorization-matrix,
  payroll-calculations, offline-sync, geofencing, deployment, testing,
  troubleshooting. Each is grounded in this actual codebase (real file
  paths, real endpoint names, real test names), not generic boilerplate.

## 41. Definition of Done — honest checklist

Done and verified: monorepo, API runs, migrations run, seed loads,
authentication works, RBAC works, owner limit works, financial isolation
tests pass (automated tests, a live browser/web-preview session from an
earlier pass, and this pass's own admin-web component tests), worker
onboarding works (minus document upload), shift scheduling works,
clock-in works, clock-out works, mandatory summary works, geofencing
works, Flexi-Check works, **offline event storage works, offline
synchronization works** (see section 20 — genuine Ed25519 signing,
verified by both automated tests and a live `curl`-based run against the
real dev database), manual correction works, full-day credit works,
forgotten-stamp penalty works, Turan scheduling works, emergency timing
works, approval workflow works, payroll calculations work, payroll
finalization works, notifications work in-app and in real time
(WebSocket + SSE), audit logs work, background jobs run against real
Redis, PDF report generation works end-to-end, lint passes, type checking
passes, unit tests pass (45 total: 35 shared-validation + 10 API), core
mobile end-to-end works (via `tsc`/ESLint + a real Metro bundle build,
not a device/simulator run), integration tests pass (21/21), web
end-to-end tests pass in the sense of admin-web's own component suite
(9/9) — **not** the spec-named Playwright suite, which doesn't exist (see
section 34), production build passes, the production Docker image boots
and serves real traffic including the new health endpoint, GitHub Actions
CI is wired and YAML-valid, Docker development setup works, documentation
is complete (all 14 files), a working admin web app (11 pages) runs
against the live API with financial isolation verified end-to-end, and a
working Expo mobile worker app (login, home, clock-in/out with real GPS,
mandatory summary, history, **offline queue**) runs against the live API.

Not done: real push/SMS/S3 against live provider accounts, a live run of
the CI pipeline against a real GitHub Actions runner, a live Terraform
apply against a real AWS account (the code is written and validated, not
applied — see `docs/deployment.md`), an admin-web production Docker image,
a transactional outbox, device attestation, Playwright/Detox test suites,
and interactive on-device/simulator verification of the mobile app
(blocked by this environment's lack of Xcode and browser-automation
tooling, not by the app itself — see section 27 for what verification was
possible instead).
