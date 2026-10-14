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
process.env.CORS_ORIGINS ||= "";
process.env.NODE_ENV ||= "test";
// Dev login is OFF by default in tests; test/dev-login.e2e-spec.ts turns it on
// (and back off) explicitly for the cases that need it.
process.env.APP_ENV ||= "development";
process.env.DEV_LOGIN_ENABLED ||= "false";

// Node 19+ keeps client HTTP connections alive by default, and supertest starts and stops a listener per
// request on the same server object. Twice a POST came back with a 200 it could not have produced (never
// reproduced); a response read on a reused connection is the likely cause. One connection per request rules
// that out; the API's own answers are untouched.
const http = require("node:http");
http.globalAgent = new http.Agent({ keepAlive: false });
