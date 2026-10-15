-- Mobile manager mode: actionable notifications and stored supervisor
-- reports; every organization gets its first work-rule version.

-- CreateEnum
CREATE TYPE "NotificationSubjectKind" AS ENUM ('ATTENDANCE', 'OFFLINE_REVIEW', 'ONBOARDING', 'SUPERVISOR_ISSUE');

-- CreateEnum
CREATE TYPE "NotificationHandledOutcome" AS ENUM ('APPROVED', 'REJECTED', 'FULL_DAY_CREDIT', 'CORRECTION_REQUESTED', 'CORRECTED', 'RESOLVED', 'REVIEWED', 'WORKER_APPROVED', 'WORKER_REJECTED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "subject_id" UUID;

-- CreateTable
CREATE TABLE "notification_subjects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "NotificationSubjectKind" NOT NULL,
    "ref_id" UUID NOT NULL,
    "handled_at" TIMESTAMP(3),
    "handled_by" UUID,
    "handled_outcome" "NotificationHandledOutcome",
    "handled_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisor_issue_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisor_issue_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_subjects_organization_id_kind_ref_id_key" ON "notification_subjects"("organization_id", "kind", "ref_id");

-- CreateIndex
CREATE INDEX "supervisor_issue_reports_organization_id_created_at_idx" ON "supervisor_issue_reports"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "supervisor_issue_reports_assignment_id_idx" ON "supervisor_issue_reports"("assignment_id");

-- CreateIndex
CREATE INDEX "supervisor_issue_reports_shift_id_idx" ON "supervisor_issue_reports"("shift_id");

-- CreateIndex
CREATE INDEX "notifications_subject_id_idx" ON "notifications"("subject_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "notification_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_subjects" ADD CONSTRAINT "notification_subjects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_issue_reports" ADD CONSTRAINT "supervisor_issue_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_issue_reports" ADD CONSTRAINT "supervisor_issue_reports_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "temporary_supervisor_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_issue_reports" ADD CONSTRAINT "supervisor_issue_reports_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every organization has stored work rules: its first version (version 1,
-- effective 2000-01-01, the values the system used until now). From here on
-- nothing is priced with default values; a new organization gets its first
-- version the first time its rules are read (WorkRulesService).
INSERT INTO "work_rule_versions" (
    "id", "organization_id", "version", "effective_from",
    "standard_day_minutes", "overtime_threshold_minutes", "free_forgotten_stamps_per_month", "forgotten_stamp_penalty_agorot",
    "emergency_minutes_before", "emergency_minutes_after", "clock_in_early_window_minutes",
    "reason", "created_by"
)
SELECT gen_random_uuid(), o."id", 1, '2000-01-01', 540, 540, 2, 1000, 60, 15, 60, 'القيم الأصلية', NULL
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "work_rule_versions" v WHERE v."organization_id" = o."id");
