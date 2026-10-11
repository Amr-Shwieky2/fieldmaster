-- Marks a time entry whose clock-in was moved back by the test-mode rewind
-- (POST /api/v1/dev/time-entries/:id/rewind, only while dev login mode is
-- on). NULL for every real entry; the admin web shows a "test edit" badge
-- when it is set, and the old/new values are in the DEV_REWIND audit event.
ALTER TABLE "time_entries" ADD COLUMN "dev_rewound_at" TIMESTAMP(3);
