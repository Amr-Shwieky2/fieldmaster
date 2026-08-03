-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'FIELD_MANAGER', 'WORKER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('INVITED', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CompensationType" AS ENUM ('DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('STANDARD', 'DAY_TURAN', 'NIGHT_TURAN', 'EMERGENCY_CALLOUT');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'OPEN', 'ACTIVE', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('GEOFENCED', 'FLEXI_CHECK');

-- CreateEnum
CREATE TYPE "ClockEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');

-- CreateEnum
CREATE TYPE "EventOrigin" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('ACTIVE', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CORRECTION_REQUESTED');

-- CreateEnum
CREATE TYPE "LocationValidationStatus" AS ENUM ('PASSED', 'FLAGGED', 'BLOCKED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "CorrectionReason" AS ENUM ('FORGOTTEN_CLOCK_IN', 'FORGOTTEN_CLOCK_OUT', 'DEVICE_FAILURE', 'BROKEN_PHONE', 'NO_CONNECTIVITY', 'SYSTEM_ERROR', 'MANAGER_INSTRUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "TuranType" AS ENUM ('DAY_TURAN', 'NIGHT_TURAN');

-- CreateEnum
CREATE TYPE "TuranStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'MISSED');

-- CreateEnum
CREATE TYPE "EmergencyAuthorizationSource" AS ENUM ('NIGHT_TURAN_ASSIGNMENT', 'MANUAL_MANAGER_AUTHORIZATION');

-- CreateEnum
CREATE TYPE "TemporaryPointStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'CALCULATING', 'REVIEW', 'FINALIZED', 'REOPENED');

-- CreateEnum
CREATE TYPE "PayrollAdjustmentType" AS ENUM ('FORGOTTEN_STAMP_PENALTY', 'FORGOTTEN_STAMP_REVERSAL', 'MANUAL_DEDUCTION', 'MANUAL_BONUS');

-- CreateEnum
CREATE TYPE "PayrollAdjustmentSource" AS ENUM ('SYSTEM', 'MANUAL');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CORRECTION');

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('CONSTRUCTION', 'TRAFFIC_CONTROL', 'TRAFFIC_SIGN', 'TRAFFIC_LIGHT_INSTALLATION', 'TRAFFIC_LIGHT_REPAIR', 'INSPECTION', 'MAINTENANCE', 'EMERGENCY_REPAIR', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WORKER_CLOCKED_IN', 'WORKER_CLOCKED_OUT', 'OVERTIME_THRESHOLD_CROSSED', 'EMERGENCY_SHIFT_STARTED', 'EMERGENCY_SHIFT_ENDED', 'SHIFT_AWAITING_APPROVAL', 'SHIFT_APPROVED', 'SHIFT_REJECTED', 'ONBOARDING_SUBMITTED', 'WORKER_APPROVED', 'TURAN_ASSIGNMENT_CREATED', 'TURAN_ASSIGNMENT_CHANGED', 'TEMPORARY_CHECK_IN_POINT_OPENED', 'PAYROLL_FINALIZED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "auto_deduct_unpaid_breaks" BOOLEAN NOT NULL DEFAULT false,
    "standard_day_minutes" INTEGER NOT NULL DEFAULT 540,
    "device_time_deviation_seconds" INTEGER NOT NULL DEFAULT 120,
    "onboarding_invitation_ttl_hours" INTEGER NOT NULL DEFAULT 72,
    "default_language" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "full_legal_name" TEXT NOT NULL,
    "preferred_name" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL,
    "is_time_trackable" BOOLEAN NOT NULL DEFAULT false,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_profiles" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "government_id_type" TEXT,
    "profile_photo_url" TEXT,
    "consent_accepted_at" TIMESTAMP(3),
    "privacy_notice_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encrypted_bank_accounts" (
    "id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "encryption_key_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encrypted_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_documents" (
    "id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "encryption_key_id" TEXT NOT NULL,
    "file_storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensation_profiles" (
    "id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "compensation_type" "CompensationType" NOT NULL,
    "daily_base_rate_agorot" INTEGER,
    "base_hourly_rate_agorot" INTEGER,
    "overtime_hourly_rate_agorot" INTEGER NOT NULL,
    "effective_start_date" DATE NOT NULL,
    "effective_end_date" DATE,
    "change_reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compensation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefilled_phone_number" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "os_version" TEXT,
    "push_token" TEXT,
    "last_active_at" TIMESTAMP(3),
    "attestation_state" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "risk_state" TEXT NOT NULL DEFAULT 'NORMAL',
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token_families" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "current_token_hash" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_token_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "client" TEXT,
    "project_code" TEXT NOT NULL,
    "description" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "budget_agorot" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "default_geofence_radius_meters" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "instructions" TEXT,
    "emergency_contact" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "center_latitude" DOUBLE PRECISION NOT NULL,
    "center_longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "min_accuracy_meters" INTEGER NOT NULL DEFAULT 50,
    "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_to" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "site_id" UUID,
    "geofence_id" UUID,
    "shift_type" "ShiftType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "check_in_method" "CheckInMethod" NOT NULL DEFAULT 'GEOFENCED',
    "grace_minutes" INTEGER NOT NULL DEFAULT 10,
    "business_date" TEXT NOT NULL,
    "manager_id" UUID NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "flagged_long_running" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "closed_by" UUID,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_supervisor_assignments" (
    "id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "assigned_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temporary_supervisor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_check_in_points" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "status" "TemporaryPointStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "manager_authorized_by" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temporary_check_in_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turan_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "turan_type" "TuranType" NOT NULL,
    "status" "TuranStatus" NOT NULL DEFAULT 'SCHEDULED',
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "assigned_worker_profile_id" UUID NOT NULL,
    "backup_worker_profile_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turan_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_callouts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "turan_assignment_id" UUID,
    "worker_profile_id" UUID NOT NULL,
    "time_entry_id" UUID,
    "authorization_source" "EmergencyAuthorizationSource" NOT NULL,
    "authorized_by" UUID,
    "actual_start_click" TIMESTAMP(3) NOT NULL,
    "compensated_start" TIMESTAMP(3) NOT NULL,
    "actual_end_click" TIMESTAMP(3),
    "compensated_end" TIMESTAMP(3),
    "actual_worked_minutes" INTEGER,
    "retroactive_minutes" INTEGER NOT NULL DEFAULT 60,
    "return_buffer_minutes" INTEGER,
    "compensated_duration_minutes" INTEGER,
    "start_latitude" DOUBLE PRECISION NOT NULL,
    "start_longitude" DOUBLE PRECISION NOT NULL,
    "end_latitude" DOUBLE PRECISION,
    "end_longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_callouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_date" TEXT NOT NULL,
    "clock_in_at" TIMESTAMP(3),
    "clock_out_at" TIMESTAMP(3),
    "check_in_method" "CheckInMethod" NOT NULL,
    "flexi_check_enabled_by" UUID,
    "flexi_check_reason" TEXT,
    "raw_duration_minutes" INTEGER,
    "unpaid_break_minutes" INTEGER NOT NULL DEFAULT 0,
    "approved_regular_minutes" INTEGER,
    "approved_overtime_minutes" INTEGER,
    "full_day_credit" BOOLEAN NOT NULL DEFAULT false,
    "full_day_credit_reason" TEXT,
    "full_day_credit_by" UUID,
    "full_day_credit_at" TIMESTAMP(3),
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "payroll_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clock_events" (
    "id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "event_type" "ClockEventType" NOT NULL,
    "origin" "EventOrigin" NOT NULL DEFAULT 'ONLINE',
    "idempotency_key" TEXT NOT NULL,
    "device_id" TEXT,
    "client_event_id" TEXT NOT NULL,
    "device_timestamp" TIMESTAMP(3) NOT NULL,
    "server_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_time_deviation_seconds" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy_meters" DOUBLE PRECISION NOT NULL,
    "altitude" DOUBLE PRECISION,
    "location_provider" TEXT,
    "mock_location_suspected" BOOLEAN NOT NULL DEFAULT false,
    "distance_from_site_meters" DOUBLE PRECISION,
    "location_validation_status" "LocationValidationStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "app_version" TEXT,
    "is_manual_correction" BOOLEAN NOT NULL DEFAULT false,
    "corrected_by" UUID,
    "correction_reason" "CorrectionReason",
    "correction_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unpaid_breaks" (
    "id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'MANAGER',
    "created_by" UUID NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unpaid_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_summaries" (
    "id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "text" TEXT,
    "voice_note_url" TEXT,
    "transcription" TEXT,
    "task_category" "TaskCategory" NOT NULL,
    "materials_used" TEXT,
    "problems_encountered" TEXT,
    "follow_up_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_approvals" (
    "id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "acted_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_time_corrections" (
    "id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" "CorrectionReason" NOT NULL,
    "note" TEXT,
    "edited_by" UUID NOT NULL,
    "request_ip" TEXT,
    "user_agent" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_time_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forgotten_stamp_infractions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "correction_id" UUID NOT NULL,
    "business_month" TEXT NOT NULL,
    "monthly_sequence_number" INTEGER NOT NULL,
    "deduction_agorot" INTEGER NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "reversal_adjustment_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forgotten_stamp_infractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "year_month" TEXT NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "finalized_at" TIMESTAMP(3),
    "finalized_by" UUID,
    "reopened_at" TIMESTAMP(3),
    "reopened_by" UUID,
    "reopen_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL,
    "payroll_period_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "standard_days_credited" INTEGER NOT NULL DEFAULT 0,
    "regular_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "emergency_retroactive_minutes" INTEGER NOT NULL DEFAULT 0,
    "emergency_return_minutes" INTEGER NOT NULL DEFAULT 0,
    "gross_base_agorot" INTEGER NOT NULL DEFAULT 0,
    "overtime_agorot" INTEGER NOT NULL DEFAULT 0,
    "positive_adjustments_agorot" INTEGER NOT NULL DEFAULT 0,
    "deductions_agorot" INTEGER NOT NULL DEFAULT 0,
    "net_payable_agorot" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "payroll_item_id" UUID NOT NULL,
    "type" "PayrollAdjustmentType" NOT NULL,
    "source" "PayrollAdjustmentSource" NOT NULL,
    "amount_agorot" INTEGER NOT NULL,
    "reason" TEXT,
    "related_infraction_id" UUID,
    "reversal_of_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_calculation_snapshots" (
    "id" UUID NOT NULL,
    "payroll_period_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "inputs_json" JSONB NOT NULL,
    "result_json" JSONB NOT NULL,
    "calculated_by" UUID NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_calculation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "request_ip" TEXT,
    "user_agent" TEXT,
    "correlation_id" TEXT NOT NULL,
    "previous_hash" TEXT NOT NULL,
    "current_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data_json" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organization_id_key" ON "organization_settings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "organization_memberships_organization_id_role_status_idx" ON "organization_memberships"("organization_id", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_profiles_membership_id_key" ON "worker_profiles"("membership_id");

-- CreateIndex
CREATE INDEX "worker_profiles_organization_id_idx" ON "worker_profiles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "encrypted_bank_accounts_worker_profile_id_key" ON "encrypted_bank_accounts"("worker_profile_id");

-- CreateIndex
CREATE INDEX "identity_documents_worker_profile_id_idx" ON "identity_documents"("worker_profile_id");

-- CreateIndex
CREATE INDEX "compensation_profiles_worker_profile_id_effective_start_dat_idx" ON "compensation_profiles"("worker_profile_id", "effective_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_invitations_token_hash_key" ON "onboarding_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "onboarding_invitations_organization_id_idx" ON "onboarding_invitations"("organization_id");

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "user_devices"("user_id");

-- CreateIndex
CREATE INDEX "refresh_token_families_user_id_idx" ON "refresh_token_families"("user_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_project_code_key" ON "projects"("organization_id", "project_code");

-- CreateIndex
CREATE INDEX "sites_organization_id_active_idx" ON "sites"("organization_id", "active");

-- CreateIndex
CREATE INDEX "geofences_site_id_idx" ON "geofences"("site_id");

-- CreateIndex
CREATE INDEX "shifts_organization_id_status_idx" ON "shifts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "shifts_organization_id_business_date_idx" ON "shifts"("organization_id", "business_date");

-- CreateIndex
CREATE INDEX "shift_assignments_worker_profile_id_idx" ON "shift_assignments"("worker_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignments_shift_id_worker_profile_id_key" ON "shift_assignments"("shift_id", "worker_profile_id");

-- CreateIndex
CREATE INDEX "temporary_supervisor_assignments_shift_id_idx" ON "temporary_supervisor_assignments"("shift_id");

-- CreateIndex
CREATE INDEX "temporary_supervisor_assignments_worker_profile_id_idx" ON "temporary_supervisor_assignments"("worker_profile_id");

-- CreateIndex
CREATE INDEX "temporary_check_in_points_shift_id_status_idx" ON "temporary_check_in_points"("shift_id", "status");

-- CreateIndex
CREATE INDEX "turan_assignments_organization_id_turan_type_start_at_idx" ON "turan_assignments"("organization_id", "turan_type", "start_at");

-- CreateIndex
CREATE INDEX "turan_assignments_assigned_worker_profile_id_start_at_idx" ON "turan_assignments"("assigned_worker_profile_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_callouts_time_entry_id_key" ON "emergency_callouts"("time_entry_id");

-- CreateIndex
CREATE INDEX "emergency_callouts_organization_id_idx" ON "emergency_callouts"("organization_id");

-- CreateIndex
CREATE INDEX "emergency_callouts_worker_profile_id_idx" ON "emergency_callouts"("worker_profile_id");

-- CreateIndex
CREATE INDEX "time_entries_organization_id_status_idx" ON "time_entries"("organization_id", "status");

-- CreateIndex
CREATE INDEX "time_entries_worker_profile_id_business_date_idx" ON "time_entries"("worker_profile_id", "business_date");

-- CreateIndex
CREATE INDEX "clock_events_time_entry_id_idx" ON "clock_events"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "clock_events_device_id_client_event_id_key" ON "clock_events"("device_id", "client_event_id");

-- CreateIndex
CREATE INDEX "unpaid_breaks_time_entry_id_idx" ON "unpaid_breaks"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_summaries_time_entry_id_key" ON "daily_summaries"("time_entry_id");

-- CreateIndex
CREATE INDEX "attendance_approvals_time_entry_id_idx" ON "attendance_approvals"("time_entry_id");

-- CreateIndex
CREATE INDEX "manual_time_corrections_time_entry_id_idx" ON "manual_time_corrections"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "forgotten_stamp_infractions_correction_id_key" ON "forgotten_stamp_infractions"("correction_id");

-- CreateIndex
CREATE INDEX "forgotten_stamp_infractions_worker_profile_id_business_mont_idx" ON "forgotten_stamp_infractions"("worker_profile_id", "business_month");

-- CreateIndex
CREATE INDEX "payroll_periods_organization_id_year_month_idx" ON "payroll_periods"("organization_id", "year_month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_organization_id_year_month_version_key" ON "payroll_periods"("organization_id", "year_month", "version");

-- CreateIndex
CREATE INDEX "payroll_items_worker_profile_id_idx" ON "payroll_items"("worker_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_payroll_period_id_worker_profile_id_key" ON "payroll_items"("payroll_period_id", "worker_profile_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_payroll_item_id_idx" ON "payroll_adjustments"("payroll_item_id");

-- CreateIndex
CREATE INDEX "payroll_calculation_snapshots_payroll_period_id_idx" ON "payroll_calculation_snapshots"("payroll_period_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_recipient_user_id_read_at_idx" ON "notifications"("organization_id", "recipient_user_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_key_route_key" ON "idempotency_records"("key", "route");

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_bank_accounts" ADD CONSTRAINT "encrypted_bank_accounts_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_profiles" ADD CONSTRAINT "compensation_profiles_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_supervisor_assignments" ADD CONSTRAINT "temporary_supervisor_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_supervisor_assignments" ADD CONSTRAINT "temporary_supervisor_assignments_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_check_in_points" ADD CONSTRAINT "temporary_check_in_points_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_check_in_points" ADD CONSTRAINT "temporary_check_in_points_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turan_assignments" ADD CONSTRAINT "turan_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turan_assignments" ADD CONSTRAINT "turan_assignments_assigned_worker_profile_id_fkey" FOREIGN KEY ("assigned_worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turan_assignments" ADD CONSTRAINT "turan_assignments_backup_worker_profile_id_fkey" FOREIGN KEY ("backup_worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_callouts" ADD CONSTRAINT "emergency_callouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_callouts" ADD CONSTRAINT "emergency_callouts_turan_assignment_id_fkey" FOREIGN KEY ("turan_assignment_id") REFERENCES "turan_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_callouts" ADD CONSTRAINT "emergency_callouts_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_callouts" ADD CONSTRAINT "emergency_callouts_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unpaid_breaks" ADD CONSTRAINT "unpaid_breaks_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_approvals" ADD CONSTRAINT "attendance_approvals_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_time_corrections" ADD CONSTRAINT "manual_time_corrections_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forgotten_stamp_infractions" ADD CONSTRAINT "forgotten_stamp_infractions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forgotten_stamp_infractions" ADD CONSTRAINT "forgotten_stamp_infractions_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forgotten_stamp_infractions" ADD CONSTRAINT "forgotten_stamp_infractions_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forgotten_stamp_infractions" ADD CONSTRAINT "forgotten_stamp_infractions_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "manual_time_corrections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_item_id_fkey" FOREIGN KEY ("payroll_item_id") REFERENCES "payroll_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_related_infraction_id_fkey" FOREIGN KEY ("related_infraction_id") REFERENCES "forgotten_stamp_infractions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_snapshots" ADD CONSTRAINT "payroll_calculation_snapshots_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

