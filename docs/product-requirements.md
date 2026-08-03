# Product Requirements

## What FieldMaster is

FieldMaster is a workforce-management platform for field crews whose work
location changes daily: construction, traffic-control, traffic-sign, and
traffic-light installation/repair teams ("Ramzanim" crews in the business
domain), plus their on-call ("Turan") rotation and emergency night
call-outs. It exists to answer, for each organization, four questions with
evidence: *who worked, where, for how long, and what were they paid* — under
real field conditions (dead batteries, no signal, forgotten stamps,
weather-shortened shifts) rather than the clean-office assumptions most
time-tracking software is built around.

This document summarizes the product surface actually implemented in this
repository. It intentionally mirrors the structure of the original
specification but only claims what's real — see `IMPLEMENTATION_STATUS.md`
for the done/partial/not-started breakdown per section, and
`technical-decisions.md` for why each gap or substitution was made.

## Who uses it

- **Owner** (max 2 per organization, enforced at the DB and service layer):
  full access, including compensation, bank details, payroll, and the
  financial dashboard.
- **Field Manager**: operational access — scheduling, approvals, corrections
  — with every monetary figure structurally excluded from their view (guard,
  service, DTO, and frontend layers all strip it independently; see
  `authorization-matrix.md`).
- **Temporary Supervisor**: not a stored role but a time-boxed capability
  (`TemporarySupervisorAssignment`) granted to a worker for one shift, letting
  them open a temporary check-in point for that shift only.
- **Worker**: clocks in/out, submits daily summaries, views their own
  approved attendance and earnings, starts/ends emergency call-outs when
  eligible.

## Core workflows implemented end-to-end

1. **Onboarding** — Owner sends a single-use invitation link → worker
   submits legal name, phone, bank details (encrypted), consent → Owner
   reviews and approves with a compensation profile → worker becomes
   `ACTIVE`.
2. **Scheduling** — Owner/Field Manager creates projects, sites, geofences,
   and shifts (`STANDARD`, `DAY_TURAN`, `NIGHT_TURAN`, `EMERGENCY_CALLOUT`),
   assigns workers.
3. **Attendance** — worker clocks in (server-validated PostGIS geofence or
   Flexi-Check), works, submits a mandatory daily summary, clocks out. Every
   event carries device/server timestamps, GPS evidence, and a mock-location
   flag.
4. **Offline attendance** — the same clock-in/out flow, captured and Ed25519-
   signed on-device when there's no connectivity, queued locally, and synced
   as a batch once reachable (`offline-sync.md`).
5. **Approval** — Field Manager or Owner approves, rejects, corrects
   timestamps, or applies manual full-day credit (with a mandatory reason,
   auditable, and — critically — with no monetary figure ever shown to the
   Field Manager making the call).
6. **Turan & emergency call-outs** — Day/Night Turan scheduling; a Night
   Turan worker can start an emergency shift, which retroactively credits 60
   compensated minutes before the button press and 15 after the button press
   ending it, with the actual and compensated timestamps both stored and
   both displayed.
7. **Payroll** — effective-dated compensation profiles (daily/hourly),
   9-hour standard-day rule, overtime, the forgotten-stamp two-strike
   monthly penalty, manual adjustments and reversals, calculate → review →
   finalize → reopen state machine, all monetary values as integer agorot.
8. **Reporting** — a tamper-evident (SHA-256-hashed source data) PDF worker
   attendance ledger, generated server-side via Playwright, with financial
   sections gated to Owner/the worker themself.
9. **Notifications** — in-app + real-time (WebSocket + SSE), role-filtered
   content (an Owner's clock-out notification includes an estimated cost; a
   Field Manager's never does).
10. **Audit** — every sensitive mutation writes an append-only, SHA-256
    hash-chained audit log entry, independently verifiable via
    `GET /audit-logs/verify` or the `verify-audit` CLI script.

## What is explicitly out of scope in this build

Terraform/AWS deployment is written but never applied against a live AWS
account; there is no live CI run against a GitHub Actions runner; there is
no device-attestation (Play Integrity/App Attest) integration; identity
document upload and audio transcription are not implemented; the mobile app
has not been verified on an iOS Simulator or a physical device (this
environment has no full Xcode install). See `IMPLEMENTATION_STATUS.md` for
the complete list.

## Regional and data conventions (enforced, not aspirational)

- Primary timezone `Asia/Jerusalem` for all business-date/monthly grouping;
  every stored timestamp is UTC (`timestamptz`).
- Currency ILS, stored as integer agorot everywhere — no floating-point
  monetary arithmetic exists in the codebase (`packages/shared-validation/src/payroll.ts`
  does integer division with a single explicit rounding step per calculation).
- UUIDv7 primary keys, generated in application code (`src/common/ids.ts`).
- WGS84/SRID 4326 coordinates, validated server-side only via PostGIS
  `ST_DWithin` (a client's own "am I inside the geofence" belief is never
  trusted — see `geofencing.md`).
