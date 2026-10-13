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

**Superseded in Step 7** (see "Step 7: …" below): reopening now creates a
new version row, finalized versions are immutable, and the migration
restored the versions this design had overwritten. Original note:

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

**Superseded in Step 8** (see "Step 8: …" below): the onboarding page now
collects the ID number (encrypted) and an image or PDF of the document
(private storage, Owner-only signed URLs). Original note:

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

## Step 4: worker simulator (test tool) and a dev-only time rewind

`/dev/worker-simulator` in the admin web lets an Owner or Field Manager act as
any seeded worker and exercise every attendance rule through the real API.
It is a test tool: it adds no business rule and bypasses none.

### Visibility: same signal as the login page, real 404 when off

- The API answers `GET /auth/dev/users` with 200 only while dev login is on
  (`DEV_LOGIN_ENABLED=true`, refused at boot with `APP_ENV=production`). The
  login page already uses that answer; the simulator uses the same one in
  three places, so nothing can drift from the API's real state:
  - a Next **middleware** for `/dev/*` asks the API before rendering and
    rewrites to an unmatched path when the answer is not 200, so the route
    is a real 404 with the app's own Arabic not-found page, exactly like an
    unknown URL;
  - the page (a server component) checks again and calls `notFound()`. That
    alone was not enough: with Next 15.5 the response is already streaming
    (streamed metadata) when an async page calls `notFound()`, so the status
    went out as 200;
  - the nav item and the client component use the login page's own query.
- Owners and Field Managers only: the nav item is filtered by role, a Worker
  never gets the signed-in shell at all, and the component shows "access
  denied" for any other role.
- Every new API route (`/api/v1/dev/*`) answers 404 when dev login is off.
  These routes need a signed-in user, and the global `JwtAuthGuard` runs
  before any controller guard, so with only a guard an anonymous request
  would get 401 and reveal the route. A Nest **middleware**
  (`DevRoutesGateMiddleware`) runs before every guard and answers like an
  unknown route; `DevLoginEnabledGuard` and a service-level check stay as
  defense in depth.

### The simulated worker's session is completely separate

The Step 1 cache leak (an Owner's cached responses briefly visible to a Field
Manager) came from one shared React Query cache. The simulator therefore:

- gets the worker session from `POST /auth/dev/login`, exactly like quick
  login, and keeps the tokens **in memory only** -- never in the admin session
  store (`localStorage`) or any other browser storage;
- uses its **own `FieldMasterClient`**: a 401 on a worker request ends only
  the simulator session (the admin's client would sign the admin out);
- uses its **own `QueryClient`**, passed explicitly to every worker query, so
  no worker response can enter the admin's cache and no admin response can
  enter the worker's;
- revokes only the worker's refresh-token family (`POST /auth/logout`) when
  the simulator session ends, the worker is switched, or the page unmounts
  (which is also what happens when the admin signs out).

Tests cover each point, including mutation checks: putting worker queries in
the admin cache, or saving the worker session in the admin store, fails them.

### Real protocols only

- Clock-in/out, emergency start/end, temporary check-in points and offline
  sync all go through the real endpoints with the worker's token.
- **Offline:** events are canonicalized and signed in the browser with the
  same `@fieldmaster/shared-validation` functions the mobile app uses, with a
  per-simulated-device Ed25519 key (from `crypto.getRandomValues`) registered
  through `POST /devices/public-key`, and synced with
  `POST /offline-sync/batches`. "Send the same batch again" resends the same
  signed events with a new Idempotency-Key. With the same key the
  idempotency layer would replay the first answer, so a new key is what
  exercises the server's own duplicate detection (`DUPLICATE`).
- **Scenario "prepare"** steps use the admin's own session and the normal
  management endpoints: create and assign a shift, add a Night Turan, assign
  a temporary supervisor. Clock-in does not check a shift's scheduled
  window, so a prepared shift that has to start after the worker's other open
  shift (the API refuses overlapping assignments) still works.
- **Regular / overtime split:** the clock-out response has no split; the
  540-minute rule is applied when a manager approves. The simulator's
  "approve as manager" button calls the real approve endpoint with the
  admin's session and shows the approved minutes (540 + 0 for 9 h,
  540 + 90 for 10 h 30 m).
