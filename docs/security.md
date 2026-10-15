# Security

## Application security controls implemented

- **Input validation**: a global NestJS `ValidationPipe` with `whitelist:
  true, forbidNonWhitelisted: true` — any request field not declared on a
  DTO is rejected, not silently dropped or passed through.
- **SQL injection**: all queries go through Prisma's parameterized query
  builder; the one raw-SQL path (`GeofenceValidationService`'s
  `ST_DWithin` check) uses `$queryRaw` with parameter placeholders, never
  string concatenation.
- **XSS / output encoding**: React (admin-web) and NestJS's JSON
  serialization both encode by default; there is no `dangerouslySetInnerHTML`
  or raw HTML templating of user input anywhere in the app. PDF templates
  (Playwright-rendered) escape all interpolated worker-supplied text (a
  `markup` tag that only passes HTML it built itself). Report CSVs guard
  every text cell against spreadsheet formula injection (a leading `=`, `+`,
  `-`, `@`, tab or carriage return gets a `'`).
- **Secure headers**: `helmet` is registered globally in `apps/api`.
- **Rate limiting / brute force**: `@nestjs/throttler` global limit, plus a
  dedicated OTP request-rate limit and an OTP max-attempts counter
  (`AuthService`). The public onboarding routes have their own, lower limit
  (Step 8, below).
- **Session security**: refresh-token rotation with reuse detection
  (revokes the whole session family on reuse — see `api.md`), short-lived
  (15 min default) access tokens, device revocation by whoever manages the
  organization's users (`AuthService.revokeDevice`).
- **Encryption at rest**: bank account details and identity-document
  numbers (Step 8) are envelope-encrypted (AES-256-GCM) at the application
  layer (`EncryptionService`) — a local key in development
  (`LOCAL_ENCRYPTION_KEY_BASE64`), real AWS KMS client code for production
  (untested against a live AWS account here).
- **Encryption in transit**: TLS is a deployment-environment concern (the
  ALB/CloudFront layer in the Terraform module), not something the app
  itself terminates in this local-dev slice.
- **Signed URLs**: PDF and CSV reports are uploaded to private S3/MinIO
  storage and served via short-lived signed download URLs, never a public
  bucket path. Identity documents and profile photos (Step 8) get a 60-second
  inline URL, for an Owner only, and every view is audited.
- **Idempotency**: see `api.md` — prevents duplicate-submission attacks on
  financially-relevant mutations (clock events, payroll calculation).

## What's explicitly not implemented

CSRF protection (admin-web stores tokens in `localStorage`, not an httpOnly
cookie, so CSRF isn't the relevant threat model here — see
`technical-decisions.md` for the trade-off), device attestation (Play
Integrity/App Attest), and a transactional outbox for guaranteed-once event
delivery. A real malware scanner is not bound yet: the scan hook exists
(Step 8, below) and records `NOT_SCANNED` until a deployment provides one.

## Uploads and the public onboarding page (Step 8)

- **Invitation links:**
  - A token is 32 random bytes; only its SHA-256 is stored, and the raw
    token is returned once, to the manager who created the link.
  - The three public routes run one guard before anything reads the body
    (in particular before an upload is buffered). It always hashes the
    input, looks it up by hash and compares the hashes with
    `timingSafeEqual`, also when nothing was found.
  - Unknown, malformed, used, expired and revoked links all get the same
    `404 INVITATION_INVALID_OR_EXPIRED` with no details.
  - The public routes are limited per IP address and route
    (`ONBOARDING_RATE_LIMIT` requests per minute, default 10), and a link
    can store at most 20 files.
- **Upload checks:**
  - The type comes from the file's first bytes (JPEG, PNG or `%PDF-`),
    never from its name or the browser's claim, and must be allowed for
    the purpose (an ID document: JPEG, PNG or PDF; a photo: JPEG or PNG).
  - At most 10 MB; multer stops reading a larger body early, and the
    answer is `413 FILE_TOO_LARGE`.
  - Files live only in memory until they are stored.
