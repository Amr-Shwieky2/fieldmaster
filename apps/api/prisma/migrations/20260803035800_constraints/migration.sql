-- Hand-written migration: business-rule constraints that Prisma's schema
-- language cannot express (trigger-based counting, exclusion constraints,
-- cross-column checks). See docs/technical-decisions.md.

CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ── Max 2 active Owners per organization (spec section 6.1) ────────────────
-- Enforced here as a trigger (DB-level) in addition to the application-level
-- OwnerLimitService check performed inside the same transaction.
CREATE OR REPLACE FUNCTION enforce_max_two_owners() RETURNS TRIGGER AS $$
DECLARE
  owner_count INT;
BEGIN
  IF NEW.role = 'OWNER' AND NEW.status = 'ACTIVE' AND NEW.archived_at IS NULL THEN
    SELECT COUNT(*) INTO owner_count
    FROM organization_memberships
    WHERE organization_id = NEW.organization_id
      AND role = 'OWNER'
      AND status = 'ACTIVE'
      AND archived_at IS NULL
      AND id <> NEW.id;

    IF owner_count >= 2 THEN
      RAISE EXCEPTION 'organization % already has the maximum of 2 active Owners', NEW.organization_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_max_two_owners ON organization_memberships;
CREATE TRIGGER trg_enforce_max_two_owners
  BEFORE INSERT OR UPDATE ON organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_two_owners();

-- ── No overlapping active compensation profiles per worker (section 9.3) ──
ALTER TABLE compensation_profiles
  ADD CONSTRAINT compensation_profiles_no_overlap
  EXCLUDE USING gist (
    worker_profile_id WITH =,
    daterange(effective_start_date, COALESCE(effective_end_date, 'infinity'::date), '[]') WITH &&
  );

-- ── No negative rates (section 29.4) ────────────────────────────────────────
ALTER TABLE compensation_profiles
  ADD CONSTRAINT compensation_profiles_rates_non_negative
  CHECK (
    (daily_base_rate_agorot IS NULL OR daily_base_rate_agorot >= 0) AND
    (base_hourly_rate_agorot IS NULL OR base_hourly_rate_agorot >= 0) AND
    overtime_hourly_rate_agorot >= 0
  );

-- ── Only one ACTIVE time entry per worker at a time (section 10.4) ────────
CREATE UNIQUE INDEX time_entries_one_active_per_worker
  ON time_entries (worker_profile_id)
  WHERE status = 'ACTIVE';

-- ── Clock-out must be after clock-in (section 10.4) ────────────────────────
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_clock_out_after_clock_in
  CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at > clock_in_at);

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_minutes_non_negative
  CHECK (
    (raw_duration_minutes IS NULL OR raw_duration_minutes >= 0) AND
    unpaid_break_minutes >= 0 AND
    (approved_regular_minutes IS NULL OR approved_regular_minutes >= 0) AND
    (approved_overtime_minutes IS NULL OR approved_overtime_minutes >= 0)
  );

-- ── No duplicate client event id per device (section 29.4 / 20.3) ─────────
-- Already enforced by the @@unique([deviceId, clientEventId]) index from
-- the Prisma schema (clock_events_device_id_client_event_id_key).

-- ── Payroll adjustment amount sanity (section 14) ──────────────────────────
ALTER TABLE payroll_adjustments
  ADD CONSTRAINT payroll_adjustments_amount_nonzero
  CHECK (amount_agorot <> 0);

-- ── Geofence radius / accuracy must be positive ────────────────────────────
ALTER TABLE geofences
  ADD CONSTRAINT geofences_radius_positive
  CHECK (radius_meters > 0 AND min_accuracy_meters > 0);

ALTER TABLE sites
  ADD CONSTRAINT sites_default_radius_positive
  CHECK (default_geofence_radius_meters > 0);

-- ── Shift scheduled_end must be after scheduled_start ──────────────────────
ALTER TABLE shifts
  ADD CONSTRAINT shifts_end_after_start
  CHECK (scheduled_end > scheduled_start);
