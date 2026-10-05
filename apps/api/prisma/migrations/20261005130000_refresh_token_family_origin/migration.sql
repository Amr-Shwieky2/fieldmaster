-- How a session started (OTP | DEV_LOGIN | DEV_FIXED_OTP). Sessions created
-- through the test login are rejected on refresh once dev login mode is off.
-- Existing families predate the test login, so they are all real OTP logins.
ALTER TABLE "refresh_token_families" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'OTP';