- **Metadata:**
  - JPEG: Exif/XMP (APP1), IPTC (APP13), comments and the MPF index are
    removed.
  - PNG: text chunks, eXIf and tIME are removed.
  - Anything after the end-of-image marker is dropped. The pixels are
    unchanged.
  - A file that only starts like an image is refused.
- **Malware-scan hook:** every file passes the `MALWARE_SCANNER` provider
  before it is stored. The default (development) binding records
  `NOT_SCANNED`; an INFECTED verdict is `422 FILE_REJECTED` and nothing is
  stored.
- **Storage:** private bucket under
  `onboarding/<organization>/<invitation>/<file>`, with the SHA-256 of the
  stored bytes. File names are never stored or logged.
- **The Owner's review:**
  - `GET /workers/:id/onboarding-review` (ID number and bank details
    decrypted) and `GET /file-assets/:id/view-url` need `VIEW_BANK_INFO`,
    so they are Owner only.
  - Both answer `Cache-Control: no-store`.
  - Each call writes an audit row (`WORKER_SENSITIVE_DATA_VIEWED`,
    `FILE_ASSET_VIEWED`) without the values.
- **What is proved by tests:**
  - `onboarding.e2e-spec.ts` captures the Nest logger, the console and
    stdout/stderr, plus every audit row and notification. It asserts that
    no ID number, account number, branch-and-account, invitation token,
    uploaded file name or photo metadata appears in them.
  - The leak scanner (below) searches every non-Owner GET response for the
    same values.

## The mobile app (Step 9)

- **Secrets on the phone:** the session (access and refresh tokens), the
  offline-signing private key, the offline queue's encryption key and the
  install id live only in the iOS Keychain / Android Keystore
  (expo-secure-store). There is no AsyncStorage path on iOS or Android, not
  even as a fallback; tests run the storage code as iOS and as Android and
  assert AsyncStorage is never touched. The web target, a development
  stand-in, uses AsyncStorage and offers no protection.
- **The offline queue is encrypted at rest:** XSalsa20-Poly1305 with a
  Keychain/Keystore key, a fresh nonce per write, and tampering detected.
  See `offline-sync.md`.
- **Sessions refresh themselves:** an expired access token is refreshed once
  and the call retried. Concurrent failures share one refresh, because the
  API revokes the whole session family when a refresh token is reused.
- **A revoked device key ends the device's trust:**
  - the app clears its queue state, its key and its session;
  - offline events signed with the old key are rejected
    (`DEVICE_KEY_REVOKED`);
  - only a session started after the revocation may register a new key.
- **Mock location:**
  - Android's `mocked` flag is sent as DETECTED, and the existing rule
    refuses it.
  - iOS and the web send UNAVAILABLE: the platform cannot tell, and the
    app never claims otherwise.
  - Movement heuristics (impossible speed, zero accuracy, a frozen
    position) are recorded for review, never a refusal.
- **Attestation:** an adapter interface only. It reports `DEV_MOCK` in
  development and `UNAVAILABLE` otherwise; Play Integrity / App Attest are
  not implemented, and nothing claims a verified device.
- **Push content:**
  - The lock screen shows only the type's Arabic label and a generic
    «عرض التفاصيل».
  - The data holds ids for the deep link only: never another person's
    name and never an amount.
  - Push follows each member's own preferences. A token that Expo reports
    as unregistered is removed, and signing out removes the device's token.
- **Attendance photos and voice notes:**
  - private storage, type checked by content, image metadata removed;
  - unattached uploads bounded per worker;
  - attached only by their own uploader;
  - viewable by an Owner (an audited 60-second URL), and since mobile
    manager mode by a member with `VIEW_ATTENDANCE` reviewing the entry,
    within their projects: one audited short-lived URL per view, never
    cached on the phone (`cachePolicy="none"`).
- **Transcripts** are never logged; production has no transcription
  provider by default (`TRANSCRIPTION_PROVIDER=none`).
- **Co-workers' data:** before Step 9 a worker's shift list and detail
  carried every co-worker's name and phone number; now only the worker's
  own assignment. The leak scanner checks it.
- **Android cleartext:** allowed only in builds whose API address is plain
  `http://` (a phone testing against a computer on the LAN). Production
  builds (`https://`) keep Android's default.

