-- Step 8: Arabic PDF reports as background jobs, and complete worker onboarding.
--
-- 1. generated_reports: the BullMQ job's state (status, progress, error,
--    start/finish, idempotency key), the CSV file next to the PDF, and the
--    SHA-256 of each stored file (`GET /reports/:id/verify` recomputes them).
--    Reports generated before Step 8 were synchronous, so they are READY.
--    The data hash and the PDF key become nullable: a queued report has
--    neither yet.
-- 2. file_assets: uploaded files in private object storage (type detected
--    from the content, metadata stripped, malware-scan hook result).
-- 3. identity_documents.file_asset_id replaces file_storage_key. Nothing
--    wrote to identity_documents before this step (see technical-decisions.md,
--    "Onboarding invitation does not collect a government ID number"), so the
--    old column holds no data.
-- 4. worker_profiles.profile_photo_asset_id; onboarding_invitations.revoked_by
--    and redeemed_worker_profile_id.

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "FileAssetPurpose" AS ENUM ('IDENTITY_DOCUMENT', 'PROFILE_PHOTO');

-- AlterTable
ALTER TABLE "generated_reports" ADD COLUMN     "csv_sha256" TEXT,
ADD COLUMN     "csv_storage_key" TEXT,
ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "finished_at" TIMESTAMP(3),
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "page_count" INTEGER,
ADD COLUMN     "pdf_sha256" TEXT,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "status" "ReportStatus" NOT NULL DEFAULT 'READY',
ALTER COLUMN "sha256_hash" DROP NOT NULL,
ALTER COLUMN "storage_key" DROP NOT NULL;

-- AlterTable
ALTER TABLE "identity_documents" DROP COLUMN "file_storage_key",
ADD COLUMN     "file_asset_id" UUID;

-- AlterTable
ALTER TABLE "onboarding_invitations" ADD COLUMN     "redeemed_worker_profile_id" UUID,
ADD COLUMN     "revoked_by" UUID;

-- AlterTable
ALTER TABLE "worker_profiles" ADD COLUMN     "profile_photo_asset_id" UUID;

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purpose" "FileAssetPurpose" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scan_result" TEXT NOT NULL,
    "invitation_id" UUID,
    "worker_profile_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_storage_key_key" ON "file_assets"("storage_key");

-- CreateIndex
CREATE INDEX "file_assets_organization_id_idx" ON "file_assets"("organization_id");

-- CreateIndex
CREATE INDEX "file_assets_invitation_id_idx" ON "file_assets"("invitation_id");

-- CreateIndex
CREATE INDEX "file_assets_worker_profile_id_idx" ON "file_assets"("worker_profile_id");

-- CreateIndex
CREATE INDEX "generated_reports_organization_id_generated_at_idx" ON "generated_reports"("organization_id", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "identity_documents_file_asset_id_key" ON "identity_documents"("file_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_profiles_profile_photo_asset_id_key" ON "worker_profiles"("profile_photo_asset_id");

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_profile_photo_asset_id_fkey" FOREIGN KEY ("profile_photo_asset_id") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

