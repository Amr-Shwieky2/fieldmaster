# Database Design

PostgreSQL 17 + PostGIS 3.5, managed by Prisma migrations under
`apps/api/prisma/migrations/`. Every migration in that directory is a
hand-reviewed SQL file (generated via `prisma migrate diff` against the
live dev database, then applied with `prisma migrate deploy` — this
environment's non-interactive shell doesn't support `prisma migrate dev`;
see `troubleshooting.md`).

## Tables (48)

Organizations & RBAC: `organizations`, `organization_settings`, `users`,
`organization_memberships`, `roles`, `member_scopes`, `work_rule_versions`
(the last three since the flexible organization model, below).

Workers & sensitive data: `worker_profiles`, `encrypted_bank_accounts`,
`identity_documents` (written by onboarding since Step 8: the encrypted
document number and its uploaded file), `file_assets` (Step 8),
`compensation_profiles`, `onboarding_invitations`.

Devices & sessions: `user_devices`, `device_public_keys`,
`refresh_token_families`, `otp_challenges`.

Projects, sites, geofences: `projects`, `sites`, `geofences`.

Shifts & assignments: `shifts`, `shift_assignments`,
`temporary_supervisor_assignments`, `temporary_check_in_points`.

Turan & emergency: `turan_assignments`, `emergency_callouts`.

Attendance: `time_entries`, `clock_events`, `unpaid_breaks`,
`daily_summaries`, `attendance_approvals`, `manual_time_corrections`,
`forgotten_stamp_infractions`, `rejected_clock_attempts`.

Step 6 (migration `20261012120000_supervisors_operations_settings`) adds
columns, no tables. Defaults are the old behavior.
- `organization_settings`: `default_grace_minutes` 10,
  `default_geofence_radius_meters` 100, `default_min_gps_accuracy_meters` 50,
  `temporary_point_radius_meters` 100, `temporary_point_min_accuracy_meters`
  75, `notification_preferences` JSONB `{}`.
- `refresh_token_families`: `membership_id` (FK, `SET NULL`, indexed;
  backfilled for users with one membership) and `last_used_at`.
- `temporary_supervisor_assignments.can_open_check_in_points` (default true).
- `time_entries.long_open_notified_at` (the 9-hour alert, sent once per
  entry).
- `NotificationType` gains `TEMPORARY_SUPERVISOR_ISSUE_REPORTED`.

`rejected_clock_attempts` (Step 5, migration
`20261012100000_attendance_evidence`) is evidence only: clock-ins and
clock-outs the server refused for the phone's location or clock, with the
error code, times, position, accuracy, distance and the limit applied.
- It references the organization, worker and shift (`RESTRICT`).
- It also references the time entry it was later linked to and the
  temporary point (`SET NULL`).
- Indexes: (organization, shift), (worker, shift), (time entry).
- No business rule reads it.

The same migration adds `clock_events.temporary_check_in_point_id` (the
point a clock-in was validated against, `SET NULL`).

Offline sync: `offline_sync_batches`, `offline_sync_events`.

Payroll: `payroll_periods`, `payroll_items`, `payroll_adjustments`,
`payroll_calculation_snapshots`, `payroll_calculation_runs`.

### Payroll versions (Step 7, migration `20261013120000_payroll_versions`)

- **`payroll_periods` is one row per version** of a month (the existing
  unique `(organization_id, year_month, version)`). New columns:
  `previous_version_id` (unique; the finalized version a reopen replaced),
  `created_by`, `current_snapshot_id` (unique; the calculation the version's
  items come from), `legacy` (see below). `reopened_at/by/reason` now
  describe how THIS version was created.
- **`payroll_calculation_snapshots`**: one immutable row per calculation.
  `schema_version` 2 stores everything a version is shown from:
  `inputs_json` (approved entries with shift / project / site / emergency
  minutes, compensation profiles, adjustments, worker names, pending
  counts), `result_json` (per-worker and per-entry results, per project and
  per site, warnings), `totals_json`, `inputs_hash` (sha256 of entry ids +
  updates, adjustment ids, profile ids + updates) and `calculation_run_id`.
- **`payroll_calculation_runs`** (new): one row per background calculation
  (its id is the BullMQ job id): `state` (`PayrollCalculationState`),
  `progress`, `processed_workers`, `total_workers`, `idempotency_key`,
  requested/started/finished times, `error_code` / `error_message`. A partial
  unique index (`payroll_period_id WHERE state IN ('QUEUED','RUNNING')`)
  allows one active run per version.
- **`payroll_items`**: `approved_shifts` (null for items calculated before
  Step 7 without an entry list), `forgotten_stamp_penalties_agorot`,
  `reversals_agorot`, `other_deductions_agorot`;
  `positive_adjustments_agorot` now holds manual bonuses only.