## Mobile manager mode

- **The phone decides from permissions** (`GET /auth/me`), and the API
  checks every call again with the same permission and project scope as the
  web. A notification offers an action only to a reader who may perform it.
- **Applications on the phone:** the summary decrypts nothing for display
  (a masked bank account, last four digits, only with `VIEW_BANK_INFO`).
  The ID number, the full bank details and the ID image come only from an
  explicit tap, through the audited review and a short-lived URL. They live
  only in the screen's memory, the image is never cached, and they are
  dropped when the screen loses focus, when the app leaves the foreground
  (the iOS app switcher stores a picture of the screen) and after a
  decision. An ID document that is a PDF is not opened on the phone (it
  would land in another app's cache).
- **Pushes** add the notification subject's id, and a supervisor report's
  id, never a worker's id or name (a push can show on a locked screen).
- **Late decisions are refused:** rejecting an application that is no
  longer pending is 409 (it could reject an active worker before), and a
  settled notification subject cannot be settled again.
- **Leak scanner:** every new GET route is scanned for every role without
  `VIEW_FINANCIALS` (seeded subject, supervisor report, work location and
  entry photo; the assignable workers with a time window).

## Sensitive logging

Pino structured logging is used throughout the API. OTP codes are only
ever logged by the `ConsoleOtpProvider` (development adapter, explicitly
designed to do this so local dev works without a real SMS provider) —
production's `TwilioVerifyProvider` never logs the code, since Twilio
Verify never returns it to the caller in the first place. Access/refresh
tokens, invitation tokens, bank account numbers, government identifiers and
uploaded file names are never logged (Step 8: proved by the onboarding
tests, which capture every log line); `EncryptionService` never logs raw key
material. Before Step 8 the invitation-creation path logged the raw token;
that log line is gone.

## Financial isolation — automated proof, not just a claim

`auth-and-rbac.e2e-spec.ts` and `payroll.e2e-spec.ts` assert, against a
real running API and database, that:

- A Field Manager's token gets `403` on every payroll/financial-dashboard
  route.
- A worker-list response for a Field Manager viewer never serializes a
  `compensation` field, even though the same query for an Owner viewer does.
- A full-day-credit response (which a Field Manager *can* trigger
  operationally) contains no string matching `/Agorot/` anywhere in its
  JSON body.

`financial-leak-scanner.e2e-spec.ts` covers the whole surface rather than
chosen routes (and, since Step 8, identity documents as well as money): it signs in (dev login) as a Field Manager and as a Worker,
calls every GET route discovered from Nest's route metadata with real seeded
ids, and fails with the route and JSON path of every money or bank key
(`*Agorot`, `*rate`, budget, bank, account number, branch, net/gross pay,
estimated cost, amount). It scans a Field Manager's WebSocket and SSE
notification payloads the same way. The only exceptions are a Worker's own
compensation history and own payslip, which are checked to contain only that
Worker's data.

Since Step 6 the scanner also signs in as a **Temporary Supervisor** (a
worker with an active assignment, who opened a temporary point through the
API) and scans every GET route as that third role, the supervised-shift view
included. That makes 45 GET routes after Step 6. The Owner pass also confirms
the settings' penalty amount is in the Owner's copy only.

Because the routes are discovered, new endpoints are covered without editing
a list. The Step 5 attendance screens added 6 GET routes (40 in all); the
scanner reads each as a Field Manager and as a Worker with real rows, and
needed only a seeded id per new `:id` parameter.
- `GET /attendance/entries`, `GET /time-entries/:id/evidence` and
  `GET /emergency-callouts[/:id]` return no money to a Field Manager.
- The Owner-only `GET /time-entries/:id/estimated-cost` and
  `GET /workers/:id/estimated-earnings` answer a Field Manager and a Worker
  403.
- The scanner's Owner pass confirms the money is exactly where expected:
  those two routes and the Owner's emergency call-out DTO.

Step 7 added 5 GET routes (50 in all): the payroll versions, a worker's
drill-down, the calculation run, and `GET /payroll-statements/me`.
- The Field Manager, Worker and Temporary Supervisor passes read the Owner-only
  payroll routes as 403 (no body), and the Owner pass confirms the money is
  in them (`$.workers[n].netPayableAgorot`, `$.entries[0].totalAgorot`,
  `$.costByWorker[0].netPayableAgorot`, ...).
- `GET /payroll-statements/me` joins `my-payslip` as a Worker-own-money
  exception. The scanner's seed now finalizes its month (a Worker's pay only
  ever comes from a finalized version), and its own-data test checks the
  statement is the Worker's own item and that the response contains no other
  worker's id; the same month seen by a worker without pay in it has no
  statement at all.

