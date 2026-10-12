-- Step 6: temporary supervisors, live operations, settings, users and devices.
--
-- 1. NotificationType TEMPORARY_SUPERVISOR_ISSUE_REPORTED: a temporary
--    supervisor's issue report to the shift's manager and the Owners.
-- 2. organization_settings: defaults the API used to hard-code (shift grace
--    minutes, site radius, GPS accuracy, temporary point radius/accuracy) and
--    the notification preferences. The defaults are the old constants, so
--    nothing changes until an Owner edits them.
-- 3. refresh_token_families.membership_id: the membership a session belongs to
--    (refresh keeps it; suspending or archiving a member ends exactly these
--    sessions). Existing sessions of users with a single membership are
--    backfilled; a multi-organization user's older sessions stay NULL.
--    last_used_at: last sign-in or refresh (the member's "last active").
-- 4. temporary_supervisor_assignments.can_open_check_in_points: existing
--    assignments keep today's behavior (true).
-- 5. time_entries.long_open_notified_at: the "open for more than 9 hours"
--    alert is sent once per entry.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TEMPORARY_SUPERVISOR_ISSUE_REPORTED';

-- AlterTable
ALTER TABLE "organization_settings" ADD COLUMN     "default_geofence_radius_meters" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "default_grace_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "default_min_gps_accuracy_meters" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "notification_preferences" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "temporary_point_min_accuracy_meters" INTEGER NOT NULL DEFAULT 75,
ADD COLUMN     "temporary_point_radius_meters" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "refresh_token_families" ADD COLUMN     "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "membership_id" UUID;

-- AlterTable
ALTER TABLE "temporary_supervisor_assignments" ADD COLUMN     "can_open_check_in_points" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "long_open_notified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "refresh_token_families_membership_id_idx" ON "refresh_token_families"("membership_id");

-- AddForeignKey
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: a session of a user with exactly one membership belongs to it.
UPDATE "refresh_token_families" AS f
SET "membership_id" = m."id"
FROM "organization_memberships" AS m
WHERE f."membership_id" IS NULL
  AND m."user_id" = f."user_id"
  AND (SELECT COUNT(*) FROM "organization_memberships" AS m2 WHERE m2."user_id" = f."user_id") = 1;

-- Backfill: an existing session was last used at its last rotation.
UPDATE "refresh_token_families" SET "last_used_at" = "updated_at";
