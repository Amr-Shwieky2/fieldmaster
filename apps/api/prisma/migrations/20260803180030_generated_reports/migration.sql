-- CreateTable
CREATE TABLE "generated_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "report_type" TEXT NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "subject_worker_profile_id" UUID,
    "filters_json" JSONB NOT NULL,
    "includes_financials" BOOLEAN NOT NULL DEFAULT false,
    "template_version" TEXT NOT NULL,
    "sha256_hash" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_reports_organization_id_subject_worker_profile_id_idx" ON "generated_reports"("organization_id", "subject_worker_profile_id");

