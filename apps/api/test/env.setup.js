// `||=` so CI (which sets these via the job/service env, on the standard
// port with no host-Postgres conflict) isn't clobbered by this repo's local
// dev workaround of running Postgres on 5433 instead of 5432.
process.env.DATABASE_URL ||= "postgresql://fieldmaster:fieldmaster_dev_password@localhost:5433/fieldmaster_test?schema=public";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret";
process.env.JWT_ACCESS_TTL ||= "15m";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret";
process.env.JWT_REFRESH_TTL ||= "30d";
process.env.LOCAL_ENCRYPTION_KEY_BASE64 ||= "3flOAwkmbM8Wbu+jPivo+sMVLbSkA8+as2wLULpw16c=";
process.env.FIELDMASTER_TEST_OTP ||= "000000";
process.env.OTP_TTL_SECONDS ||= "300";
process.env.OTP_MAX_ATTEMPTS ||= "5";
process.env.DEVICE_TIME_DEVIATION_SECONDS ||= "120";
process.env.CORS_ORIGINS ||= "";
process.env.NODE_ENV ||= "test";
