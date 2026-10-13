-- Step 7: immutable payroll versions, background calculations, per-worker breakdown.
--
-- 1. payroll_calculation_runs: one row per background calculation of a version
--    (its id is the BullMQ job id). A partial unique index allows at most one
--    QUEUED or RUNNING run per version, so a concurrent "calculate" is refused.
-- 2. payroll_periods becomes one row PER VERSION of a month (the unique
--    (organization, month, version) key already allowed it):
--    previous_version_id chains a reopened version to the finalized one it
--    replaced; created_by; current_snapshot_id (the calculation whose results
--    are the version's items); legacy (see 4).
-- 3. payroll_items: approved_shifts and the adjustment breakdown
--    (forgotten-stamp penalties, reversals, other deductions);
--    positive_adjustments_agorot now holds manual bonuses only.
--    payroll_calculation_snapshots: schema_version, totals_json, inputs_hash,
--    calculation_run_id.
-- 4. Existing data. Before Step 7, "reopen" bumped the version ON THE SAME
--    ROW and the next calculation overwrote its items. Each such row is kept
--    (same id: audit rows, adjustments and items still point at it) as the
--    month's latest version, and every earlier version is restored as its own
--    FINALIZED row marked legacy, with that version's calculation snapshots
--    (and, when the row was reopened but not recalculated since, the items --
--    they are the finalized results of the version before). Finalization and
--    reopen details come from the audit log.
-- 5. Triggers: a FINALIZED version can never be updated or deleted, nor its
--    items inserted, updated or deleted; snapshots can never be updated or
--    deleted. (TRUNCATE, used by the seed and the tests, is not affected.)

-- ── 1. Calculation runs ─────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "PayrollCalculationState" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "payroll_calculation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payroll_period_id" UUID NOT NULL,
    "state" "PayrollCalculationState" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "processed_workers" INTEGER NOT NULL DEFAULT 0,
    "total_workers" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "payroll_calculation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_calculation_runs_payroll_period_id_requested_at_idx" ON "payroll_calculation_runs"("payroll_period_id", "requested_at");

-- At most one active calculation per version.
CREATE UNIQUE INDEX "payroll_calculation_runs_one_active_per_period" ON "payroll_calculation_runs"("payroll_period_id") WHERE "state" IN ('QUEUED', 'RUNNING');

-- AddForeignKey
ALTER TABLE "payroll_calculation_runs" ADD CONSTRAINT "payroll_calculation_runs_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2-3. New columns ────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "payroll_calculation_snapshots" ADD COLUMN     "calculation_run_id" UUID,
ADD COLUMN     "inputs_hash" TEXT,
ADD COLUMN     "schema_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "totals_json" JSONB;

-- AlterTable
ALTER TABLE "payroll_items" ADD COLUMN     "approved_shifts" INTEGER,
ADD COLUMN     "forgotten_stamp_penalties_agorot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "other_deductions_agorot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reversals_agorot" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll_periods" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "current_snapshot_id" UUID,
ADD COLUMN     "legacy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "previous_version_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "payroll_calculation_snapshots_calculation_run_id_key" ON "payroll_calculation_snapshots"("calculation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_previous_version_id_key" ON "payroll_periods"("previous_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_current_snapshot_id_key" ON "payroll_periods"("current_snapshot_id");

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "payroll_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_current_snapshot_id_fkey" FOREIGN KEY ("current_snapshot_id") REFERENCES "payroll_calculation_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_snapshots" ADD CONSTRAINT "payroll_calculation_snapshots_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "payroll_calculation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Existing data ────────────────────────────────────────────────────

-- A calculation that crashed under the old synchronous engine left its row
-- CALCULATING: it is calculated if a snapshot of its version exists,
-- otherwise not calculated yet.
UPDATE "payroll_periods" AS p
SET "status" = CASE
  WHEN EXISTS (SELECT 1 FROM "payroll_calculation_snapshots" s WHERE s."payroll_period_id" = p."id" AND s."version" = p."version") THEN 'REVIEW'::"PayrollPeriodStatus"
  WHEN p."version" > 1 THEN 'REOPENED'::"PayrollPeriodStatus"
  ELSE 'OPEN'::"PayrollPeriodStatus"
END
WHERE p."status" = 'CALCULATING';

-- 4a. Restore every earlier version of a row reopened in place as its own
-- FINALIZED legacy row. Version k's finalization is the k-th PAYROLL_FINALIZED
-- audit row of the period, and version k+1's reopen the k-th
-- PAYROLL_PERIOD_REOPENED one (each version was finalized once, then reopened).
CREATE TEMP TABLE "_payroll_restored_versions" AS
WITH finalizations AS (
  SELECT "entity_id", "actor_user_id", "created_at",
         ROW_NUMBER() OVER (PARTITION BY "entity_id" ORDER BY "created_at", "id") AS n
  FROM "audit_logs" WHERE "action" = 'PAYROLL_FINALIZED' AND "entity_type" = 'PayrollPeriod'
),
reopens AS (
  SELECT "entity_id", "actor_user_id", "created_at", "reason",
         ROW_NUMBER() OVER (PARTITION BY "entity_id" ORDER BY "created_at", "id") AS n
  FROM "audit_logs" WHERE "action" = 'PAYROLL_PERIOD_REOPENED' AND "entity_type" = 'PayrollPeriod'
)
SELECT gen_random_uuid() AS "id",
       p."id" AS "source_id",
       p."organization_id",
       p."year_month",
       k AS "version",
       f."actor_user_id" AS "finalized_by",
       f."created_at" AS "finalized_at",
       r."actor_user_id" AS "reopened_by",
       r."created_at" AS "reopened_at",
       r."reason" AS "reopen_reason",
       COALESCE((SELECT MIN(s."calculated_at") FROM "payroll_calculation_snapshots" s WHERE s."payroll_period_id" = p."id" AND s."version" = k), p."created_at") AS "created_at"
FROM "payroll_periods" p
CROSS JOIN LATERAL generate_series(1, p."version" - 1) AS k
LEFT JOIN finalizations f ON f."entity_id" = p."id"::text AND f.n = k
LEFT JOIN reopens r ON r."entity_id" = p."id"::text AND r.n = k - 1
WHERE p."version" > 1;

INSERT INTO "payroll_periods" ("id", "organization_id", "year_month", "status", "version", "finalized_at", "finalized_by", "reopened_at", "reopened_by", "reopen_reason", "legacy", "created_at", "updated_at")
SELECT "id", "organization_id", "year_month", 'FINALIZED', "version", "finalized_at", "finalized_by",
       CASE WHEN "version" > 1 THEN "reopened_at" END, CASE WHEN "version" > 1 THEN "reopened_by" END, CASE WHEN "version" > 1 THEN "reopen_reason" END,
       true, "created_at", CURRENT_TIMESTAMP
FROM "_payroll_restored_versions";

-- Chain: version k+1 was reopened from version k.
UPDATE "payroll_periods" AS v
SET "previous_version_id" = prev."id"
FROM "_payroll_restored_versions" AS cur
JOIN "_payroll_restored_versions" AS prev ON prev."source_id" = cur."source_id" AND prev."version" = cur."version" - 1
WHERE v."id" = cur."id";

UPDATE "payroll_periods" AS p
SET "previous_version_id" = prev."id"
FROM "_payroll_restored_versions" AS prev
WHERE prev."source_id" = p."id" AND prev."version" = p."version" - 1;

-- Each version's calculation snapshots move to its row.
UPDATE "payroll_calculation_snapshots" AS s
SET "payroll_period_id" = r."id"
FROM "_payroll_restored_versions" AS r
WHERE s."payroll_period_id" = r."source_id" AND s."version" = r."version";

-- Reopened but not recalculated since: the items are the finalized results
-- of the version before.
UPDATE "payroll_items" AS i
SET "payroll_period_id" = r."id"
FROM "payroll_periods" AS p
JOIN "_payroll_restored_versions" AS r ON r."source_id" = p."id" AND r."version" = p."version" - 1
WHERE i."payroll_period_id" = p."id" AND p."status" = 'REOPENED';

-- The latest row's finalization fields described an earlier version unless it is itself finalized.
UPDATE "payroll_periods" SET "finalized_at" = NULL, "finalized_by" = NULL
WHERE "version" > 1 AND "legacy" = false AND "status" <> 'FINALIZED';

-- 4b. The calculation each version's items come from: its latest snapshot.
UPDATE "payroll_periods" AS p
SET "current_snapshot_id" = (
  SELECT s."id" FROM "payroll_calculation_snapshots" s
  WHERE s."payroll_period_id" = p."id" AND s."version" = p."version"
  ORDER BY s."calculated_at" DESC, s."id" DESC LIMIT 1
)
WHERE p."status" IN ('REVIEW', 'FINALIZED');

-- 4c. Item breakdown from the adjustments linked to each item (an item's
-- last calculation included, and linked, every adjustment of its worker and
-- month that existed then). Applied only where it reconciles with the stored
-- totals; otherwise all deductions stay "other deductions" and the bonuses
-- column keeps its old value, so the net is unchanged either way.
UPDATE "payroll_items" AS i
SET "forgotten_stamp_penalties_agorot" = CASE WHEN a."ok" THEN a."penalties" ELSE 0 END,
    "reversals_agorot" = CASE WHEN a."ok" THEN a."reversals" ELSE 0 END,
    "other_deductions_agorot" = CASE WHEN a."ok" THEN a."other" ELSE i."deductions_agorot" END,
    "positive_adjustments_agorot" = CASE WHEN a."ok" THEN a."bonuses" ELSE i."positive_adjustments_agorot" END
FROM (
  SELECT x.*, (x."bonuses" + x."reversals" = pi."positive_adjustments_agorot" AND x."penalties" + x."other" = pi."deductions_agorot") AS "ok"
  FROM (
    SELECT "payroll_item_id",
           COALESCE(-SUM("amount_agorot") FILTER (WHERE "type" = 'FORGOTTEN_STAMP_PENALTY'), 0)::int AS "penalties",
           COALESCE(SUM("amount_agorot") FILTER (WHERE "type" = 'FORGOTTEN_STAMP_REVERSAL'), 0)::int AS "reversals",
           COALESCE(-SUM("amount_agorot") FILTER (WHERE "type" = 'MANUAL_DEDUCTION'), 0)::int AS "other",
           COALESCE(SUM("amount_agorot") FILTER (WHERE "type" = 'MANUAL_BONUS'), 0)::int AS "bonuses"
    FROM "payroll_adjustments" WHERE "payroll_item_id" IS NOT NULL GROUP BY "payroll_item_id"
  ) x
  JOIN "payroll_items" pi ON pi."id" = x."payroll_item_id"
) AS a
WHERE a."payroll_item_id" = i."id";

-- Items without linked adjustments: every deduction they hold is "other".
UPDATE "payroll_items" AS i
SET "other_deductions_agorot" = i."deductions_agorot"
WHERE i."deductions_agorot" <> 0
  AND NOT EXISTS (SELECT 1 FROM "payroll_adjustments" a WHERE a."payroll_item_id" = i."id");

-- Approved shifts: the worker's entries among the calculation's time entry ids
-- (old snapshots stored the ids only).
UPDATE "payroll_items" AS i
SET "approved_shifts" = sub."count"
FROM (
  SELECT i2."id" AS "item_id", COUNT(te."id")::int AS "count"
  FROM "payroll_items" i2
  JOIN "payroll_periods" p ON p."id" = i2."payroll_period_id"
  JOIN "payroll_calculation_snapshots" s ON s."id" = p."current_snapshot_id"
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s."inputs_json" -> 'timeEntryIds', '[]'::jsonb)) AS e("id")
  JOIN "time_entries" te ON te."id"::text = e."id" AND te."worker_profile_id" = i2."worker_profile_id"
  GROUP BY i2."id"
) AS sub
WHERE sub."item_id" = i."id";

DROP TABLE "_payroll_restored_versions";

-- ── 5. Immutability ─────────────────────────────────────────────────────

CREATE FUNCTION "payroll_refuse_finalized_version_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payroll version % (%, version %) is finalized and cannot be changed; reopen it to create a new version',
    OLD."id", OLD."year_month", OLD."version" USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_periods_finalized_immutable"
BEFORE UPDATE OR DELETE ON "payroll_periods"
FOR EACH ROW WHEN (OLD."status" = 'FINALIZED')
EXECUTE FUNCTION "payroll_refuse_finalized_version_change"();

CREATE FUNCTION "payroll_items_refuse_finalized_change"() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (SELECT 1 FROM "payroll_periods" WHERE "id" = OLD."payroll_period_id" AND "status" = 'FINALIZED') THEN
    RAISE EXCEPTION 'payroll item % belongs to a finalized payroll version and cannot be changed', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (SELECT 1 FROM "payroll_periods" WHERE "id" = NEW."payroll_period_id" AND "status" = 'FINALIZED') THEN
    RAISE EXCEPTION 'payroll version % is finalized: no item can be added to it', NEW."payroll_period_id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_items_finalized_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "payroll_items"
FOR EACH ROW EXECUTE FUNCTION "payroll_items_refuse_finalized_change"();

CREATE FUNCTION "payroll_refuse_snapshot_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payroll calculation snapshot % is immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_calculation_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "payroll_calculation_snapshots"
FOR EACH ROW EXECUTE FUNCTION "payroll_refuse_snapshot_change"();
