/**
 * The load test (docs/scalability.md): measures login, clock-in, the heavy
 * lists, the live operations snapshot, a month's payroll calculation and a
 * ledger PDF against a running API filled by `pnpm load:generate`, and prints
 * the p95 of each. Exits 1 when an interactive endpoint's p95 is over 1 s.
 *
 *   RATE_LIMIT_PER_MINUTE=1000000 DEV_LOGIN_ENABLED=true APP_ENV=development PORT=3010 \
 *     DATABASE_URL=<...fieldmaster_load...> node dist/src/main.js          # the API
 *   API_URL=http://localhost:3010/api/v1 pnpm --filter @fieldmaster/api load:run
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const autocannon = require("autocannon") as (options: Record<string, unknown>, callback: () => void) => { on(event: string, listener: (...args: any[]) => void): void };

const API = process.env.API_URL ?? "http://localhost:3010/api/v1";
const OWNER_PHONE = "+972500000001";
const INTERACTIVE_P95_LIMIT_MS = 1000;
const LOGIN_SAMPLE = Number(process.env.LOAD_LOGIN_SAMPLE ?? 150);
const CLOCK_IN_SAMPLE = Number(process.env.LOAD_CLOCK_IN_SAMPLE ?? 400);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 20);
const GET_SECONDS = Number(process.env.LOAD_GET_SECONDS ?? 8);
const GET_CONNECTIONS = Number(process.env.LOAD_GET_CONNECTIONS ?? 10);

interface Result {
  name: string;
  kind: "interactive" | "job";
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errors: number;
  note?: string;
}
const results: Result[] = [];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
function summarize(name: string, kind: Result["kind"], timings: number[], errors: number, note?: string): Result {
  const sorted = [...timings].sort((a, b) => a - b);
  const result = { name, kind, samples: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted[sorted.length - 1] ?? 0, errors, note };
  results.push(result);
  console.log(`  ${name}: p50 ${result.p50.toFixed(0)} ms, p95 ${result.p95.toFixed(0)} ms, p99 ${result.p99.toFixed(0)} ms, max ${result.max.toFixed(0)} ms (${result.samples} samples, ${errors} errors)${note ? ` — ${note}` : ""}`);
  return result;
}

async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const started = performance.now();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, ms: performance.now() - started, body: (text ? JSON.parse(text) : null) as any };
}

/** Runs `task` over `items`, `concurrency` at a time. */
async function pool<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        await task(items[index], index);
      }
    }),
  );
}

const uuid = () => crypto.randomUUID();
const businessToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const monthBefore = () => {
  const [year, month] = businessToday().split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
};

async function devUsers() {
  const response = await call("GET", "/auth/dev/users");
  if (response.status !== 200) throw new Error(`GET /auth/dev/users answered ${response.status}: start the API with DEV_LOGIN_ENABLED=true and APP_ENV=development.`);
  return response.body as { membershipId: string; phoneNumber: string; role: string }[];
}
async function devLogin(membershipId: string): Promise<string> {
  const response = await call("POST", "/auth/dev/login", undefined, { membershipId });
  if (response.status !== 201) throw new Error(`Dev login answered ${response.status}`);
  return (response.body as { accessToken: string }).accessToken;
}

async function measureGet(name: string, path: string, token: string, note?: string) {
  const timings: number[] = [];
  let errors = 0;
  const instance = autocannon({ url: `${API}${path}`, connections: GET_CONNECTIONS, duration: GET_SECONDS, headers: { authorization: `Bearer ${token}` } }, () => undefined);
  instance.on("response", (_client: unknown, statusCode: number, _bytes: number, responseTime: number) => {
    if (statusCode !== 200) errors += 1;
    timings.push(responseTime);
  });
  await new Promise((resolve) => instance.on("done", resolve));
  const rps = (timings.length / GET_SECONDS).toFixed(0);
  summarize(name, "interactive", timings, errors, `${rps} req/s, ${GET_CONNECTIONS} connections${note ? `, ${note}` : ""}`);
}

