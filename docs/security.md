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
  (15 min default) access tokens, Owner-triggered device revocation
  (`AuthService.revokeDevice`).
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
