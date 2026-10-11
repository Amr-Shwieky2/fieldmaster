# Technical Decisions

Record of choices made where the spec left an implementation detail open,
or where a pragmatic scope cut was necessary to ship a *working, tested*
system rather than a larger pile of unverified code. See
`IMPLEMENTATION_STATUS.md` for the full done/partial/not-started breakdown.

## Scope: backend API core first, then admin web, then PDF/real-time/CI, then mobile

The full spec describes a web admin app, a bare-React-Native mobile app,
Terraform/AWS deployment, PDF generation, offline sync with device-bound
signing, CI, and 14 documentation files — realistically months of work for a
team. Rather than generate a large volume of unexecuted scaffolding across
every layer, this build went deep on one layer at a time, confirmed with
the user at each step, and made sure every piece of business logic each
layer owns is real and either automated-tested or manually verified against
the live running stack rather than just compiled. The order was: (1) the
NestJS API + Postgres/PostGIS database, fully covered by automated tests;
(2) a Next.js admin web app, eventually covering all ten page groups from
spec section 26; (3) the remaining backend gaps — BullMQ background jobs,
Playwright-based PDF reports, WebSocket/SSE real-time notifications, a
production Docker image, and GitHub Actions CI; (4) an Expo mobile worker
app. See the mobile-specific entries below for what's real there and what
isn't.

## Mobile: Expo managed workflow instead of the spec-named "bare React Native workflow"

Section 7.2/27 assume native modules configured through a bare RN project
(raw `ios/`/`android/` folders, manual CocoaPods/Gradle wiring). This
environment has only Xcode Command Line Tools, not full Xcode, so no
native iOS build could be produced or run here regardless of workflow
choice — see the Simulator entry below. Given that constraint, Expo's
managed workflow (`apps/mobile`, SDK 57) was used instead: it still uses
real native modules (`expo-secure-store` for Keychain/Keystore,
`expo-location` for GPS) via Expo's own prebuilt runtime, just without a
locally-generated native project tree. This is a genuine scope narrowing,
not a cosmetic one — a bare workflow would additionally support
custom native modules the spec's deeper sections (device attestation,
mock-location detection at the OS level) would eventually need, which Expo's
managed workflow constrains without ejecting. Documented here rather than
silently swapped in.

## Mobile: no iOS Simulator available in this environment

`xcrun simctl` and `xcodebuild` both fail here with "requires Xcode, but
the active developer directory is a Command Line Tools instance" — only
Xcode Command Line Tools are installed, not full Xcode.app. Fixing this
needs `sudo xcode-select --switch /Applications/Xcode.app`, which needs the
user's own password and Xcode itself to already be installed; neither is
something I can do unattended. Given that, mobile verification this session
used (1) `tsc --noEmit` and ESLint, both clean, and (2) a full interactive
login → clock-in → clock-out → history pass through Expo's web target in
the browser tool, against the real running API — see
`IMPLEMENTATION_STATUS.md` section 27 for exactly what that did and didn't
prove. This is an environment limitation, not a decision to skip
verification.

## Mobile: AsyncStorage fallback for session/device-id storage on web only

`expo-secure-store`'s web implementation (`ExpoSecureStore.web.ts`) is an
empty stub — it has no Keychain equivalent in a browser, so calling it on
web throws `getValueWithKeyAsync is not a function`. Since the web target
is used here purely as an iOS-Simulator stand-in (see above), not as a
real shipped platform, `session-store.ts` and `device-id.ts` branch on
`Platform.OS === "web"` and use `@react-native-async-storage/async-storage`
(already a dependency, for other reasons) only in that case. Native builds
(iOS/Android) always take the `expo-secure-store` path — the real Keychain/
Keystore storage the spec asks for is unaffected by this fallback existing.

## Mobile clock-in/out: no offline queue

The mobile app always submits clock events live; there is no local queue
for when the device has no connectivity. This mirrors the backend's own
scope cut (section 20 — no `/offline-sync` endpoint, no
`offline_sync_batches` tables exist either), so building a client-side
queue with nothing on the server to eventually replay it into would have
been dead code. The `EventOrigin.OFFLINE` enum value exists end-to-end in
the schema and clock-event handling for a future pass to build against.

## PDF reports: hash the source data, not the rendered PDF bytes

`ReportsService.generateWorkerAttendanceLedger()` embeds a SHA-256 hash in
the PDF's own footer, intended as a tamper-evidence check. Hashing the
*rendered PDF bytes* is circular — the hash would have to be computed after
rendering, then the PDF re-rendered to include it, changing the bytes again.
Instead, the hash is computed over the *source data* (the fetched time
entries, corrections, approvals, and computed compensation, serialized
deterministically) before rendering, and only that hash — not the PDF
itself — goes into the template. A verifier re-fetches the same source
data, recomputes the hash, and compares; they don't need the PDF bytes at
all for that check.

## Real-time notifications: EventEmitter as the bridge, not a shared Redis pub/sub

`NotificationsService.notify()` still writes to Postgres first (the
durable, spec-required record), then emits a `@nestjs/event-emitter` event
in the same process. Both the Socket.io gateway and the SSE endpoint
subscribe to that same in-process event rather than a separate Redis
pub/sub channel. This is correct for the single-API-instance topology this
slice runs (Docker Compose, one container), but would need to move to
Redis pub/sub (or BullMQ's own event bridge, since Redis is already a
dependency) before running multiple API replicas behind a load balancer —
otherwise a client connected to instance A would never see a notification
generated by instance B. Noted here as a real scaling limit, not silently
glossed over.

