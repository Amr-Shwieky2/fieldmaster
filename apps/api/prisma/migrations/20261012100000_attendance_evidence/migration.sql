-- Attendance evidence for the Step 5 detail page.
--
-- 1. clock_events.temporary_check_in_point_id: the temporary check-in point a
--    clock-in was validated against (NULL for the geofence or Flexi-Check).
-- 2. rejected_clock_attempts: clock-ins/clock-outs the server refused for the
--    phone's location or clock (outside the geofence, GPS accuracy too low,
--    device clock off, mock location). The worker still gets the same error;
--    these rows are what managers see as rejected attempts on the map.
-- AlterTable
ALTER TABLE "clock_events" ADD COLUMN     "temporary_check_in_point_id" UUID;

-- CreateTable
CREATE TABLE "rejected_clock_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "time_entry_id" UUID,
    "event_type" "ClockEventType" NOT NULL,
    "origin" "EventOrigin" NOT NULL,
    "code" TEXT NOT NULL,
    "device_timestamp" TIMESTAMP(3) NOT NULL,
    "server_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviation_seconds" INTEGER,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy_meters" DOUBLE PRECISION NOT NULL,
    "mock_location_suspected" BOOLEAN NOT NULL DEFAULT false,
    "distance_meters" DOUBLE PRECISION,
    "allowed_radius_meters" INTEGER,
    "required_accuracy_meters" INTEGER,
    "temporary_check_in_point_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_clock_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rejected_clock_attempts_organization_id_shift_id_idx" ON "rejected_clock_attempts"("organization_id", "shift_id");

-- CreateIndex
CREATE INDEX "rejected_clock_attempts_worker_profile_id_shift_id_idx" ON "rejected_clock_attempts"("worker_profile_id", "shift_id");

-- CreateIndex
CREATE INDEX "rejected_clock_attempts_time_entry_id_idx" ON "rejected_clock_attempts"("time_entry_id");

-- AddForeignKey
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_temporary_check_in_point_id_fkey" FOREIGN KEY ("temporary_check_in_point_id") REFERENCES "temporary_check_in_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_clock_attempts" ADD CONSTRAINT "rejected_clock_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_clock_attempts" ADD CONSTRAINT "rejected_clock_attempts_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_clock_attempts" ADD CONSTRAINT "rejected_clock_attempts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_clock_attempts" ADD CONSTRAINT "rejected_clock_attempts_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_clock_attempts" ADD CONSTRAINT "rejected_clock_attempts_temporary_check_in_point_id_fkey" FOREIGN KEY ("temporary_check_in_point_id") REFERENCES "temporary_check_in_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