- **Immutability triggers:** `payroll_periods_finalized_immutable`,
  `payroll_items_finalized_immutable`,
  `payroll_calculation_snapshots_immutable` (TRUNCATE, used by the seed and
  the tests, is unaffected).
- **Existing data:** a period reopened in place before Step 7 keeps its row
  (same id) as the latest version; each earlier version is restored as a
  FINALIZED `legacy` row with that version's snapshots (and, if the row was
  reopened but not recalculated, the items, which were the previous
  version's). Finalization and reopen details come from the audit log. Item
  breakdowns are backfilled from the adjustments linked to them when they
  reconcile with the stored totals. Checked on a scratch database with every
  pre-Step-7 shape (reopened twice and recalculated, reopened once and not
  recalculated, a crashed CALCULATING row, a finalized month without a
  snapshot).

### Reports and onboarding (Step 8, migration `20261013180000_reports_onboarding`)

- **`generated_reports`** keeps a report's background job and its files:
  - `status` (`ReportStatus`: `QUEUED`, `RUNNING`, `READY`, `FAILED`;
    default `READY` for reports generated before Step 8, which were
    synchronous), `progress` (0-100), `idempotency_key`,
    `error_code` / `error_message`, `started_at` / `finished_at`;
  - `csv_storage_key` next to the PDF's `storage_key`, plus `pdf_sha256`,
    `csv_sha256` (what `GET /reports/:id/verify` recomputes) and
    `page_count`;
  - `storage_key` and `sha256_hash` (the hash of the source data, printed
    in the footer) are nullable, since a queued report has neither yet;
  - new index (organization, generated_at) for the reports page.
- **`file_assets`** (new): an uploaded file in private object storage.
  - Columns: `purpose` (`FileAssetPurpose`: `IDENTITY_DOCUMENT`,
    `PROFILE_PHOTO`), `storage_key` (unique), `content_type` (detected from
    the content), `size_bytes`, `sha256` of the stored (metadata-stripped)
    bytes, `scan_result` (the malware-scan hook: `NOT_SCANNED` until a
    scanner is bound).
  - The invitation it was uploaded with, and the worker profile once an
    application uses it.
  - Indexed by organization, invitation and worker profile. No file name
    is stored.
- **`identity_documents.file_asset_id`** (unique, `SET NULL`) replaces
  `file_storage_key`, which held no data. `document_type` stays plain text:
  `ISRAELI_ID`, `PALESTINIAN_ID` or `PASSPORT` (`GovernmentIdType`), so the
  Palestinian ID needed no migration. The number itself is encrypted
  (`ciphertext`, `iv`, `auth_tag`, `encryption_key_id`).
- **`worker_profiles.profile_photo_asset_id`** (unique, `SET NULL`).
- **`onboarding_invitations`:** `revoked_by` (a person's revocation; the
  expiry sweep revokes without one, and those read as EXPIRED) and
  `redeemed_worker_profile_id`. An invitation's status (`ACTIVE`, `USED`,
  `EXPIRED`, `REVOKED`) is derived, never stored.

### The mobile worker app (Step 9, migration `20261014090000_mobile_worker_app`)

Additive only:
- `FileAssetPurpose` gains `ATTENDANCE_PHOTO` and `VOICE_SUMMARY`.
  `file_assets.time_entry_id` (`SET NULL`, indexed) links them to the entry
  whose clock-in or clock-out used them. Until then they belong to the
  uploading worker (`worker_profile_id`).
- `daily_summaries`:
  - `voice_note_asset_id` (unique, `SET NULL`): the recorded summary;
  - `summary_source`: TYPED or VOICE;
  - `text` keeps the summary as sent, and `transcription` the transcript as
    the service returned it.
- `clock_events.mock_location_state` (DETECTED / NOT_DETECTED /
  UNAVAILABLE, as the phone reported it) and `location_signals` (movement
  heuristics, recorded for review); also
  `rejected_clock_attempts.mock_location_state`. They are null or empty
  before Step 9.
- `organization_memberships.notification_preferences` (JSONB, default
  `{}`): the member's own push switches per notification type.
- Push deliveries are rows in the existing `notification_deliveries`
  (channel `PUSH_LOG` / `PUSH_EXPO`, status DELIVERED / SKIPPED / FAILED).

### Flexible organization model (migrations `20261015090000_org_role_custom`, `20261015090100_flexible_organization`, `20261015090200_scale_indexes`)

- `OrgRole` gains `CUSTOM` (its own migration: Postgres cannot use a new
  enum value in the transaction that adds it).
- `roles`: per organization, a name, `system_key` (OWNER / FIELD_MANAGER /
  WORKER for the built-in roles, null for custom ones; one of each per
  organization), the custom role's `permissions` (text array), `archived_at`.
  Names are unique among active roles, case-insensitively
  (`roles_organization_id_name_active_key` on `lower(name)`). The migration
  creates the three built-in roles for every existing organization.