## Docker production image: shared `base` stage must install OpenSSL before `prisma generate`

Prisma's query-engine binary is compiled against a specific OpenSSL
version, auto-detected from the environment `prisma generate` runs in. The
first version of `apps/api/Dockerfile` installed `openssl` only in the
final `runtime` stage; `prisma generate` ran earlier, in `build`, without
it, silently guessing the wrong engine target
(`linux-arm64-openssl-1.1.x`) and crashing at boot in `runtime`
(`linux-arm64-openssl-3.0.x`) with `PrismaClientInitializationError`. Fixed
by moving the `apt-get install openssl` step into a shared `base` stage
that both `build` and `runtime` inherit from, so the engine is generated
against the same OpenSSL version it will actually run against.

## Admin web map editor: Leaflet + OpenStreetMap instead of the spec-named Google Maps JS SDK

Section 17 names Google Maps specifically. That requires a billing-enabled
Google Cloud project and an API key, neither available in this
environment. `apps/admin-web/src/components/geofence-map-picker.tsx` uses
Leaflet + `react-leaflet` against OpenStreetMap tiles instead — no API key,
no billing account, same interaction model (click to place, drag to move,
draggable radius). Swapping the tile provider and marker library back to
Google Maps later is a component-level change, not an architectural one;
the lat/lng/radius data model underneath is provider-agnostic already.

## Admin web: hand-rolled UI primitives instead of the shadcn/ui CLI

The spec names shadcn/ui specifically. Its CLI generator is interactive
(prompts for base color, CSS variables, etc.) and isn't practical to drive
non-interactively in this environment. `apps/admin-web/src/components/ui/`
instead hand-writes the same handful of primitives (Button, Card, Input,
Select, Badge, loading/empty/error states) directly in Tailwind, styled to
the same visual conventions shadcn/ui uses. Functionally equivalent for
this slice's needs; swapping in the real generated components later is a
drop-in replacement, not a rewrite.

## Admin web: tokens in localStorage, not an httpOnly cookie + CSRF pair

Spec section 7.2 calls for the admin web app to hold its refresh token in
an httpOnly, same-site cookie with CSRF protection, which requires a
backend-for-frontend (BFF) proxy layer between the browser and the API (so
the browser never handles the token directly). That proxy doesn't exist in
this slice. `apps/admin-web/src/lib/session-store.ts` keeps both tokens in
`localStorage` instead, documented inline at the point of use. The API's
own refresh-token rotation and reuse-detection (tested) remain the real
security boundary regardless of where the browser stores the token;
access tokens are short-lived (15 min) to bound the exposure window.

## Enums as `as const` objects, not TypeScript `enum`

Prisma generates its own enum types as `const` objects with a derived
string-literal-union type (`(typeof X)[keyof typeof X]`), not TypeScript
`enum`. A TS `enum` member's type is nominal and is **not** structurally
assignable to Prisma's generated type even when the runtime string values
match — this would have caused type errors at every Prisma call site.
`packages/shared-types` mirrors Prisma's own pattern instead, so
`OrgRole.OWNER` etc. behave exactly like enum access everywhere but stay
interchangeable with `@prisma/client`'s generated types.

## UUIDv7 generated in application code, not the database

Postgres has no native `uuidv7()` function. IDs are generated with the
`uuid` npm package's `v7()` in a single `generateId()` helper
(`src/common/ids.ts`), called before every `create()`. This also makes IDs
available before the DB round-trip completes, which several services rely
on (e.g. linking a `ManualTimeCorrection` to a `ForgottenStampInfraction`
created in the same transaction).

## PostGIS geofencing without a Prisma `geography` column

Prisma has no first-class PostGIS type. Rather than modeling geofence
centers as `Unsupported("geography(Point,4326)")` columns (which would
block ordinary Prisma reads/writes on that model), geofences store plain
`Float` latitude/longitude columns, and the authoritative distance/contain
check (`GeofenceValidationService`) runs a raw parameterized
`$queryRaw` using `ST_DWithin`/`ST_Distance` cast to `geography` at query
time. `packages/shared-validation`'s haversine function is a pure,
unit-testable mirror of the same math for fast tests that don't need a
database.

## Payroll adjustments exist independently of a PayrollItem

The forgotten-stamp rule can create a deduction on any day of an open
month, before that month has ever been calculated. Making
`PayrollAdjustment.payrollItemId` required would have forced either (a)
silently calculating a phantom PayrollItem the moment the 3rd infraction
happens, or (b) deferring the deduction until month-end, contradicting the
spec's "beginning with sequence number three" wording. Instead
`payrollItemId` is nullable; adjustments carry `organizationId` +
`workerProfileId` + `businessMonth` directly, and
`PayrollCalculationService.calculate()` links (sets `payrollItemId` on) any
unlinked adjustment for that worker/month the first time the period is
calculated.

## Payroll "reopen" versions in place rather than a full row-per-version model

Section 23.4 asks for "a new version" on reopen. A fully faithful
implementation would create an entirely new `PayrollPeriod` row per version
with its own duplicated `PayrollItem` set, preserving old versions
byte-for-byte. Given time constraints, `reopen()` instead increments the
`version` field on the existing row and flips its status to `REOPENED`; the
next `calculate()` overwrites that period's items in place. The
`PayrollCalculationSnapshot` table does still capture a JSON snapshot of
inputs/results on every calculation, so historical figures aren't
completely unrecoverable, but they are not preserved as cleanly as a true
append-only version chain would provide. A production hardening pass should
revisit this before relying on it for real payroll audits.

## Manual emergency authorization = manager-initiated call-out, not a separate table