Step 9 added 4 GET routes (60 in all): emergency eligibility, the
notification preferences, and the worker's own pay routes
(`GET /time-entries/:id/my-pay`, `GET /payroll-statements/me/current`).
The pay routes join the Worker-own-money exceptions,
with own-data checks (another worker's entry is 404; the open-month
estimate takes no worker id). It also checks that a worker's shift list and
detail hold no co-worker's profile id, phone or name.

Step 8 added 6 GET routes (56 in all):
- the invitation list and the public join page;
- the Owner-only onboarding review and file view URL;
- a report's details and its integrity check.

The scanner now also does three new things:
- **Searches for values, not only keys.** Its seed encrypts an ID number
  and bank details for the Worker, and submits an application with a
  Palestinian ID through the public route. It then searches every
  response, for every role, for those ID numbers, account numbers, account
  holders and both invitation tokens (and their hashes), under any key.
- **Checks the Owner too.** In the Owner's own responses these values may
  appear only in `GET /workers/:id/onboarding-review`.
- **Flags two more key names:** `idnumber` and `accountholder`.

The Field Manager's pass reads the pending application, the invitation
list and an application notification, so the search has something to find.
A report the Temporary Supervisor may not see answers 404 on all three
`/reports/:id*` routes.

The flexible organization model added 8 GET routes (`/auth/me`, the roles
catalog, list and details, `/memberships/access`, the Owner limit, the work
rules and their impact) and made the scanner role-agnostic:
- **Every role without `VIEW_FINANCIALS` is scanned**: the built-in Field
  Manager, Worker and Temporary Supervisor as before, and custom roles
  created through the API — one holding every permission except the money
  group, and a project manager restricted to another project. None gets a
  money key or amount from any route; the routes that need a financial
  permission answer them 403 with no body.
- **The positive control**: a custom role with the money group («محاسب»)
  does see money (budgets, estimates, payroll), so an empty result for the
  others means no leak rather than no data.
- **Scope**: the member restricted to another project gets none of this
  project's records from the lists, and 404 on its ids.
- The penalty rule is money: it is absent from `GET /organizations/me/settings`,
  from the work rules (values, history and limits) and from `/auth/me` for
  every role without the permission, and changing it is 403 for them.

**Roles and scope cannot be used to escalate.** The permission list of a
custom role is validated against the catalog (an unknown permission is a
400); only `MANAGE_ROLES` edits roles and only `MANAGE_ORG_USERS` assigns
them; a member restricted to some projects loses every organization-wide
permission (users, roles, settings changes, audit log, payroll,
compensation changes, onboarding approval, bank details, the Turan rota)
whatever their role holds; effective permissions are read from the database
on every request (a token never carries them); at least one active member
always keeps the right to manage roles and settings (409 `LAST_ADMIN`); and
every change is audited old → new with its reason.

**Finalized payroll cannot be changed, even directly in the database (Step
7).** Triggers refuse any UPDATE or DELETE of a FINALIZED version, any
INSERT/UPDATE/DELETE of its items, and any UPDATE or DELETE of a
calculation snapshot (`payroll-versions.e2e-spec.ts` tries all three).

See `authorization-matrix.md` for the full defense-in-depth breakdown and
`docs/testing.md` for how to run these tests yourself.

## Sessions end immediately (Step 6)

- **Suspend / archive:** the member's sessions (refresh-token families,
  now tied to the membership) are revoked in the same transaction, and their
  WebSocket and SSE connections are closed. Every REST call is refused by the
  guard's live status check (proved by `users-devices.e2e-spec.ts`).