- `organization_memberships.role_id` (→ `roles`) and `restricted_to_scope`.
  The migration fills `role_id` for every existing member from its kind;
  the trigger `trg_fill_membership_role_id` does the same for new rows that
  give only a built-in kind, and a CHECK requires a role record for CUSTOM.
- `member_scopes`: one project or one site per row (a CHECK enforces exactly
  one), unique per member and target, cascading with the project or site.
- `organization_settings.max_owners` (null = no limit, at least 1). Existing
  organizations get 2 (the previous fixed limit).
- `work_rule_versions`: organization, version number (unique per
  organization), `effective_from` (a business date), the seven rule values
  (a CHECK keeps each in its allowed range and the overtime threshold at or
  above the standard day), reason, created by/at. The trigger
  `trg_work_rule_versions_immutable` refuses every UPDATE and DELETE.
- Scale indexes (`20261015090200`): `time_entries (organization_id, status,
  business_date)` replacing `(organization_id, status)`, `time_entries
  (organization_id, business_date)`, `time_entries (shift_id)`, `shifts
  (project_id)`, `shifts (site_id)`, `sites (project_id)`,
  `forgotten_stamp_infractions (organization_id, business_month)`.

### Mobile manager mode (migrations `20261015120000_notification_issue_resolved`, `20261015120100_mobile_manager_mode`)

- `NotificationType` gains `TEMPORARY_SUPERVISOR_ISSUE_RESOLVED` (its own
  migration, as for any new enum value).
- `notification_subjects`: what notifications are about, one row per
  organization, kind (`ATTENDANCE` an entry, `OFFLINE_REVIEW` a worker's
  offline records, `ONBOARDING` an application, `SUPERVISOR_ISSUE` a
  report) and `ref_id` (unique together: the grouping key), with the shared
  handled state: `handled_at`, `handled_by`, `handled_outcome`,
  `handled_note`. A new notification about a settled subject clears it.
- `notifications.subject_id` (→ `notification_subjects`, set null on
  delete; indexed).
- `supervisor_issue_reports`: a temporary supervisor's report (assignment,
  shift, reporter, text, created at), so a manager can resolve it; indexed
  by organization and date, assignment and shift.
- `work_rule_versions`: every existing organization without a version gets
  version 1 (effective 2000-01-01, the starting values, «القيم الأصلية»);
  from here on nothing is priced with default values.

Notifications: `notifications`, `notification_deliveries`,
`notification_subjects` (mobile manager mode); supervisor reports:
`supervisor_issue_reports`.

Platform: `audit_logs`, `idempotency_records`, `generated_reports`.

Not present (deliberate scope cuts — see `IMPLEMENTATION_STATUS.md`):
`push_tokens`, `outbox_events`.

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

- **The organization's Owner limit** (`organization_settings.max_owners`,
  no limit when null) — both a Postgres trigger (`trg_enforce_max_owners`,
  which replaced the fixed-two `trg_enforce_max_two_owners`) and an
  application-level `OwnerLimitService` check inside the same transaction,
  both under the advisory lock `owners:<organization>` so concurrent
  promotions are counted one after the other. Tested at both layers.
- **Work-rule versions are never edited** — a trigger refuses UPDATE and
  DELETE on `work_rule_versions`; a change is a new row.
- **A scope row names exactly one project or site** — a CHECK on
  `member_scopes`.
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
scoped per organization. `sequence_number` is the row's place in its
organization's chain: 1, 2, 3, … with no gaps, unique per organization
(`audit_logs_organization_id_sequence_number_key`). The row before it is
the one numbered one less, and its `previous_hash` is that row's
`current_hash`. Neither `sequence_number` nor `created_at` is part of the
hash. `AuditService.record()` appends under a per-organization advisory
lock held until the writer's transaction ends (see `security.md`).
`AuditService.verifyOrganizationChain()` walks the chain by
`sequence_number`, never by `created_at`, and confirms every number, link
and hash; exposed via `GET /audit-logs/verify` and the standalone
`pnpm --filter @fieldmaster/api verify-audit` CLI script, which share
`common/audit/audit-chain.ts`. The migration
`20261014120000_audit_chain_sequence` numbered the existing rows by
following their `previous_hash` links; rows those links do not reach (a
chain already broken, or forked by concurrent writers before this column
existed) come after them, oldest first.

## Money and time

Every monetary column is an `Int` counted in agorot (never a float/decimal
computed via chained floating-point arithmetic). Every business timestamp
is `timestamptz` (stored UTC); `business_date`/`business_month` string
columns (e.g. `time_entries.business_date`, `forgotten_stamp_infractions.business_month`)
are precomputed via `toBusinessDate()` (`packages/shared-validation`) at
write time so monthly/daily grouping queries never need to convert
timezones inside SQL.