Section 16 allows an emergency shift to start either from an active Night
Turan assignment or "manual manager authorization." Rather than adding a
new time-boxed authorization-grant table (another moving part), a manager
can call `POST /emergency-callouts/start` with an explicit `workerProfileId`
on the worker's behalf — that act of management-initiated creation *is* the
authorization, recorded as `authorizationSource: MANUAL_MANAGER_AUTHORIZATION`
with `authorizedBy` set to the manager. This satisfies the requirement
without a table whose only purpose would be to record "yes, a manager said
this was okay" a second time.

## Onboarding invitation does not collect a government ID number or document image

The onboarding redemption endpoint collects `governmentIdType` (a category)
but not the ID number or a scanned image. Full support requires a file
upload pipeline (private S3/MinIO storage, signed URLs, encrypted-at-rest
document numbers) that doesn't exist yet in this slice — see
`IMPLEMENTATION_STATUS.md` section 8. Encrypted bank account details *are*
fully implemented, since they don't require a file-upload subsystem, and
demonstrate the same `EncryptionService` a document-number field would use.

## Local encryption key format

`EncryptionService` requires `LOCAL_ENCRYPTION_KEY_BASE64` to decode to
exactly 32 bytes (AES-256). The `.env.example` value is a real, randomly
generated 32-byte key — rotate it before using this scaffold for anything
beyond local development.

## Tests run against a dedicated Postgres database, not Testcontainers

`apps/api/test/*.e2e-spec.ts` runs against a `fieldmaster_test` database on
the same Docker Compose Postgres instance (created once, migrated once),
truncated between test files via `resetDatabase()`. This was chosen over
Testcontainers to avoid Docker-in-Docker complexity and slow per-suite
container startup in this environment; it is a reasonable trade-off for a
single-developer/CI-runner setup but means tests cannot run without the
Postgres container already up (`docker compose up -d`).

## Deterministic OTP for tests

`ConsoleOtpProvider` reads `process.env.FIELDMASTER_TEST_OTP` and uses that
fixed code instead of a random one when set. This is **only** ever set by
`test/env.setup.js`; it is never set in `.env`/`.env.example`, so normal dev
and production behavior (random code, printed/sent) is unaffected.

## Host port 5432 conflict

This machine had a native (non-Docker) Postgres already listening on
`127.0.0.1:5432`. `docker-compose.yml` maps the Postgres container to host
port **5433** instead of the default 5432 to avoid silently connecting to
the wrong database. If your machine doesn't have this conflict, feel free
to change it back — just update `DATABASE_URL` in `.env` to match.

## Offline sync: tweetnacl (pure-JS Ed25519) instead of native/platform crypto

Section 20.2 implies a hardware-backed key (Secure Enclave/StrongBox via
Android Keystore/iOS Keychain asymmetric key generation). That's only
reachable from a bare React Native project with a custom native module
(or a library wrapping one) — not available in this build's Expo managed
workflow (see the mobile-workflow entry above, which was already a
deliberate trade-off before this feature existed). `tweetnacl` was chosen
instead because it's pure JavaScript with no native dependency, so the
*exact same signing/verification code* runs on the API (Node), the mobile
app (Hermes/React Native), and Jest tests — eliminating an entire class of
"the two platforms implemented the primitive slightly differently" bugs.
The private key itself still lives in Keychain/Keystore via
`expo-secure-store` (real hardware-backed storage on native builds), so
the key's *storage* is as secure as the rest of this app's session
tokens — only its *generation* isn't Secure-Enclave-native. Documented as
a real, bounded scope narrowing, not silently substituted.

## Offline sync: canonicalization must be reconstructed identically on both sides

Documented in detail in `docs/offline-sync.md`, referenced here because it
is the single most important lesson from building this feature: the
server-side signature-verification code originally reconstructed the
signable payload with `field ?? null` for every optional field, while the
mobile signing code simply omitted absent fields. Both represent "the same
event" but produce different canonical JSON strings, so **every signature
failed verification** until this was caught by the integration test suite
and fixed. The rule going forward: never default an absent optional field
on either side of a sign/verify boundary — pass it through as `undefined`
and let `canonicalizeOfflineEvent` drop it consistently on both sides.

## Offline sync: AsyncStorage for the mobile queue, not encrypted SQLite

Section 20.1 asks for "encrypted local SQLite storage." `expo-sqlite` is
available in this Expo SDK, but true encryption-at-rest (SQLCipher) needs
a custom native build this managed-workflow/no-Xcode environment can't
produce or verify, and `expo-sqlite`'s web backend (the only target
actually reachable for interactive verification here — see the Simulator
entry above) needs cross-origin-isolation headers this session's tooling
doesn't provide. `apps/mobile/src/lib/offline-queue.ts` uses
`@react-native-async-storage/async-storage` instead (already a
dependency, works identically on web and native, guaranteed verifiable in
this environment). The security property the spec actually cares about —
that a queued event can't be forged or silently altered before it syncs —
comes from the Ed25519 signature over the event's contents, which is
independent of the storage engine underneath it; an attacker who edits the
raw AsyncStorage file still can't produce a valid signature for the
tampered content without the private key.

## Offline sync: reused `clockInCore`/`clockOutCore` rather than a parallel rule engine