- Raw JSON is shown with every `*Agorot` field and `compensation` object
  removed, because a Field Manager may be at the keyboard. While testing this
  we found that the worker-scoped `GET /shifts` itself returns
  `project.budgetAgorot`. The simulator never shows it; fixing the API is a
  separate task.

### Time travel: `POST /api/v1/dev/time-entries/:id/rewind { minutes }`

Clocking in and out a minute apart cannot test the 540-minute rule, so one
dev-only endpoint moves an **open** entry's clock-in back:

- Gated like dev login (404 when off, impossible in production) and limited
  to Owners and Field Managers (`CORRECT_TIME_ENTRIES`).
- Only an `ACTIVE` entry (`TIME_ENTRY_NOT_OPEN` otherwise). Not an emergency
  call-out (`DEV_REWIND_EMERGENCY_NOT_SUPPORTED`): its times come from the
  callout's own start/end clicks (-60 / +15), not from the entry's clock-in.
- 1-1440 minutes per call, and the entry may not end up open for more than
  24 hours in total (`DEV_REWIND_LIMIT_EXCEEDED`).
- The business date is recomputed from the new clock-in, exactly as a real
  clock-in computes it. Both the old and the new date's payroll periods must
  be open (`PAYROLL_PERIOD_FINALIZED` otherwise).
- **Never silent:** the entry gets `devRewoundAt` (new nullable column; the
  admin web shows a "تعديل تجريبي" badge on it), and a `DEV_REWIND` audit
  event records the old and new clock-in, the minutes, `APP_ENV` and the
  business-date change. The clock-in `ClockEvent` (the evidence of what
  really happened) is not touched.
- The update is conditional on the entry still being open with the same
  clock-in, so a concurrent clock-out can't be overwritten.
- The simulator's buttons (6 h, 9 h, 10 h 30 m) compute the minutes needed
  for the entry's elapsed time to reach the target, so clocking out right
  after gives exactly 360 / 540 / 630 minutes.

