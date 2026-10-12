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
  (Playwright-rendered) escape all interpolated worker-supplied text.
- **Secure headers**: `helmet` is registered globally in `apps/api`.
- **Rate limiting / brute force**: `@nestjs/throttler` global limit, plus a
  dedicated OTP request-rate limit and an OTP max-attempts counter
  (`AuthService`).
- **Session security**: refresh-token rotation with reuse detection
  (revokes the whole session family on reuse — see `api.md`), short-lived
  (15 min default) access tokens, Owner-triggered device revocation
  (`AuthService.revokeDevice`).
- **Encryption at rest**: bank account details are envelope-encrypted
  (AES-256-GCM) at the application layer (`EncryptionService`) — a local
  key in development (`LOCAL_ENCRYPTION_KEY_BASE64`), real AWS KMS client
  code for production (untested against a live AWS account here).
- **Encryption in transit**: TLS is a deployment-environment concern (the
  ALB/CloudFront layer in the Terraform module), not something the app
  itself terminates in this local-dev slice.
- **Signed URLs**: PDF reports are uploaded to private S3/MinIO storage and
  served via short-lived signed download URLs, never a public bucket path.
- **Idempotency**: see `api.md` — prevents duplicate-submission attacks on
  financially-relevant mutations (clock events, payroll calculation).

## What's explicitly not implemented

Malware-scanning integration point, file-size/type validation (no file
upload subsystem exists yet — see `technical-decisions.md`), CSRF
protection (admin-web stores tokens in `localStorage`, not an httpOnly
cookie, so CSRF isn't the relevant threat model here — see
`technical-decisions.md` for the trade-off), device attestation (Play
Integrity/App Attest), and a transactional outbox for guaranteed-once event
delivery.

## Sensitive logging

Pino structured logging is used throughout the API. OTP codes are only
ever logged by the `ConsoleOtpProvider` (development adapter, explicitly
designed to do this so local dev works without a real SMS provider) —
production's `TwilioVerifyProvider` never logs the code, since Twilio
Verify never returns it to the caller in the first place. Access/refresh
tokens, bank account numbers, and government identifiers are never logged;
`EncryptionService` never logs raw key material.

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
chosen routes: it signs in (dev login) as a Field Manager and as a Worker,
calls every GET route discovered from Nest's route metadata with real seeded
ids, and fails with the route and JSON path of every money or bank key
(`*Agorot`, `*rate`, budget, bank, account number, branch, net/gross pay,
estimated cost, amount). It scans a Field Manager's WebSocket and SSE
notification payloads the same way. The only exceptions are a Worker's own
compensation history and own payslip, which are checked to contain only that
Worker's data.

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

See `authorization-matrix.md` for the full defense-in-depth breakdown and
`docs/testing.md` for how to run these tests yourself.

## Audit log integrity

Append-only, SHA-256 hash-chained per organization
(`current_hash = SHA256(previous_hash + canonical_payload)`). Verify with:

```bash
pnpm --filter @fieldmaster/api verify-audit
# or, against a live API:
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/audit-logs/verify
```

A tampered row (edited directly in the database, bypassing the
application) breaks the chain at that row and every row after it — the
verification response reports exactly where (`brokenAtId`).

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