`ClockEventsService.clockIn()`/`clockOut()` were refactored to extract
their full rule set (assignment check, conflict check, time/mock-location
validation, geofence check, DB writes, audit, notifications) into
`clockInCore()`/`clockOutCore()`, called both by the online controller
(wrapped in request-level idempotency) and by `OfflineSyncService` (which
has its own batch-level idempotency plus the `[deviceId, clientEventId]`
DB constraint for duplicate detection, so it deliberately doesn't wrap a
second time). The alternative — writing separate offline-specific
validation logic — would have meant every future rule change (a new
geofence edge case, a new conflict type) needing to be implemented and
tested twice, with a high chance of the two paths silently drifting apart.
The one behavioral difference between the two call sites is intentional
and isolated to a single `origin === EventOrigin.OFFLINE` branch inside
`clockInCore`/`clockOutCore` itself: which timestamp is authoritative for
the resulting `TimeEntry` (device time for offline, server-received time
for online) — see `docs/offline-sync.md`.

## Offline sync: a real `GET /health` endpoint, added to support Terraform's ALB health check

No health-check endpoint existed before this pass. The new Terraform ECS
module needs one for its ALB target groups (AWS requires a real HTTP
health check, not just a TCP port check, for meaningful rolling
deployments). Rather than pointing the target group at an arbitrary
existing authenticated route (which would need faking credentials, or
would 401 and read as "unhealthy" to the ALB even when the app is fine),
added a minimal, genuinely useful `HealthController` — public (no auth),
checks the database connection with `SELECT 1`, used by both the ALB and
local `docker compose` smoke-testing. Verified live against a real running
instance and a real Postgres connection, not just added to make the
Terraform config reference something that exists on paper.

## Terraform: written and validated, never applied

`infrastructure/terraform/` is real, syntactically valid HCL —
`terraform validate` and `terraform fmt -check` both pass cleanly across
all three environments (verified this session by installing Terraform 1.15
via Homebrew; no AWS credentials were used or needed for that). It has
never been applied against a real AWS account, and no live infrastructure
exists. This is a meaningful distinction worth stating plainly: a
`terraform validate` pass only proves the HCL is syntactically correct and
internally consistent (references resolve, types match); it does not prove
the AWS API will accept every resource configuration, that IAM policies
are sufficient in practice, or that the ECS services will actually reach a
steady state. Treat this as a well-structured starting point, not a
proven deployment. See `docs/deployment.md` for what a real first apply
would still need (remote state bootstrap, an admin-web production Docker
image — which doesn't exist yet either, since only `apps/api`'s
Dockerfile was built).

## Vitest + jsdom + Node 22: two environment quirks fixed to make admin-web's test suite pass

Adding `apps/admin-web`'s first tests (it previously had zero, which made
the root `pnpm test` fail outright with "No test files found") surfaced
two unrelated environment issues, not application bugs:

1. Node 22+ ships an experimental global `localStorage` that throws/warns
   without a `--localstorage-file` flag, and in this Vitest+jsdom+Node
   combination it was found to shadow jsdom's own `Storage` implementation
   on `window` rather than jsdom's polyfill taking precedence. Fixed with
   a `vitest.setup.ts` that installs a small in-memory `Storage` polyfill
   onto both `globalThis` and `window` before any test runs.
2. `apps/admin-web`'s `tsconfig.json` sets `"jsx": "preserve"` (what
   Next.js's own compiler expects), but Vitest transforms `.tsx` through
   esbuild directly, which needs an explicit JSX mode and doesn't inherit
   Next's setting. Fixed with `esbuild: { jsx: "automatic" }` in
   `vitest.config.ts`.

Neither fix touches the application code itself — both are confined to
`apps/admin-web/vitest.config.ts`/`vitest.setup.ts`.

## Postgres/PostGIS image choice

`postgis/postgis`'s official images only publish `linux/amd64` manifests.
On Apple Silicon (arm64) hosts, `docker compose up` would otherwise either
fail outright or run under slow QEMU emulation. `docker-compose.yml` uses
`ghcr.io/baosystems/postgis`, a maintained multi-arch (amd64 + arm64) build
of the same PostGIS version, so the stack runs natively on both
architectures.

## Test login (Step 1): APP_ENV + DEV_LOGIN_ENABLED instead of overloading NODE_ENV

Manual testing previously meant copying the random OTP from the API console.
Step 1 added a development login mode without removing the real OTP flow:

- **Separate `APP_ENV` from `NODE_ENV`.** `NODE_ENV` says how the code was
  built; a staging deployment on Render or ECS runs a production build
  (`NODE_ENV=production`). `APP_ENV` (`development` | `staging` |
  `production`) says what kind of deployment it is. When `APP_ENV` is unset it
  follows `NODE_ENV`, so existing deployments keep behaving as production.
- **One resolver, validated at boot.** `resolveAppEnvironment()`
  (`apps/api/src/common/config/app-environment.ts`) parses `APP_ENV`,
  `DEV_LOGIN_ENABLED` and the optional `OTP_PROVIDER`. It throws on unknown
  values and on `APP_ENV=production` + `DEV_LOGIN_ENABLED=true`. `main.ts`
  calls it before creating the Nest app and exits with a clear message.
  `AppConfigModule` also calls it, so a test app built from `AppModule`
  can't boot in that state either. Both are covered by tests, including one
  that spawns the real entrypoint.
- **Fixed code via a provider, not a special case in the controller.**
  `DevFixedCodeOtpProvider` issues `123456` and verification goes through the
  same local-hash path as the console provider. `ConsoleOtpProvider` and
  `TwilioVerifyProvider` are unchanged. A challenge created by the fixed-code
  provider is only redeemable while dev login is on, so a challenge left over
  from a dev-mode run can't be used after restarting with dev login off.