async function waitFor<T>(label: string, read: () => Promise<{ done: boolean; value: T }>, timeoutMs = 600_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { done, value } = await read();
    if (done) return value;
    if (Date.now() > deadline) throw new Error(`${label} did not finish in time`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  console.log(`Load test against ${API}`);
  const health = await call("GET", "/health");
  if (health.status !== 200) throw new Error("The API does not answer /health.");
  const users = await devUsers();
  const owner = users.find((user) => user.phoneNumber === OWNER_PHONE);
  if (!owner) throw new Error("The Owner of the generated data is missing: run `pnpm load:generate` first.");
  const workers = users.filter((user) => user.role === "WORKER");
  console.log(`${workers.length} workers in the data.`);
  const ownerToken = await devLogin(owner.membershipId);

  // 1. Login: the real OTP flow (code request, then verification), many workers at once.
  console.log("Login (code request + verification):");
  const requestTimes: number[] = [];
  const verifyTimes: number[] = [];
  let loginErrors = 0;
  await pool(workers.slice(0, LOGIN_SAMPLE), CONCURRENCY, async (worker, index) => {
    const requested = await call("POST", "/auth/otp/request", undefined, { phoneNumber: worker.phoneNumber });
    requestTimes.push(requested.ms);
    const verified = await call("POST", "/auth/otp/verify", undefined, { phoneNumber: worker.phoneNumber, code: "123456", deviceId: `load-${index}`, platform: "ANDROID" });
    verifyTimes.push(verified.ms);
    if (requested.status !== 204 || verified.status !== 201) loginErrors += 1;
  });
  summarize("login: code request", "interactive", requestTimes, loginErrors);
  summarize("login: verification", "interactive", verifyTimes, loginErrors);

  // 2. Clock-in: each worker signs in (not measured), finds today's shift, and clocks in inside its geofence.
  console.log("Clock-in:");
  const clockInTimes: number[] = [];
  const shiftListTimes: number[] = [];
  let clockInErrors = 0;
  const today = businessToday();
  await pool(workers.slice(0, CLOCK_IN_SAMPLE), CONCURRENCY, async (worker) => {
    const token = await devLogin(worker.membershipId);
    const shifts = await call("GET", `/shifts?businessDate=${today}`, token);
    shiftListTimes.push(shifts.ms);
    const shift = (shifts.body as { id: string; site: { latitude: number; longitude: number } }[])[0];
    if (!shift) {
      clockInErrors += 1;
      return;
    }
    const clocked = await call(
      "POST",
      "/clock-events/clock-in",
      token,
      { shiftId: shift.id, deviceId: `load-${worker.phoneNumber}`, clientEventId: uuid(), deviceTimestamp: new Date().toISOString(), latitude: shift.site.latitude, longitude: shift.site.longitude, accuracyMeters: 10 },
      { "idempotency-key": uuid() },
    );
    clockInTimes.push(clocked.ms);
    if (clocked.status !== 201) clockInErrors += 1;
  });
  summarize("worker's shift list", "interactive", shiftListTimes, 0);
  summarize("clock-in", "interactive", clockInTimes, clockInErrors);

  // 3. The heavy reads, as the Owner, with real data behind them (66,500 entries, 400 workers on shift).
  console.log("Reads (Owner):");
  const month = monthBefore();
  await measureGet("attendance list (all, page 1)", "/attendance/entries?tab=ALL&pageSize=50", ownerToken);
  await measureGet("attendance list (a month, filtered)", `/attendance/entries?tab=APPROVED&from=${month}-01&to=${month}-28&pageSize=50`, ownerToken);
  await measureGet("operations snapshot", "/operations/live", ownerToken, "400 workers on shift");
  await measureGet("workers (page of 50)", "/workers?pageSize=50", ownerToken);
  await measureGet("workers (whole list)", "/workers", ownerToken, "500 rows");
  await measureGet("shifts (200 latest)", "/shifts", ownerToken);
  await measureGet("pending approvals (page of 50)", "/attendance-approvals/pending?pageSize=50", ownerToken);
  await measureGet("pending approvals (whole list)", "/attendance-approvals/pending", ownerToken, "2,500 rows");
  await measureGet("members (page of 50)", "/memberships?pageSize=50", ownerToken);
  await measureGet("members (whole list)", "/memberships", ownerToken, "501 rows");
  await measureGet("payroll dashboard (live month)", `/payroll-periods/${today.slice(0, 7)}/dashboard`, ownerToken);
  // The worst case: a whole month of approved attendance calculated live, against the month before it.
  await measureGet("payroll dashboard (a whole month, live)", `/payroll-periods/${month}/dashboard`, ownerToken, "11,000 entries");
  await measureGet("notifications", "/notifications", ownerToken);

  // 4. Payroll calculation of a whole month (a background job): from the request to SUCCEEDED.
  console.log("Jobs:");
  const calculate = async (yearMonth: string) => {
    const started = performance.now();
    const requested = await call("POST", `/payroll-periods/${yearMonth}/calculate`, ownerToken, {}, { "idempotency-key": uuid() });
    if (requested.status !== 202) throw new Error(`Calculate answered ${requested.status}: ${JSON.stringify(requested.body)}`);
    const runId = (requested.body as { id: string }).id;
    const run = await waitFor("payroll calculation", async () => {
      const state = await call("GET", `/payroll-periods/${yearMonth}/calculation`, ownerToken);
      const body = state.body as { id: string; state: string } | null;
      return { done: body?.id === runId && (body.state === "SUCCEEDED" || body.state === "FAILED"), value: body };
    });
    return { ms: performance.now() - started, state: run?.state ?? "?" };
  };
  const calculation = await calculate(month);
  summarize("payroll calculation (500 workers, a month)", "job", [calculation.ms], calculation.state === "SUCCEEDED" ? 0 : 1, calculation.state);

  // 5. A worker's ledger PDF (a background job: Chromium renders it).
  const ledgerTimes: number[] = [];
  let ledgerErrors = 0;
  const profiles = await call("GET", "/workers?pageSize=5", ownerToken);
  const workerIds = (profiles.body as { items: { id: string }[] }).items.slice(0, 3).map((worker) => worker.id);
  for (const workerProfileId of workerIds) {
    const started = performance.now();
    const created = await call("POST", "/reports", ownerToken, { reportType: "WORKER_ATTENDANCE_LEDGER", filters: { fromDate: `${month}-01`, toDate: `${month}-28`, workerProfileId } }, { "idempotency-key": uuid() });
    if (created.status !== 202) {
      ledgerErrors += 1;
      continue;
    }
    const reportId = (created.body as { id: string }).id;
    const finished = await waitFor("ledger PDF", async () => {
      const state = await call("GET", `/reports/${reportId}`, ownerToken);
      const body = state.body as { status: string };
      return { done: body.status === "READY" || body.status === "FAILED", value: body.status };
    });
    ledgerTimes.push(performance.now() - started);
    if (finished !== "READY") ledgerErrors += 1;
  }
  summarize("ledger PDF (one worker, a month)", "job", ledgerTimes, ledgerErrors);

  console.log("\n| What | p50 | p95 | p99 | errors |\n|---|---|---|---|---|");
  for (const row of results) console.log(`| ${row.name} | ${row.p50.toFixed(0)} ms | ${row.p95.toFixed(0)} ms | ${row.p99.toFixed(0)} ms | ${row.errors} |`);
  const slow = results.filter((row) => row.kind === "interactive" && row.p95 > INTERACTIVE_P95_LIMIT_MS);
  const failed = results.filter((row) => row.errors > 0);
  if (slow.length > 0) console.error(`\nOver ${INTERACTIVE_P95_LIMIT_MS} ms at p95: ${slow.map((row) => row.name).join(", ")}`);
  if (failed.length > 0) console.error(`Errors in: ${failed.map((row) => row.name).join(", ")}`);
  process.exit(slow.length > 0 || failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