- **One session (users page):** access tokens carry the session id (`sid`),
  so the guard refuses that session's access token at once, not when it
  expires.
- **Role and time tracking** are read from the database on every request,
  never trusted from the token.

## Audit log integrity

Append-only, SHA-256 hash-chained per organization
(`current_hash = SHA256(previous_hash + canonical_payload)`). Verify with:

```bash
pnpm --filter @fieldmaster/api verify-audit
# or, against a live API:
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/audit-logs/verify
```

The chain's order is explicit: each row has a `sequence_number` (1, 2, 3, …
per organization, unique, no gaps) and links to the row numbered one less.
Both checks walk the chain in that order, never by `created_at`: rows
written in the same millisecond, or by processes whose clocks differ, can
share or swap timestamps, and walking by them reported untampered chains as
broken.

Writers cannot fork the chain. `AuditService.record()` takes a
transaction-scoped advisory lock on the organization
(`pg_advisory_xact_lock`), reads the highest-numbered row and appends the
next one. The lock is held until the writer's transaction ends, so a
concurrent request or BullMQ job waits, then links to the row just
committed; a rolled-back row leaves no gap. The unique
`(organization_id, sequence_number)` index refuses a second row at the same
place. `audit-chain.e2e-spec.ts` runs 40 concurrent writers and a writer
whose transaction is still open.

A tampered row (edited directly in the database, bypassing the
application) breaks the chain at that row; a deleted row breaks it at the
row after it. The verification response reports exactly where
(`brokenAtId`). Deleting the newest rows cannot be detected from the chain
alone: what remains still verifies.

Chains written before `sequence_number` existed were numbered by the
migration `20261014120000_audit_chain_sequence`, following each row's
`previous_hash` link. Nothing was re-hashed, so a chain that was already
broken (or forked by the old race) is still reported where it breaks.

## Offline event anti-tampering

Every offline clock event is signed on-device with an Ed25519 key whose
private half never leaves Keychain/Keystore (or its AsyncStorage fallback
on the web verification target — see `technical-decisions.md`). The server
verifies the signature against the device's registered public key before
trusting *any* field of the event, including its timestamp — see
`offline-sync.md` for the full protocol and why a naive implementation of
this is easy to get subtly wrong (an actual signature-mismatch bug was
caught and fixed by the automated tests during this build; see the git
history / `offline-sync.service.ts`'s comment on canonical-payload
construction).

## Dependency audit

CI's "Dependency security scan" job runs `pnpm audit --audit-level high`.
Vulnerable transitive packages are pinned to patched versions through
`pnpm.overrides` in the root `package.json`. Each override is scoped to the
affected major (for example `"js-yaml@^3": "^3.15.2"`), so a dependency is
never pushed across a major version it wasn't written for.

Advisories with **no patched release** are listed in
`pnpm.auditConfig.ignoreCves` so the gate stays meaningful for everything
else. Both of these are reached only through development/build tooling, never
through the API runtime or the shipped web/mobile bundles:

| CVE | Package | Why it is ignored | Remove when |
|---|---|---|---|
| CVE-2026-93687 (GHSA-vfj7-8cjw-p6xm) | `braces` ≤ 3.0.3 | Stack-exhaustion DoS from deeply nested brace patterns. Only reached via `micromatch`/`chokidar`/`fast-glob` in jest, the Nest CLI, metro, tailwind and eslint, which expand glob patterns from repo config, not user input. | `braces` ships a fix (then add an override instead) |
| CVE-2026-85393 (GHSA-86w9-cpqp-85rv) | `node-forge` ≤ 1.4.0 | RSA PKCS#1 v1.5 signature-verification bypass. Only reached via `@expo/cli` (dev server / export code signing); the app never verifies signatures with it. | `node-forge` ships a fix |

## Reporting a vulnerability

This is a development/demonstration repository, not a deployed production
service — there is no live endpoint to responsibly disclose against. If
you fork this for a real deployment, replace the development secrets in
`.env.example` (OTP bypass, local encryption key) before doing anything
else; see `deployment.md`.