- **Quick login shares the OTP session code path.** OTP verification and
  `POST /auth/dev/login` both call `AuthService.startSession()` (device upsert,
  refresh-token family, access token). Dev login records a `DEV_LOGIN` event in
  the hash-chained audit log. Permissions are untouched: an e2e test discovers
  every route guarded by a financial permission from Nest's route metadata
  and asserts that a dev-login Field Manager gets 403 on all of them.
- **404 when off, and the UI asks the API.** `DevLoginEnabledGuard` answers
  exactly like an unknown route (`Cannot GET /api/v1/auth/dev/users`). The web
  and mobile login screens call that endpoint and show the banner, the
  quick-login list and the `123456` hint only when it returns 200. There is no
  separate frontend flag that could drift from the API's real state.
- **Test-mode sessions end when dev login is turned off.** Each
  refresh-token family records how the session started (`origin`: `OTP` |
  `DEV_LOGIN` | `DEV_FIXED_OTP`) and every access token carries the same
  `loginMethod` claim. With dev login off, `JwtAuthGuard`, the notifications
  WebSocket gateway and the SSE stream reject test-mode access tokens, and
  `refresh()` revokes test-mode families (`DEV_LOGIN_DISABLED`). Without this,
  flipping a test deployment to production would have left quick-login
  sessions valid for up to 30 days. Data or members created during a test
  window can't be detected automatically, so the deployment docs require a
  wiped database and rotated JWT secrets before real use. The adversarial
  review of this step found this.
- **In dev login mode the OTP provider is always the fixed-code one.**
  `OTP_PROVIDER=console`/`twilio` combined with `DEV_LOGIN_ENABLED=true` is a
  boot error. Otherwise the login screens would promise `123456` while a real
  provider rejected it.
- **The admin web clears the React Query cache on every login and logout.**
  Query keys are not per user. Quick-switching from an Owner to a Field Manager
  would otherwise briefly show the Field Manager the Owner's cached responses,
  such as worker compensation the API never sends to Field Managers.
- **Terraform and Render ship with dev login off.** The ECS task definitions
  now set `APP_ENV` explicitly. They previously set only `NODE_ENV=staging`/`dev`,
  which would have been read as `development`. A Render test deployment can
  be switched to `staging` + `true` by hand. The docs warn that anyone who can
  reach such a deployment can sign in as any member.

## Admin web: read the session after mount (hydration fix)

Found during Step 1 verification: every authenticated admin-web page logged
"Hydration failed because the server rendered HTML didn't match the client".
`AuthProvider` initialised its state from `localStorage` during render, which
is `null` on the server and the stored session in the browser. The session is
now loaded in `useEffect` and exposed with `isReady`. Redirect guards wait for
`isReady`; otherwise they would redirect a logged-in user to `/login` during
the first client render. Regression test:
`apps/admin-web/src/lib/__tests__/auth-context.test.tsx`.

## Turborepo strict env mode: dev servers get PORT / NEXT_PUBLIC_API_URL / APP_ENV / DEV_LOGIN_ENABLED

Turborepo 2 runs tasks in strict env mode: shell variables not declared in
`turbo.json` never reach the task. This made it impossible to run
`pnpm dev` on another port when 3000 was taken (it was, by an unrelated app,
on the verification machine). The `dev` task now declares
`passThroughEnv: [PORT, NEXT_PUBLIC_API_URL, CORS_ORIGINS, APP_ENV, DEV_LOGIN_ENABLED]`.
It's pass-through rather than hashed `env` because `dev` isn't cached anyway.

## Step 2: Arabic (default) + English with full RTL in the admin web app

> **Superseded in part (2026-10-07):** English was removed and the admin web
> is now Arabic only. See "Admin web is Arabic only" below. The cookie,
> switcher, `useAppLocale` and en.json details in this entry are historical.

- **next-intl in cookie mode, no locale in the URL.** The language lives in the
  `fm_locale` cookie (`ar` | `en`; anything else, including Hebrew, falls back
  to Arabic). The root layout is a server component that reads the cookie and
  renders `<html lang dir>` itself, so the first HTML byte is already
  right-to-left for Arabic. Nothing on the client rewrites those attributes,
  which keeps the Step 1 hydration fix intact. Switching language writes the
  cookie and calls `router.refresh()`; the server tree re-renders with the new
  attributes and messages, without a full reload. A unit test renders the
  layout on the "server" for no cookie / `ar` / `en` / `he`, and the running
  app was checked with `curl` for both cookies.
- **Western digits everywhere via `-u-nu-latn`.** All `Intl` formatting uses
  `ar-u-nu-latn` / `en-u-nu-latn`. next-intl itself also runs with those tags
  (`src/i18n/request.ts`), because ICU formats numbers inside messages with the
  provider locale, and some engines give Arabic-Indic digits for bare `ar`.
  Code that needs the bare `"ar" | "en"` uses `useAppLocale()`, which strips
  the extension. Dates are Gregorian and always in `Asia/Jerusalem`. Arabic
  dates spell the month out (`15 يناير 2026 في 10:30`), because a numeric
  date with RTL marks reads poorly. Money is integer agorot formatted with
  integer arithmetic as `₪ 1,234.50` in both languages.
- **Bidi isolation for left-to-right values.** Money, phone numbers, ids,
  codes and times inside Arabic text are wrapped in `<bdi dir="ltr">`
  (`src/components/formatted.tsx`). Otherwise the browser reorders
  `+972500000001` into `972500000001+` in an RTL paragraph.
