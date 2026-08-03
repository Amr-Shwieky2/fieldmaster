# Database Design

PostgreSQL 17 + PostGIS 3.5, managed by Prisma migrations under
`apps/api/prisma/migrations/`. Every migration in that directory is a
hand-reviewed SQL file (generated via `prisma migrate diff` against the
live dev database, then applied with `prisma migrate deploy` — this
environment's non-interactive shell doesn't support `prisma migrate dev`;
see `troubleshooting.md`).

## Tables (39)

Organizations & RBAC: `organizations`, `organization_settings`, `users`,
`organization_memberships`.

Workers & sensitive data: `worker_profiles`, `encrypted_bank_accounts`,
`identity_documents` (schema exists; nothing writes to it yet —
see `technical-decisions.md`), `compensation_profiles`,
`onboarding_invitations`.

Devices & sessions: `user_devices`, `device_public_keys`,
`refresh_token_families`, `otp_challenges`.

Projects, sites, geofences: `projects`, `sites`, `geofences`.

Shifts & assignments: `shifts`, `shift_assignments`,
`temporary_supervisor_assignments`, `temporary_check_in_points`.

Turan & emergency: `turan_assignments`, `emergency_callouts`.

Attendance: `time_entries`, `clock_events`, `unpaid_breaks`,
`daily_summaries`, `attendance_approvals`, `manual_time_corrections`,
`forgotten_stamp_infractions`.

Offline sync: `offline_sync_batches`, `offline_sync_events`.

Payroll: `payroll_periods`, `payroll_items`, `payroll_adjustments`,
`payroll_calculation_snapshots`.

Notifications: `notifications`, `notification_deliveries`.

Platform: `audit_logs`, `idempotency_records`, `generated_reports`.

Not present (deliberate scope cuts — see `IMPLEMENTATION_STATUS.md`):
`file_assets`, `push_tokens`, `outbox_events`.

## Enum strategy

Prisma enums (`OrgRole`, `ShiftStatus`, `NotificationType`, etc.) are
mirrored 1:1 in `packages/shared-types` as `as const` objects rather than
TypeScript `enum` — a TS `enum` member's type is nominal and isn't
structurally assignable to Prisma's own generated `(typeof X)[keyof typeof
X]` type even when the string values match, which would break every Prisma
call site. Adding a new enum value (as offline-sync's work did for
`NotificationType` and the new `OfflineSyncEventStatus`) means updating
*both* the Prisma schema and `shared-types/src/index.ts`, then generating a
migration (`ALTER TYPE ... ADD VALUE`, safe as a single multi-value
migration on Postgres ≥ 11).

## Key constraints actually enforced (not just documented)

- **Max two active Owners per organization** — both a Postgres trigger
  (`trg_enforce_max_two_owners`) and an application-level
  `OwnerLimitService` check inside the same transaction. Tested at both
  layers.
- **No overlapping compensation profiles** — a Postgres `EXCLUDE USING
  gist` constraint on `compensation_profiles` (worker + date range), not
  just an application-level check.
- **One active time entry per worker** — a partial unique index on
  `time_entries (worker_profile_id) WHERE status = 'ACTIVE'`.
- **No duplicate offline/online clock event per device** — a unique index
  on `clock_events (device_id, client_event_id)`, which the offline-sync
  path also uses as its duplicate-detection mechanism (see
  `offline-sync.md`) rather than reimplementing the check separately.
- **Clock-out after clock-in, non-negative durations/rates** — Postgres
  `CHECK` constraints (e.g. `shifts_end_after_start`), not just
  application validation — this is what actually caught a seed-data bug
  where a `DAY_TURAN` shift's end time could land before its start time
  depending on what wall-clock hour the seed script happened to run at
  (fixed in `prisma/seed.ts`; the constraint is what surfaced it).
- **Idempotency** — `idempotency_records (key, route)` unique constraint
  backs `IdempotencyService.withIdempotency()`, required on clock-in,
  clock-out, offline-sync batch submission, payroll calculation, and PDF
  generation.

## Geospatial data

Geofence centers are stored as plain `Float` latitude/longitude columns,
not a Prisma-unsupported `geography` type (Prisma has no first-class
PostGIS binding). The authoritative distance check casts to `geography` at
query time via a raw `ST_DWithin`/`ST_Distance` call
(`GeofenceValidationService`) — see `geofencing.md`.

## Audit log integrity

`audit_logs` is append-only at the application level with a SHA-256 hash
chain: `current_hash = SHA256(previous_hash + canonical_event_payload)`,
scoped per organization. `AuditService.verifyOrganizationChain()` walks the
chain and confirms every link; exposed via `GET /audit-logs/verify` and the
standalone `pnpm --filter @fieldmaster/api verify-audit` CLI script.

## Money and time

Every monetary column is an `Int` counted in agorot (never a float/decimal
computed via chained floating-point arithmetic). Every business timestamp
is `timestamptz` (stored UTC); `business_date`/`business_month` string
columns (e.g. `time_entries.business_date`, `forgotten_stamp_infractions.business_month`)
are precomputed via `toBusinessDate()` (`packages/shared-validation`) at
write time so monthly/daily grouping queries never need to convert
timezones inside SQL.