A second dev-only read, `GET /api/v1/dev/worker-simulator/me` (called with
the worker's own session), returns what the worker-facing API does not
expose: the worker's Turan assignments, whether one makes them eligible for
an emergency call-out now (the same check the emergency endpoint runs), and
their active temporary-supervisor assignments.

## Step 5: attendance screens

The attendance list, the evidence page, the correction dialog, the
forgotten-stamp report, the emergency call-out pages and the worker's
attendance tab. No business rule changed. Where the screens needed a rule,
the API's own implementation was moved into `@fieldmaster/shared-validation`
and is called from both sides.

### Refused clock attempts are stored as evidence

The detail page's map must show rejected attempts with their distance, but
the API only answered the worker with an error and kept nothing.

- Refusals tied to the phone's location or clock are now stored in
  `rejected_clock_attempts`:
  - on clock-in: `GEOFENCE_OUTSIDE_ALLOWED_RADIUS`, `GPS_ACCURACY_TOO_LOW`,
    `DEVICE_TIME_DEVIATION_EXCEEDED`, `MOCK_LOCATION_BLOCKED`;
  - on clock-out: `DEVICE_TIME_DEVIATION_EXCEEDED`, `MOCK_LOCATION_BLOCKED`.
  Each row keeps the device and server times, deviation, position, accuracy,
  distance and the limit that was applied. Online and offline-synced events
  use the same path, since both go through `clockInCore` / `clockOutCore`.
- **The worker's answer does not change:**
  - the row is written outside the refused operation;
  - `RejectedClockAttemptsService.record` never throws (it logs a warning
    instead), so a storage failure cannot turn a 400 into a 500.
- **Linking:**
  - a refused clock-out already has its entry;
  - a refused clock-in has none yet. It is linked, in the same transaction,
    to the entry the worker then opens for the same shift: by a clock-in,
    or by a manager's "missing clock-in" correction.
  - An attempt whose shift never gets an entry stays unlinked. It is still
    tied to the shift and the worker.
- The new rows are evidence only: no rule reads them. The list's "attempt
  outside the geofence" and "mock or suspicious location" flags are derived
  from them.

A clock event also records the temporary check-in point it was validated
against (`clock_events.temporary_check_in_point_id`). Before, only the
distance was kept, so neither the map nor the "temporary point" flag could
know which point was used.

### Money stays in separate Owner-only responses

The Field Manager's responses must contain no money at all, not even a key
the client hides. Two shapes were possible:

- **One endpoint with role-dependent fields.** Rejected: the same response
  type would carry money for one role, and a single missed branch would
  leak it.
- **Separate responses (chosen).** The attendance list and the evidence
  never contain money, for anyone. An Owner's page additionally calls:
  - `GET /time-entries/:id/estimated-cost`;
  - `GET /workers/:id/estimated-earnings?month=`.
  Both require `VIEW_COMPENSATION`, so the permissions guard refuses a Field
  Manager or Worker before any query runs. A Field Manager's page never even
  makes the request.

Emergency call-outs are one list for both roles, so their DTO is built per
role, by different code: only the Owner's path computes the cost and sets
`estimatedCostAgorot`. A Field Manager's DTO has no such key.

All estimates go through `PayrollCalculationService` (the effective
compensation profile and `computeEntryCompensation`), the code the monthly
payroll uses:
- an approved entry uses its approved minutes;
- a pending entry uses the split approval would apply ("estimated");
- an open or rejected entry, or one with no compensation profile, has no
  amount, and the card says why.

The financial leak scanner needed no route list: it finds every GET route
from Nest's metadata. It only needed a seeded id for each new `:id`
parameter, so its seed now includes an emergency call-out.

### Shared rules instead of copies

The admin web previews what the API will do, so both run the same code:
- `rawDurationMinutes` and `splitWorkedMinutes`: the first 540 worked
  minutes regular, the rest overtime, with full-day credit topping a short
  day up to 540. Approval, the cost estimate, the detail page, the worker
  tab and the correction preview all use them.
- `forgottenStampInfractionMonth`: an infraction counts in the month of the
  correction, or, when the correction creates the entry, the month of its
  clock-in. The correction service and the dialog's "هذه المخالفة رقم N"
  both use it, so the preview cannot disagree with the infraction that is
  saved.
- `evaluateForgottenStampInfraction` (existing): the dialog shows the
  Owner's deduction from it.

### List tabs, flags and filters

- **Tabs:**
  - بانتظار الموافقة = `PENDING_APPROVAL` + `CORRECTION_REQUESTED`;
  - معتمد = `APPROVED`;
  - مرفوض = `REJECTED`;
  - الكل = every status, open entries included.
  The counts come from the same filters in one transaction.
- **Order:** waiting entries oldest first (an approval queue); the other
  tabs newest first.
- **Flags** are computed from stored facts, both as row badges and as
  filters. A filter requires every chosen flag.
  - attempt outside the geofence: a stored `GEOFENCE_OUTSIDE_ALLOWED_RADIUS`
    attempt;
  - mock or suspicious location: a `FLAGGED` or mock-suspected clock event,
    or a stored `MOCK_LOCATION_BLOCKED` attempt;
  - offline: an `OFFLINE`-origin clock event;
  - Flexi-Check: `FLEXI_CHECK` and not an emergency (emergencies are
    Flexi-Check too, but have their own flag);
  - temporary point: a clock event with a temporary point;
  - emergency: `isEmergency`;
  - "تعديل تجريبي": `devRewoundAt`.
- **Dates and URL:**
  - Date filters compare business dates (`YYYY-MM-DD`, Asia/Jerusalem),
    like payroll.
  - Every filter and the page live in the URL, so a view can be shared and
    the back button works.
  - A page past the end (its last row was just approved, or an old link)
    sends the user to the last page.

### Correction times are entered in Asia/Jerusalem

A `datetime-local` input has no time zone, and a manager outside Israel
would otherwise enter times in their own. The dialog reads and fills it as
Asia/Jerusalem wall time (`lib/jerusalem-time.ts`, using the same offset
rules as the rest of the app), and says so in its label.

### Small validation fixes, no rule change

- **A manual correction that creates an entry** now checks:
  - the worker belongs to the caller's organization (404);
  - the worker has no open entry. That was already impossible (one open
    entry per worker is a database constraint), but it surfaced as a 500.
    It is now 409 `ACTIVE_TIME_ENTRY_EXISTS`, like a second clock-in.
- **Reversing a forgotten-stamp deduction** requires a non-blank reason
  (400 otherwise). The reason was always mandatory, but the endpoint
  accepted an empty string.
- **Correcting an existing clock-in or clock-out** was already supported,
  with the same audit and finalized-period rules as the other corrections.
  New e2e tests prove that:
  - it keeps the original clock event (the device and server times never
    change);
  - it writes old → new to the audit log;
  - it answers 409 in a finalized period.

## Step 6: temporary supervisors, live operations, settings, users and devices

No business rule changed. The 9-hour day, the two free forgotten stamps, the
10 ₪ penalty and the -60 / +15 emergency minutes stay fixed in code, and the
settings page shows them read-only.

### Temporary supervisor: a capability checked live on every call

- **Live check.** The supervisor endpoints, and opening or closing a
  temporary point, all load the assignment and require it to be ACTIVE right
  now (`temporarySupervisorState`):
  - not revoked;
  - `activatedAt` ≤ now < `expiresAt`;
  - the shift neither CLOSED nor CANCELLED.

  Nothing is cached in the token, so revoking, the window ending, or closing
  the shift ends access on the next request. Closing a shift still expires
  its points eagerly, as before.
- **404 vs 403.** Another member's assignment (or an unknown id) is a 404,
  so ids are not confirmed to strangers. The caller's own assignment that is
  not active is a 403 `TEMPORARY_SUPERVISOR_INACTIVE`, so the app can say why.
- **`canOpenCheckInPoints`** (new column). Existing assignments are migrated
  to `true` (today's behavior), and it is also the API default. A supervisor
  without it gets 403 `TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS`. Closing a
  point follows the same rule as opening one (before, only managers could
  close).
- **Assigning** now checks what the spec states:
  - an active, time-trackable worker assigned to that shift;
  - an open shift;
  - no overlapping assignment for the same worker and shift;
  - an end after the start and in the future.
- **The supervised-shift view** is operational only: presence, clock times,
  location outcome, flags, and the shift's active points. Phone numbers are
  left out (the spec allows at most what a Field Manager sees), and so is
  every other shift and project. The leak scanner scans it as a third role.
- **Issue reports** notify the shift's manager and the Owners. They follow
  the notification settings like the other manager-facing events (new
  notification type `TEMPORARY_SUPERVISOR_ISSUE_REPORTED`), and are audited
  with the text as the audit note.

### Live operations: a snapshot plus events on the existing SSE stream

- **Snapshot.** `GET /operations/live` returns everything the page shows. No
  money for anyone, Owners included.
- **Position.** It is the last accepted clock event of each open entry
  (clock-in or clock-out). There is no continuous tracking, as the spec
  requires.
- **Real-time events, on the existing channels.**
  - Clock-in/out, refused attempts, temporary points, supervisors,
    emergencies, offline syncs that need review, shift close, approvals,
    corrections and the 9-hour alert all emit an in-process
    `operations.changed` event (`RealtimeEventsService`).
  - The existing socket.io gateway forwards it to an `ops:<organization>`
    room. The existing SSE stream (`GET /notifications/stream`) forwards it
    as a named `operations` event.
  - Only Owners and Field Managers get them, decided from the current role
    in the database. The payload is `{ kind, at }`, with no data.
- **Client.** The admin web had no real-time client at all. The page uses
  the browser's built-in `EventSource` on the SSE stream, so there is no new
  dependency.
  - Each event refetches the snapshot, debounced 500 ms.
  - The stream sends a `ping` every 25 s. After 60 s of silence, or an
    error, the page marks itself "غير متصل" and reconnects with backoff.
    After reconnecting it refetches once.
  - "Late" and "open over 9 hours" change with time alone, so the snapshot
    is also refreshed once a minute. Events stay the main mechanism.
- **9-hour alert.** A repeatable BullMQ job (every minute) reports each
  ACTIVE entry open ≥ 540 minutes:
  - to the shift's manager and the Owners, following the notification
    settings;
  - using the existing (previously unused) `OVERTIME_THRESHOLD_CROSSED`
    type, which the admin web already rendered in Arabic;
  - once per entry: `time_entries.long_open_notified_at` is claimed with a
    conditional update, so concurrent or repeated sweeps never send twice.

### Settings read from the database

`OrganizationSettingsService.get()` reads the row on every use and creates
it, with the column defaults, the first time. The defaults are the values
that used to be hard-coded, so nothing changes until an Owner edits them.

| Setting | Before | Read by |
|---|---|---|
| Device-time deviation (s) | `DEVICE_TIME_DEVIATION_SECONDS` env, 120 | clock-in/out, online and offline |
| Shift grace minutes | `?? 10` | new shifts (and so the operations page's "late") |
| Site geofence radius (m) | `?? 100` | new sites |
| Geofence GPS accuracy (m) | `?? 50` | new geofences |
| Temporary point radius (m) | `?? 100` | new temporary points |
| Temporary point GPS accuracy (m) | constant 75 | clock-in at a temporary point |
| Invitation validity (h) | already a setting (72) | new invitations |
| Notification audiences | who each call site notified | manager-facing notifications |

- **Not in the spec's list, added anyway.** The two temporary-point values:
  the spec requires every setting the API reads to come from the database.
- **`autoDeductUnpaidBreaks`** was already stored but is read by no rule. It
  stays editable as an existing setting, and the page says it is not applied
  yet. Applying it would be a new business rule.
- **The environment variable is gone** (`.env.example`, CI, Turbo, e2e
  setup).
- **Sections and audit.** Each section is saved on its own (`PATCH
  …/workday`, `…/onboarding`, `…/notifications`). Every changed field gets
  one `ORGANIZATION_SETTING_CHANGED` audit row (field, old → new). The old
  unaudited `PATCH /organizations/me/settings` was removed; nothing used it.
- **Field Manager copy.** Field Managers read the settings
  (`VIEW_ORG_SETTINGS`), but their copy leaves out the penalty amount (money).
- **Validation.** A field left out keeps its value. A `null` value, or the
  same notification event twice in one request, is a 400 (never a database
  error or an ambiguous audit row). One older, app-wide behavior remains: the
  global `ValidationPipe` converts types implicitly, so a string such as
  `"no"` sent for a boolean becomes `true`. The admin web always sends real
  booleans.
- **Notification audiences** are stored per event as `{ owners,
  fieldManagers }`. A missing entry means the default, which is exactly who
  got it before:
  - clock-in/out, 9 hours, issue reports: shift manager + Owners;
  - emergencies: all Owners + all Field Managers;
  - onboarding and offline review: Owners only.

  A shift manager who is an Owner follows the Owners' switch. Field Managers
  never receive money in any case.

### Sessions belong to a membership; role, status and session are checked live

- **`refresh_token_families.membership_id`** (new). Refresh keeps the
  session in its own membership. Before, refresh picked "any active
  membership" of the user, so a multi-organization user could silently
  switch organizations.
  - The migration backfills it for users with a single membership.
  - Older sessions of multi-organization users fall back to the old
    behavior once, then keep that membership.
- **"End session" and "last active".** The column scopes the users page's
  sessions to this organization. `last_used_at` (sign-in or refresh) is the
  member's "last active".
- **Access tokens carry `sid`** (the session). The guard, the WebSocket
  gateway and the SSE stream refuse a revoked session. So "إنهاء الجلسة" and
  suspension end access at once, not when the 15-minute access token
  expires.
- **The guard reads role and time tracking from the membership**, not the
  token: a role change applies to the next request. With time tracking off
  the request has no worker profile (no clock-in); the profile itself is
  kept for history.
- **Suspend / archive** revokes the membership's sessions in the same
  transaction and closes its WebSocket and SSE connections
  (`sessions.ended` event). A role change also closes them, so they
  reconnect with the new role (e.g. leaving the operations room).
- **Device key.** `POST /devices/:userId/:deviceId/revoke-key` did not check
  that the user belongs to the caller's organization; it does now (404). The
  users page uses a membership-scoped route on top of it. Offline events
  signed by a revoked key were already refused.

### Two older gaps the Step 6 tests found, fixed

- **Point lists.** `GET /shifts/:id/temporary-check-in-points` had no
  permission or scope check: any Worker could list any shift's temporary
  points, and an unknown shift returned `[]`. That contradicts "a supervisor
  cannot read another shift". It now has the visibility of `GET /shifts/:id`:
  a Worker only for a shift they are assigned to, everyone else 404. No
  screen used the route (the apps get the points from the shift itself).
- **Closing a shift.** `POST /shifts/:id/close` closed a shift that was
  already closed (overwriting `closedAt`/`closedBy` and auditing twice) or
  cancelled (turning it into CLOSED). Both are now 409 `SHIFT_NOT_OPEN`, and
  nothing changes.
- **Malformed shift ids.** They reached Prisma on `GET /shifts/:id`,
  assigning a worker and closing, which made a `@db.Uuid` column throw a 500.
  They are now checked first and answer 404, like the Step 5 routes.

## Step 7: payroll versions, background calculation, Owner dashboard

API and admin web. PDFs are Step 8; the worker's mobile salary screen is
Step 9 (its API exists). No business rule changed: the calculators, the
9-hour day, -60 / +15, the forgotten-stamp rule and the lifecycle's
permissions are as they were.

### One row per version, immutable once finalized

The spec asks for immutable versions: a finalized version must never change
or be recalculated, and reopening keeps the old one readable.
- **Options.** (a) A separate `payroll_versions` table under a month row:
  every place that checks "is this month finalized?" (corrections, approval,
  full-day credit, the rewind, the evidence page) would have moved to a new
  table. (b) **Chosen:** `payroll_periods` becomes one row per version. Its
  unique `(organization, month, version)` key already allowed it, and every
  existing check already reads "the month's latest version", so they keep
  working: after a reopen the latest version is the new working one, and
  edits are allowed again.
- **What a version shows** comes from its own snapshot (schema 2): the
  inputs (approved entries with their shift, project and site, the profiles,
  the adjustments, names, pending counts), the per-worker and per-entry
  results, per project / per site, warnings and totals. Reading a version
  never recomputes from live records, so a later correction, rate change or
  reversal cannot change what a finalized month says.
- **Database triggers** make that a guarantee, not a convention: no UPDATE
  or DELETE of a FINALIZED version, no change to its items, no change to any
  snapshot. Finalizing is the version's last write; reopening INSERTS the
  next version and never touches the finalized one.
- **Adjustments.** An adjustment still links to the first item that
  included it (`payroll_item_id`), but what a version included is the list in
  its snapshot: a reversal created after version 1 counts in version 2 only.
- **Existing data.** Before this step, reopen bumped the version on the same
  row and the next calculation overwrote its items. The migration keeps each
  such row (same id: audit rows and adjustments still point at it) as the
  month's latest version and restores every earlier version as its own
  FINALIZED row marked `legacy`, with that version's snapshots, and, when the
  row had not been recalculated since its reopen, its items (they were the
  previous version's finalized results). Finalization and reopen details
  come from the audit log (version k's finalization is the k-th
  PAYROLL_FINALIZED row of the period). Item breakdowns are backfilled from
  the adjustments linked to them only where they reconcile with the stored
  totals, so no net changes. Old-format versions show what they stored: their
  items (no projects / sites / entries), or only the net per worker.
  Checked on a scratch database seeded with every pre-Step-7 shape
  (reopened twice and recalculated; reopened once and not recalculated; a
  crashed CALCULATING row; a finalized month without a snapshot); the
  triggers were then exercised on it.

### Calculation as a BullMQ job

- **Run rows.** `POST .../calculate` creates a `payroll_calculation_runs`
  row and a job with the same id, inside `withIdempotency`, so the same key
  replays the same run id; the response always shows the run's current
  state.
- **Concurrency.** A partial unique index allows one QUEUED/RUNNING run per
  version: two simultaneous requests cannot both start one (the second is
  409 `PAYROLL_CALCULATION_IN_PROGRESS`, also when the race is decided by the
  index). Finalizing while a run is active is refused too.
- **Lost jobs.** A run with no news for 15 minutes is taken over by the next
  request (marked FAILED with `PAYROLL_CALCULATION_STALE`); a stale job that
  wakes up later finds its run FAILED and does nothing.
- **Results.** The job computes everything first and writes in one
  transaction (snapshot, items, version → REVIEW), claiming its run there; a
  failure marks the run FAILED with `PAYROLL_CALCULATION_FAILED` (translated
  in the UI) and restores the version's previous status and results.
- **Queue prefix per database.** Jobs carry a run id, so an API must never
  take another database's jobs: the dev server and the e2e tests share one
  Redis. Every queue now uses the prefix `fm:<database name>` (or
  `QUEUE_PREFIX`), and the BullMQ connection is configured asynchronously so
  `apps/api/.env` is loaded first (before, `REDIS_URL` was read before
  ConfigModule loaded the file and silently fell back to the default).

### Inputs and outputs of a calculation

- Only approved entries, the profile in effect on each entry's business
  date, and the month's adjustments. One engine
  (`packages/shared-validation/src/payroll-month.ts`) over the existing
  calculators, used by the job, the dashboard, the worker's estimate and the
  seed.
- **Who is in a month:** everyone with an approved entry *or* an adjustment.
  Before, a worker with only adjustments (a bonus, or penalties on entries
  still waiting for approval) was left out of the calculation and their
  adjustments silently ignored.
- **Breakdown:** reversals are now their own column; `positive adjustments`
  are manual bonuses only (the migration moved existing reversals out of it;
  nets unchanged).
- **Warnings, not errors:** approved entries without a profile, with the
  worker and dates. **Counts, not money:** entries waiting for approval.
- **"Changed since calculation"** compares a fingerprint of the inputs
  (approved entry ids + last update, adjustment ids, profile ids + last
  update) stored with the snapshot against the live one. It never blocks
  finalizing; the Owner sees it.

### Small rule gaps closed on the way (no rule changed)

The existing rule is "a finalized month refuses every edit". These paths
did not check it:
- sending an entry back for correction (it could take an approved entry
  out of a finalized month's records);
- a manual adjustment (it was silently added to a finalized month);
- reversing a forgotten-stamp deduction (the infraction showed "reversed"
  while the finalized pay still deducted it).
All three are now 409 `PAYROLL_PERIOD_FINALIZED`; the Owner reopens first.
Also: the reopen reason must not be blank (the old admin page sent a fixed
text), a malformed month is a 400 instead of a payroll period named
"2026-13", and `my-payslip` serves only finalized versions.

### Owner dashboard

- **Where the figures come from.** A month whose latest version is
  finalized comes from that version; any other month is calculated live with
  the same engine (`source` says which). The pending-approval exposure is
  always live.
- **Overtime spike**, defined for this step: a day whose overtime (all
  workers) is at least twice the month's average per working day and at
  least 60 minutes. It is relative to the month, so a crew that always works
  long days is not flagged every day, while a day that jumps is; the floor
  keeps a quiet month's 20-minute days from counting. Integer comparison, no
  rounding.
- **Chart:** Recharts (added to the admin web), RTL: the time axis runs
  right to left and the value axis is on the right.
- **Field Managers** keep their money-free dashboard: the financial section
  is never requested for them, and the API answers 403.

### Worker statements

`GET /payroll-statements/me` takes no worker id. Statements come only from
FINALIZED versions (each month's latest finalized one). The open month(s)
get a DRAFT estimate: the current month always, and the previous month until
it is finalized (in the first days of a month the previous month is usually
still in review, and a worker would otherwise see nothing for it).

## Step 8: Arabic PDF reports, operational reports, complete onboarding

Arabic PDF and CSV reports generated as background jobs, seven report
types, and the complete onboarding flow (invitations, the public join page,
private uploads, the Owner's review). In progress: the sections below cover
the foundations; the report types, uploads and review are documented as they
land.

### The API uses the shared Arabic labels through a Node build of `@fieldmaster/i18n`

The PDFs and CSVs must use the same Arabic labels and formatting as the apps
(₪, Asia/Jerusalem times, Western digits, enum labels, error texts). The
package was TypeScript source only (the admin web and Metro compile it); the
API runs compiled CommonJS and cannot load `.ts`.
- **Chosen:** a second entry, `src/node.ts`, built to `dist/` with `tsc`
  (`pnpm --filter @fieldmaster/i18n build`, also in the API Dockerfile) and
  exported as `@fieldmaster/i18n/node` (`exports` for Node, `typesVersions`
  for the API's `moduleResolution: node`). It leaves out the error helpers,
  which import the browser API client.
- **Not chosen:** pointing the whole package at a build (the admin web and
  the mobile app would then depend on a build step during development), or
  copying the labels into the API (two sources of truth).

### Arabic PDFs: an embedded font and paged-media footers

- **Font:** IBM Plex Sans Arabic (SIL Open Font License) from
  `@fontsource/ibm-plex-sans-arabic`, an ordinary API dependency (so it is in
  node_modules locally and in the Docker image). Its Arabic, Latin and
  Latin-extended subsets are embedded in each report as base64 `@font-face`
  rules with their `unicode-range`, under one family used everywhere. Between
  them they cover Arabic, Latin names, digits and ₪, so Chromium never falls
  back to a system font (checked with the font files' character maps).
  Joined letters and the order of mixed Arabic, numbers and Latin names were
  checked on rendered pages; LTR runs (amounts, times, coordinates, hashes)
  are isolated with `<bdi dir="ltr">`.
- **Footer on every page** («صفحة N من M», report ID, SHA-256): CSS
  paged-media margin boxes (`@page { @bottom-left { content: … counter(page)
  … counter(pages) } }`) in the document itself. Playwright's
  header/footer templates were not used: they are separate documents that
  cannot use the embedded font.
- **Two hashes:** the footer carries the SHA-256 of the report's *source
  data* (a PDF cannot contain its own hash — see "PDF reports: hash the
  source data"). The SHA-256 of each stored file (PDF and CSV) is recorded
  too, and `GET /reports/:id/verify` downloads the stored files and hashes
  them again, so a changed file is detected.

