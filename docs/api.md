# API Reference

Full interactive documentation: `GET /api/v1/docs` (Swagger UI) once the
API is running (`pnpm dev` or `docker compose up`). This document covers
conventions the Swagger UI doesn't make obvious at a glance.

## Base path and route groups

Everything is under `/api/v1`. Implemented route groups:

```text
/auth                  OTP request/verify, refresh, logout
/organizations         org settings
/memberships           membership management
/workers                roster, onboarding approval/rejection
/onboarding-invitations single-use invite links
/compensation-profiles  effective-dated rate profiles
/projects, /sites, /geofences
/shifts, /shift-assignments
/temporary-supervisors, /temporary-check-in-points
/clock-events           clock-in / clock-out (online)
/devices                Ed25519 public-key registration for offline signing
/offline-sync           batched offline clock-event submission
/time-entries           attendance detail, approvals, corrections
/turan-assignments, /emergency-callouts
/payroll-periods, /payroll-items, /payroll-adjustments
/reports                worker attendance ledger PDF generation
/notifications          in-app list, mark-read, WebSocket/SSE streams
/audit-logs              paginated list + chain verification
```

Not implemented as separate route groups (see `IMPLEMENTATION_STATUS.md`):
`/sessions` (folded into `/auth`), `/forgotten-stamp-infractions` (surfaced
via `/time-entries`/`/payroll-adjustments` instead of its own CRUD
surface), `/settings`, `/files`.

## Authentication

Phone number + OTP. `POST /auth/otp/request` (dev: code printed to the API
log via `ConsoleOtpProvider`; production: Twilio Verify, untested against a
live account here) → `POST /auth/otp/verify` returns a short-lived JWT
access token and a rotating opaque refresh token (`familyId:secret`).
Refresh-token **reuse** (a secret that doesn't match the family's current
hash) revokes the entire session family immediately — this is deliberate
theft detection, not a bug, so a genuinely stale client will need to log in
again rather than silently recovering.

A user belonging to more than one organization gets `400
ORGANIZATION_SELECTION_REQUIRED` with the candidate list on their first
verify call; resubmit with `organizationId` to disambiguate.

## Error format

Every error response has this exact shape, produced by a global
`AllExceptionsFilter` regardless of where in the stack it originated:

```json
{
  "statusCode": 400,
  "code": "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
  "message": "You are outside the permitted check-in area.",
  "details": { "distanceMeters": 184, "allowedRadiusMeters": 100 },
  "correlationId": "..."
}
```

`code` is a stable machine-readable identifier
(`apps/api/src/common/errors/app-exception.ts`); `message` is safe to show
a worker directly. Stack traces never appear in a response body. The admin
web is Arabic only and never displays `message`: it shows the Arabic text
for `code` (or for the HTTP status when it doesn't know the code), and its
`pnpm lint` fails if a code the API can send has no Arabic message.

## Idempotency

Required (`Idempotency-Key` header) on: clock-in, clock-out, offline-sync
batch submission, payroll calculation, and PDF generation. Implementation:
`IdempotencyService.withIdempotency(key, route, body, handler)` hashes the
request body, stores it keyed by `(key, route)`, and replays the stored
response on an exact retry; a retry with the same key but a *different*
body is rejected with `409 IDEMPOTENCY_KEY_CONFLICT`.

## Pagination

Cursor-based on high-volume lists (`/audit-logs`): response shape is
`{ items, nextCursor }`, pass `nextCursor` back as `?cursor=...` for the
next page. Other list endpoints (workers, shifts, sites) are simple arrays
— the data volumes in this deployment shape don't yet justify cursor
pagination there.

## Offline sync specifics

See `offline-sync.md` for the full protocol. In short:
`POST /devices/public-key` registers a device's signing key once;
`POST /offline-sync/batches` submits an array of signed events (processed
in device-timestamp order) and returns a per-event outcome
(`VERIFIED`/`FLAGGED`/`REJECTED`/`DUPLICATE`), never a single pass/fail for
the whole batch.

## Rate limiting

A global `@nestjs/throttler` rule (300 requests/minute per client) plus a
stricter, separate limit on OTP requests (5 per 15-minute window per phone
number, enforced in `AuthService.requestOtp`). Not yet tuned per-route.