- **Logical CSS only, enforced.** Tailwind 3.4 already has `ms/me`, `ps/pe`,
  `start/end`, `text-start/end`, `border-s/e`, `rounded-s/e` and the `rtl:`
  variant, so the Tailwind v4 / shadcn migration from the parked branch was
  not needed and was not brought over. `scripts/check-i18n.mjs` fails on
  physical `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/... classes
  (a line can opt out with an `rtl-ok` comment for genuinely physical cases).
  Directional icons are SVGs that mirror with `rtl:-scale-x-100`. The Leaflet
  map keeps `dir="ltr"` internally (its layout is physical); its zoom and
  attribution controls move to the RTL-appropriate corners.
- **API errors are translated by code, with details.** `getErrorMessage` maps
  `body.code` to `errors.<CODE>` and fills in API `details` where the message
  needs them (geofence distance and allowed radius, GPS accuracy, device clock
  drift). If details are missing it uses `errors.<CODE>_NO_DETAILS`. For a
  code the frontend doesn't know yet it shows the API's own message rather
  than hiding what went wrong.
- **Checks that keep it complete.** `pnpm lint` (and so CI) runs
  `scripts/check-i18n.mjs`. It checks that `ar.json` and `en.json` have
  identical keys and ICU placeholders, that every `t("key")` used in `src/`
  exists, that the mandatory glossary terms are exact, that there are no
  Hebrew characters or Arabic-Indic digits, and that no physical-direction
  classes remain. ESLint's `i18next/no-literal-string` (JSX text plus
  `placeholder`/`title`/`alt`/`aria-label`/`label`) blocks new hard-coded
  text. A unit test fails if any value of any shared enum lacks an Arabic or
  English label.
- **What was reused from `wip/phase1-arabic-rtl`.** Ported and adapted to
  Tailwind 3 and the existing UI kit:
  - the locale config, request config, client-side locale switch and
    `useAppLocale`;
  - the enum-label module and its messages;
  - the `common`/`states`/`errors`/`enums`/`units`/`language` translations;
  - the error-code mapping (now with details and API-message fallback);
  - the formatted-value components and the test helper `render-with-intl`.

  Rewritten rather than ported: the formatting module (now plain `Intl` with
  `-u-nu-latn`, as required) and the i18n check script (adds the
  used-key, glossary and physical-class checks).

  Left on the branch, out of scope: the Tailwind v4 upgrade, the shadcn/ui
  migration, the design-tokens package, the Pino/health/users-me API changes,
  Husky/Prettier/lint-staged, the Docker Mailpit/MinIO changes and the
  language-preference API. The branch itself is untouched.

## Step 2: notifications are rendered on the client from type + data

The API stored notifications only as English `title`/`body` text, and
`data_json` was empty for almost every type, so the Arabic UI had nothing to
translate. Translating the stored English sentences was rejected (fragile, and
it would lose names, times and amounts). This step instead made one small,
additive API change:

- Every `notify()` call site now also writes **raw values** to `data_json`:
  ISO instants, `YYYY-MM-DD` business dates, `YYYY-MM` months, whole minutes,
  counts, enum values and names, never pre-formatted text. The English
  `title`/`body` are unchanged; the mobile app still reads them until Step 3.
  No migration was needed; the column already existed.
- The admin web renders `notifications.types.<TYPE>.title/body` (or
  `bodyWithCost`) from that data (`src/lib/notification-text.ts`). It formats
  dates, durations and money itself, so digits are Western and money is
  `₪ 1,234.50`. Rows from before this change have no data and show the
  generic `fallbackBody`; the admin web never shows the stored English text.
- **Financial isolation.** Money appears in `data_json` only as integer agorot
  under keys ending in `Agorot`, and only in an Owner recipient's row (cost
  estimates on clock-out and emergency end). `NotificationsService.notify()`
  also strips every `*Agorot` key unless the recipient is an active,
  non-archived Owner of the organization, as a backstop. An e2e test
  (`apps/api/test/notifications.e2e-spec.ts`) checks that a Field Manager's
  rows never contain a money field.

Data per type:

| Type | Fields |
|---|---|
| `WORKER_CLOCKED_IN` | timeEntryId, shiftId, shiftTitle, workerProfileId, workerName, clockInAt |
| `WORKER_CLOCKED_OUT` | the above with clockOutAt, durationMinutes, regularMinutes, overtimeMinutes; Owners also get `estimatedCostAgorot` when the worker has a compensation profile |
| `EMERGENCY_SHIFT_STARTED` | timeEntryId, calloutId, workerProfileId, workerName, startedAt, compensatedStartAt, authorizationSource |
| `EMERGENCY_SHIFT_ENDED` | timeEntryId, calloutId, workerProfileId, workerName, endedAt, compensatedDurationMinutes; Owners also get `estimatedCostAgorot` |
| `SHIFT_APPROVED` | timeEntryId, shiftId, shiftTitle, businessDate, approvedRegularMinutes, approvedOvertimeMinutes |
| `SHIFT_REJECTED` | timeEntryId, shiftId, shiftTitle, businessDate, reason (the manager's free text, shown as written) |
| `ONBOARDING_SUBMITTED` | workerProfileId, workerName |
| `WORKER_APPROVED` | workerProfileId (compensation is deliberately not included) |
| `TURAN_ASSIGNMENT_CREATED` | assignmentKind `TURAN` (turanAssignmentId, turanType, startAt, endAt) or `SHIFT` (shiftId, shiftTitle, startAt, endAt): shift assignments reuse this type |
| `TURAN_ASSIGNMENT_CHANGED` | change `CANCELLED`, turanAssignmentId, turanType, startAt, endAt |
| `OFFLINE_EVENT_REJECTED` / `SUSPICIOUS_LOCATION_DETECTED` | workerProfileId, workerName, flaggedCount, rejectedCount |
| `PAYROLL_FINALIZED` (seed) | yearMonth |
| `SHIFT_AWAITING_APPROVAL` (seed) | timeEntryId, shiftId, shiftTitle, workerProfileId, workerName, clockOutAt, durationMinutes |

`OVERTIME_THRESHOLD_CROSSED`, `TEMPORARY_CHECK_IN_POINT_OPENED` and
`OFFLINE_EVENT_SYNCED` have no producer yet. Their translations expect
shiftTitle and workerName, plus syncedCount for the last one. Arabic
notification text uses a short sentence followed by "label: value" lines
(e.g. `ساعات إضافية: 1 س 30 د`), which keeps the grammar correct for any
inserted value.

## Admin web is Arabic only (English removed, 2026-10-07)

After Step 2 shipped Arabic + English, the product owner decided the admin web
should work **only in Arabic**. English was removed rather than hidden:

- **No language choice.** `en.json`, the العربية/English switcher, the
  `fm_locale` cookie handling and `useAppLocale` are gone. `src/i18n/config.ts`
  only exports `APP_LOCALE = "ar"`, `APP_DIRECTION = "rtl"`,
  `INTL_LOCALE = "ar-u-nu-latn"` and the business time zone. The root layout
  renders `<html lang="ar" dir="rtl">` without reading cookies or headers, so
  no page depends on request state for its language. A stale `fm_locale=en`
  cookie in someone's browser is simply ignored.
- **Text stays in `ar.json`.** It would have been possible to inline Arabic
  strings into the components, but keeping next-intl with a single locale
  keeps the glossary check, the used-key check, ICU plurals and the
  "no hard-coded text" ESLint rule. A future language would be a new file
  plus a switch again, not a rewrite.
- **The API's English `message` is never shown.** Before, an error code the
  web didn't know fell back to the API's English message. Now it falls back
  to the Arabic message for its HTTP status (400, 401, 403, 404, 409, 429,
  503, 5xx), else a generic Arabic error. To keep that fallback rare,
  `scripts/check-i18n.mjs` now reads the API source (`ErrorCodes`, string
  codes passed to `AppException`, and the codes the exception filter assigns)
  and fails `pnpm lint` when any of them has no `errors.<CODE>` message.
- **Checks rewritten for one language.** The ar/en parity check is gone.
  `check-i18n.mjs` now also fails when:
  - a file other than `ar.json` appears in `src/i18n/messages`;
  - a message's visible text has Latin letters and no Arabic letter, i.e. an
    English leftover (the brand "FieldMaster" is allow-listed, and Arabic
    with an embedded code such as SMS/API/GPS is fine).
- **Unchanged:** the notification `data_json` design (the API still stores the
  English `title`/`body`, which the mobile app reads); RTL rules; formatting
  (Western digits, Asia/Jerusalem, `₪ 1,234.50`); the glossary.
- **Also fixed while removing English:**
  - The map credit is now Arabic and includes the Leaflet credit; Leaflet's
    default prefix, which has an English tooltip, is off.
  - The login fields are checked by the app (`noValidate`), so empty fields
    get an Arabic message instead of the browser's own bubble.
  - A `global-error.tsx` renders an Arabic page if the root layout itself
    fails.
  - An enum value without a label shows its raw code instead of made-up
    English.
  - The fixed English reasons the web used to send (for example "Weather
    stopped work") are shown with today's Arabic wording in the audit log.
  - The emergency placeholder title is shown as "استدعاء طوارئ" inside
    notifications too.
- **Known gaps, out of scope:**
  - The mobile app is still English-only (its translation was planned as
    Step 3).
  - The Worker Attendance Ledger PDF generated by the API is still English
    (PDF reports were left for a later step).
  - Seed data (names, shift titles, site names) stays as is: it is demo
    data, not interface text.
  - Native `date`/`datetime-local` pickers use the browser's own language
    and cannot be forced to Arabic without a custom picker.

## Step 3: one shared i18n package (`@fieldmaster/i18n`) for the admin web and the mobile app

Step 3 makes the mobile app Arabic only too. Copying the admin web's
translations and helpers would have meant two error-code maps, two glossaries
and two formatters drifting apart, so the parts both apps need moved to
`packages/i18n`:

- **Messages:** `src/messages/ar.json` holds:
  - `common` (including the glossary terms), `states` and `units`;
  - `errors`, with one message per API error code;
  - `enums`, with a label for every shared-types enum value;
  - `auth` (the login form) and `devLogin` (test-mode banner and quick login).

  Each app keeps only its own screens' text in its own
  `src/i18n/messages/ar.json` and deep-merges it with `mergeMessages`. The
  apps' checks fail if an app redefines a shared key, so a wording change is
  made once.
- **Code (pure TypeScript, no React):**
  - formatting (`format.ts`);
  - API error → Arabic message (`getErrorMessage`, plus `getCodeMessage` for
    a bare code such as an offline-sync rejection reason);
  - enum labels (`getEnumLabel`) and the emergency placeholder title;
  - the locale constants.

  Each app wraps these in small hooks bound to its own translator: next-intl
  on the web; use-intl, next-intl's core and the same ICU message format, on
  mobile.
- **Checks:**
  - `scripts/i18n-check.mjs` is the checker library both apps' `lint`
    scripts use. It adds a React Native style check, `physicalStyleProblems`,
    next to the Tailwind class check.
  - The package's own `lint` checks the shared file: Arabic only, glossary,
    and every API error code translated.
- **Formatting is now engine-independent.** The admin web formatted with
  `Intl` in `ar-u-nu-latn`. That is not safe on Hermes, whose locale data and
  numbering-system support differ between iOS and Android. The shared
  formatter never asks `Intl` for Arabic text:
  - month names come from a fixed table;
  - `Intl` is only used, in `en-US`, to read the Asia/Jerusalem date/time
    parts;
  - that use is self-checked once against two known instants, and an engine
    that fails falls back to Israel's DST rules computed in code (a unit test
    proves the rules match `Intl` for every hour of 2024-2030);
  - any Arabic-Indic digit is converted to 0-9 as a last safety net.

  The admin web's output is unchanged (same strings in its tests).
- **One wording change:** the geofence error now reads "أنت خارج نطاق
  الموقع. المسافة: 184 م، المسموح: 100 م." in both apps, the format the
  product owner asked for.
- **Not shared (yet):** the notification renderer stays in the admin web,
  because the mobile app has no notifications screen. It can move to the
  package when one is added.
- **Package shape:** like `@fieldmaster/api-client`, the package exports its
  TypeScript source, so there is no build step:
  - Next.js compiles it via `transpilePackages`;
  - Metro, Vitest and Jest compile it directly.

## Step 3: RTL on mobile (Expo SDK 57): Expo Go vs development/production builds vs web

The mobile app is Arabic only and always right-to-left. React Native can only
switch layout direction when the app starts, and the three places the app runs
do it differently. Each setting below exists for one of them.

| Where | What makes it RTL | When it applies |
|---|---|---|
| **Expo Go** (your phone, `pnpm --filter @fieldmaster/mobile start`) | `app.json` → `expo.extra.supportsRTL` + `expo.extra.forcesRTL` | Expo Go reads these from the project manifest every time the project opens and sets RTL before React starts. JS `I18nManager.forceRTL()` does not work there; Expo Go overwrites it on the next load. |
| **Development build / production (EAS Build, `expo prebuild`)** | `app.json` → `plugins: [["expo-localization", { "supportsRTL": true, "forcesRTL": true, "supportedLocales": ["ar"] }]]` | Written into the native project at build time (iOS Info.plist, Android strings.xml; the Android manifest already has `supportsRtl="true"`). The expo-localization native module forces RTL before React loads. Needs a native rebuild after changing it. |
| **Web** (`expo start --web`) | `public/index.html` (`<html dir="rtl">`), `web.lang: "ar"`, and `src/components/RtlRoot.web.tsx` (root `<View dir="rtl" lang="ar">`) | react-native-web ignores I18nManager. Start/end styles are mirrored only inside an RTL locale context, which the root view provides. |

- **Both keys are set** (`extra` and the plugin options): Expo Go SDK 57 reads
  only `extra`, while builds read the plugin options.
- **One-time safety net** (`src/lib/rtl.ts`, `ensureRtl`): if a native build
  ever starts left-to-right (for example the plugin was added without a
  rebuild), it calls `allowRTL(true)` + `forceRTL(true)` and reloads once with
  `reloadAppAsync` from `expo`. A stored flag prevents a reload loop.
  - It never reloads in Expo Go (it would never stick) or on the web (where
    `I18nManager.isRTL` is undefined).
  - `Updates.reloadAsync` is not used: it rejects in development and Expo Go.
  - `DevSettings.reload` is not used: it does nothing in production.
  - The splash screen stays up until RTL is confirmed and the Arabic font is
    loaded, so the first frame is already Arabic and right-to-left.
- **Styles work the same in all three, even if RTL were off.** Only
  start/end properties are used (`marginStart/End`, `paddingStart/End`,
  `start/end`, `flexDirection: "row"`, which runs right-to-left under RTL).
  `scripts/check-i18n.mjs` fails `pnpm lint` on any `marginLeft`,
  `paddingRight`, `left:`/`right:`, `borderLeft*` or `textAlign: "left"`.
  - Native RN would flip physical left/right too, but react-native-web does
    not, so they are banned.
  - Text alignment is set once in `AppText`: `textAlign: "left"` on native,
    which iOS and Android turn into the start (right) edge under RTL. It is
    left unset on web, where the default is `start`.
- **Mirroring:** native RTL never mirrors drawings or transforms. The back
  chevron (`ChevronIcon`) is drawn pointing left and mirrored with
  `scaleX: -1` in RTL. Arrows such as "→" between times were replaced with
  Arabic words ("من 07:00 إلى 15:00").
- **Bidi:** phone numbers, coordinates and codes are wrapped in left-to-right
  isolates (`LtrText`), so "+972…" never becomes "…972+". Times and money
  keep their order on their own.
- **React Navigation** gets `direction="rtl"` and an Arabic-font theme
  explicitly, because on web it would read LTR from react-native-web.
- **Font:** IBM Plex Sans Arabic (`@expo-google-fonts/ibm-plex-sans-arabic`)
  is loaded at runtime with `useFonts`, so it also works in Expo Go; the
  expo-font build plugin does not. Details:
  - Only the 400/600/700 weights are bundled, and there is one family per
    weight. `fontWeight` is never used: Android would fall back to the system
    font for bold.
  - Line height is 1.6× the font size, so Arabic letters are not clipped on
    Android.
- **Digits and plurals on Hermes:** Hermes has no `Intl.PluralRules`; it is
  polyfilled with `@formatjs/intl-pluralrules`, Arabic only. Hermes ignores
  `-u-nu-latn` on iOS, so numbers, dates and money come from the shared
  engine-independent formatter in `@fieldmaster/i18n`, not from `Intl`.
