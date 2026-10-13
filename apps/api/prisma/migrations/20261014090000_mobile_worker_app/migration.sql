-- Step 9: the mobile worker app. Additive only; nothing existing changes.
--
-- 1. FileAssetPurpose gains ATTENDANCE_PHOTO and VOICE_SUMMARY: files a
--    signed-in worker uploads from the app (POST /attachments), private like
--    the onboarding uploads. file_assets.time_entry_id links them to the
--    entry whose clock-in or clock-out used them.
-- 2. daily_summaries.voice_note_asset_id (the recorded summary) and
--    summary_source (TYPED or VOICE). `text` keeps the summary as sent
--    (typed, or the transcript after the worker's edits); `transcription`
--    keeps the transcript as the service returned it.
-- 3. clock_events.mock_location_state (DETECTED / NOT_DETECTED / UNAVAILABLE,
--    as the phone reported it) and location_signals (movement heuristics
--    recorded for review); rejected_clock_attempts.mock_location_state.
--    Null / empty for events before Step 9.
-- 4. organization_memberships.notification_preferences: the member's own
--    push preferences ({} = the defaults).

ALTER TYPE "FileAssetPurpose" ADD VALUE 'ATTENDANCE_PHOTO';
ALTER TYPE "FileAssetPurpose" ADD VALUE 'VOICE_SUMMARY';

-- AlterTable
ALTER TABLE "clock_events" ADD COLUMN     "location_signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mock_location_state" TEXT;

-- AlterTable
ALTER TABLE "daily_summaries" ADD COLUMN     "summary_source" TEXT,
ADD COLUMN     "voice_note_asset_id" UUID;

-- AlterTable
ALTER TABLE "file_assets" ADD COLUMN     "time_entry_id" UUID;

-- AlterTable
ALTER TABLE "organization_memberships" ADD COLUMN     "notification_preferences" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "rejected_clock_attempts" ADD COLUMN     "mock_location_state" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "daily_summaries_voice_note_asset_id_key" ON "daily_summaries"("voice_note_asset_id");

-- CreateIndex
CREATE INDEX "file_assets_time_entry_id_idx" ON "file_assets"("time_entry_id");

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_voice_note_asset_id_fkey" FOREIGN KEY ("voice_note_asset_id") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

