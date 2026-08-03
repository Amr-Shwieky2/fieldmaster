-- CreateEnum
CREATE TYPE "OfflineSyncEventStatus" AS ENUM ('PENDING', 'VERIFIED', 'FLAGGED', 'REJECTED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "device_public_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "device_public_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "event_count" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_events" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "client_event_id" TEXT NOT NULL,
    "event_type" "ClockEventType" NOT NULL,
    "device_timestamp" TIMESTAMP(3) NOT NULL,
    "status" "OfflineSyncEventStatus" NOT NULL DEFAULT 'PENDING',
    "signature_valid" BOOLEAN NOT NULL DEFAULT false,
    "rejection_reason" TEXT,
    "offline_event_age_seconds" INTEGER,
    "result_time_entry_id" UUID,
    "result_clock_event_id" UUID,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_public_keys_device_id_idx" ON "device_public_keys"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_public_keys_user_id_device_id_key" ON "device_public_keys"("user_id", "device_id");

-- CreateIndex
CREATE INDEX "offline_sync_batches_organization_id_worker_profile_id_idx" ON "offline_sync_batches"("organization_id", "worker_profile_id");

-- CreateIndex
CREATE INDEX "offline_sync_events_client_event_id_idx" ON "offline_sync_events"("client_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "offline_sync_events_batch_id_client_event_id_key" ON "offline_sync_events"("batch_id", "client_event_id");

-- AddForeignKey
ALTER TABLE "device_public_keys" ADD CONSTRAINT "device_public_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_batches" ADD CONSTRAINT "offline_sync_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_batches" ADD CONSTRAINT "offline_sync_batches_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_events" ADD CONSTRAINT "offline_sync_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "offline_sync_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

