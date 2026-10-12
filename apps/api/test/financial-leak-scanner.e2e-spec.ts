import { get as httpGet, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, SSE_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { io, type Socket } from "socket.io-client";
import { v7 as uuidv7 } from "uuid";
import { CorrectionReason, NotificationType, TuranType } from "@fieldmaster/shared-types";
import { createTestApp, resetDatabase, request } from "./test-app";
import { useEnv } from "./use-env";
import {
  addFieldManager,
  addWorker,
  assignWorkerToShift,
  createOrgWithOwner,
  createProject,
  createSiteWithGeofence,
  createStandardShift,
} from "./fixtures";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";

/**
 * Financial leak scanner (spec sections 6.2 / 23.5).
 *
 * Signs in (dev login) as a Field Manager and as a Worker, calls every GET
 * route the app exposes -- discovered from Nest's route metadata, so a new
 * route is scanned without anyone adding it here -- and fails with the route
 * and JSON path of every money or bank key in any response. The notification
 * WebSocket and SSE payloads a Field Manager receives are scanned the same way.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";
const OTHER_WORKER_PHONE = "+972500010002";

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center: inside the 100 m geofence.
const NEARBY_LAT = 32.0858;

const PROJECT_BUDGET_AGOROT = 50_000_000;

/**
 * A key is forbidden if it ends in "Agorot" or "rate" (rate, hourlyRate,
 * dailyRate, overtimeRate, ...) or contains one of these words, case-insensitively.
 */
const FORBIDDEN_KEY_PARTS = ["budget", "bank", "accountnumber", "branch", "netpay", "grosspay", "estimatedcost", "amount"];

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.endsWith("agorot") || lower.endsWith("rate") || FORBIDDEN_KEY_PARTS.some((part) => lower.includes(part));
}

/** JSON paths (e.g. `$[0].project.budgetAgorot`) of every forbidden key in `value`, at any depth. */
function findForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(isForbiddenKey(key) ? [`${path}.${key}`] : []),
    ...findForbiddenKeys(nested, `${path}.${key}`),
  ]);
}

/**
 * The only routes where a Worker legitimately receives money: their OWN. They
 * are skipped by the scan and checked separately below to contain only the
 * caller's own data.
 */
const WORKER_OWN_MONEY_ROUTES = new Set([
  // The Worker's own rate history; any other worker's id is 403.
  "GET /api/v1/workers/:id/compensation-profiles",
  // The Worker's own payslip; the route takes no worker id at all.
  "GET /api/v1/payroll-periods/:yearMonth/my-payslip",
]);

/**
 * Routes allowed to answer something other than 200 or 403 for a role. Any
 * other status means the scan did not really read the route (a wrong seeded
 * id, a crash), so the test fails instead of passing on an error body.
 */
const EXPECTED_NOT_FOUND = {
  // A Field Manager who is not time-trackable has no worker profile, so no payslip.
  manager: new Set(["GET /api/v1/payroll-periods/:yearMonth/my-payslip"]),
  worker: new Set<string>(),
};

interface GetRoute {
  /** e.g. "GET /api/v1/shifts/:id" */
  route: string;
  /** The template with real seeded ids filled in. */
  path: string;
}

/** Every GET route (SSE excluded: it is scanned as a stream below), with path params filled from `idsByResource`. */
function discoverGetRoutes(app: INestApplication, idsByResource: Record<string, string>): GetRoute[] {
  const routes: GetRoute[] = [];
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
      if (!controller) continue;
      const basePath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") continue;
        const handler = controller.prototype[name];
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler);
        if (methodPath === undefined) continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) continue;
        if (Reflect.getMetadata(SSE_METADATA, handler)) continue;
        const segments = [basePath, String(methodPath)].flatMap((part) => part.split("/")).filter(Boolean);
        const template = `/api/v1/${segments.join("/")}`;
        // A path param is filled with the seeded id of the resource named by the segment before it
        // (`shifts/:id` -> a shift id); `:yearMonth` with the seeded payroll month.
        const filled = segments.map((segment, index) => {
          if (!segment.startsWith(":")) return segment;
          const resource = segment === ":yearMonth" ? ":yearMonth" : segments[index - 1];
          const id = idsByResource[resource];
          if (!id) throw new Error(`No seeded id for ${segment} in GET ${template}: add one for "${resource}" to the scanner's seed.`);
          return id;
        });
        routes.push({ route: `GET ${template}`, path: `/api/v1/${filled.join("/")}` });
      }
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

describe("Financial leak scanner (dev login, every GET route)", () => {
  useEnv({
    APP_ENV: "development",
    DEV_LOGIN_ENABLED: "true",
    OTP_PROVIDER: undefined,
    // Download links are presigned locally; dummy credentials keep the SDK from looking for real ones.
    S3_ACCESS_KEY_ID: "scanner-test",
    S3_SECRET_ACCESS_KEY: "scanner-test",
  });

  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let seed: Awaited<ReturnType<typeof seedOrganization>>;

  async function devLogin(membershipId: string): Promise<string> {
    const response = await request(app.getHttpServer()).post("/api/v1/auth/dev/login").send({ membershipId }).expect(201);
    return response.body.accessToken;
  }

  function clockEvent(accessToken: string, kind: "clock-in" | "clock-out", body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1/clock-events/${kind}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", uuidv7())
      .send({ clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), latitude: NEARBY_LAT, longitude: SITE_LNG, accuracyMeters: 10, ...body });
  }

  /**
   * Money in every place the API stores it: a project budget, compensation
   * profiles, forgotten-stamp deductions, a calculated payroll with a penalty
   * adjustment, and clock-out notifications whose Owner copy has a cost.
   */
  async function seedOrganization() {
    await resetDatabase(app);
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker", {
      type: "DAILY",
      dailyRateAgorot: 40_000,
      overtimeRateAgorot: 6_000,
    });
    const otherWorker = await addWorker(prisma, organizationId, OTHER_WORKER_PHONE, "Rami Worker", {
      type: "HOURLY",
      hourlyRateAgorot: 5_000,
      overtimeRateAgorot: 7_500,
    });

    const project = await createProject(prisma, organizationId);
    await prisma.project.update({ where: { id: project.id }, data: { budgetAgorot: PROJECT_BUDGET_AGOROT } });
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const shiftStart = new Date(Date.now() - 60 * 60_000);
    const shiftEnd = new Date(Date.now() + 8 * 60 * 60_000);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, shiftStart, shiftEnd);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shift.id, otherWorker.workerProfile.id, manager.user.id);

    const ownerToken = await devLogin(owner.membership.id);
    const managerToken = await devLogin(manager.membership.id);
    const workerToken = await devLogin(worker.membership.id);
    const otherWorkerToken = await devLogin(otherWorker.membership.id);
    const http = app.getHttpServer();

    // The Worker's day, through the real endpoints: clock in, clock out (notifies the manager and the Owner).
    await clockEvent(workerToken, "clock-in", { shiftId: shift.id, deviceId: "scanner-worker-device" }).expect(201);
    const clockOut = await clockEvent(workerToken, "clock-out", {
      deviceId: "scanner-worker-device",
      summaryText: "Set up the lane closure and directed traffic.",
      taskCategory: "TRAFFIC_CONTROL",
    }).expect(201);
    const timeEntryId: string = clockOut.body.id;

    // Three forgotten clock-ins this month: the third one deducts money.
    const nineHoursBeforeClockOut = new Date(new Date(clockOut.body.clockOutAt).getTime() - 9 * 60 * 60_000).toISOString();
    for (let i = 0; i < 3; i++) {
      await request(http)
        .post("/api/v1/manual-corrections")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ timeEntryId, field: "CLOCK_IN", newValue: nineHoursBeforeClockOut, reason: CorrectionReason.FORGOTTEN_CLOCK_IN })
        .expect(201);
    }
    await request(http).post(`/api/v1/time-entries/${timeEntryId}/approve`).set("Authorization", `Bearer ${managerToken}`).send({}).expect(201);

    const yearMonth: string = clockOut.body.businessDate.slice(0, 7);
    await request(http)
      .post(`/api/v1/payroll-periods/${yearMonth}/calculate`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", uuidv7())
      .expect(201);

    await request(http)
      .post("/api/v1/turan-assignments")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        turanType: TuranType.NIGHT_TURAN,
        startAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        endAt: new Date(Date.now() + 36 * 60 * 60_000).toISOString(),
        assignedWorkerProfileId: worker.workerProfile.id,
      })
      .expect(201);

    // An emergency call-out (manager-authorized, then ended by the worker): its Owner DTO carries a cost estimate.
    const calloutStart = await request(http)
      .post("/api/v1/emergency-callouts/start")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", uuidv7())
      .send({
        workerProfileId: worker.workerProfile.id,
        deviceId: "scanner-manager-device",
        clientEventId: uuidv7(),
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
      })
      .expect(201);
    await request(http)
      .post("/api/v1/emergency-callouts/end")
      .set("Authorization", `Bearer ${workerToken}`)
      .set("Idempotency-Key", uuidv7())
      .send({
        deviceId: "scanner-worker-device",
        clientEventId: uuidv7(),
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
        summaryText: "Restored the failed traffic light.",
        taskCategory: "EMERGENCY_REPAIR",
      })
      .expect(201);
    const calloutId: string = calloutStart.body.calloutId;

    const batch = await prisma.offlineSyncBatch.create({
      data: { id: uuidv7(), organizationId, workerProfileId: worker.workerProfile.id, deviceId: "scanner-worker-device", eventCount: 0 },
    });
    const report = await prisma.generatedReport.create({
      data: {
        id: uuidv7(),
        organizationId,
        reportType: "WORKER_ATTENDANCE_LEDGER",
        requestedByUserId: manager.user.id,
        subjectWorkerProfileId: worker.workerProfile.id,
        filtersJson: { fromDate: `${yearMonth}-01`, toDate: `${yearMonth}-28` },
        includesFinancials: false,
        templateVersion: "worker-attendance-ledger-v1",
        sha256Hash: "0".repeat(64),
        storageKey: `reports/${organizationId}/scanner.pdf`,
      },
    });

    return {
      owner,
      manager,
      worker,
      otherWorker,
      shift,
      yearMonth,
      timeEntryId,
      calloutId,
      tokens: { owner: ownerToken, manager: managerToken, worker: workerToken, otherWorker: otherWorkerToken },
      idsByResource: {
        shifts: shift.id,
        "time-entries": timeEntryId,
        projects: project.id,
        sites: site.id,
        batches: batch.id,
        workers: worker.workerProfile.id,
        reports: report.id,
        "emergency-callouts": calloutId,
        ":yearMonth": yearMonth,
      },
    };
  }

  /** Calls every GET route as `accessToken`; returns each leaked key as "GET /route -> $.json.path". */
  async function scanGetRoutes(accessToken: string, role: "manager" | "worker", skip: Set<string>) {
    const leaks: string[] = [];
    const unexpectedStatuses: string[] = [];
    const bodies = new Map<string, unknown>();
    for (const { route, path } of discoverGetRoutes(app, seed.idsByResource)) {
      if (skip.has(route)) continue;
      const response = await request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${accessToken}`);
      const allowed = response.status === 200 || response.status === 403 || (response.status === 404 && EXPECTED_NOT_FOUND[role].has(route));
      if (!allowed) unexpectedStatuses.push(`${route} -> ${response.status} ${JSON.stringify(response.body)}`);
      if (response.status === 200) bodies.set(route, response.body);
      for (const jsonPath of findForbiddenKeys(response.body)) leaks.push(`${route} -> ${jsonPath}`);
    }
    return { leaks, unexpectedStatuses, bodies };
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    seed = await seedOrganization();
  });

  afterAll(async () => {
    await app.close();
  });

  it("finds money where it is stored (so an empty result below means no leak, not no data)", async () => {
    const { leaks } = await scanGetRoutes(seed.tokens.owner, "manager", new Set());
    const ownerLeaks = leaks.join("\n");
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/projects -> \$\[0\]\.budgetAgorot$/m);
    // Any index: the seeded emergency call-out's own shift (no project) now sorts first.
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/shifts -> \$\[\d+\]\.project\.budgetAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/workers -> \$\[\d+\]\.compensation\.dailyBaseRateAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/forgotten-stamp-infractions -> \$\[\d+\]\.deductionAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/payroll-periods\/:yearMonth -> \$\.items\[\d+\]\.netPayableAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/notifications -> \$\[\d+\]\.dataJson\.estimatedCostAgorot$/m);
    // Step 5: the Owner-only cost responses and the Owner's emergency call-out DTO.
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/time-entries\/:id\/estimated-cost -> \$\.estimatedCostAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/workers\/:id\/estimated-earnings -> \$\.totalEstimatedAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/emergency-callouts -> \$\.items\[0\]\.estimatedCostAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/emergency-callouts\/:id -> \$\.estimatedCostAgorot$/m);
  });

  /** The routes were really read as this role, with rows in them (an empty list would scan clean). */
  function expectRows(bodies: Map<string, unknown>, routes: string[]) {
    for (const route of routes) {
      const body = bodies.get(route);
      expect({ route, rows: Array.isArray(body) ? body.length > 0 : body }).toEqual({ route, rows: true });
    }
  }

  it("a Field Manager gets no money or bank field from any GET route", async () => {
    const { leaks, unexpectedStatuses, bodies } = await scanGetRoutes(seed.tokens.manager, "manager", new Set());
    expect({ leaks, unexpectedStatuses }).toEqual({ leaks: [], unexpectedStatuses: [] });

    expectRows(bodies, ["GET /api/v1/shifts", "GET /api/v1/forgotten-stamp-infractions", "GET /api/v1/projects", "GET /api/v1/workers", "GET /api/v1/notifications"]);
    expect(bodies.get("GET /api/v1/shifts/:id")).toMatchObject({ id: seed.shift.id, project: { name: "Test Project" } });
    // Step 5 routes were read with real rows (the evidence has corrections with forgotten-stamp infractions).
    expect(bodies.get("GET /api/v1/time-entries/:id/evidence")).toMatchObject({ id: seed.timeEntryId, history: { corrections: [{ infraction: { monthlySequenceNumber: 1 } }, {}, {}] } });
    expect(bodies.get("GET /api/v1/emergency-callouts")).toMatchObject({ items: [{ id: seed.calloutId }] });
    expect(bodies.get("GET /api/v1/emergency-callouts/:id")).toMatchObject({ id: seed.calloutId });
    expect((bodies.get("GET /api/v1/attendance/entries") as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it("a Worker gets no money or bank field from any GET route except their own pay (explicit exceptions)", async () => {
    const { leaks, unexpectedStatuses, bodies } = await scanGetRoutes(seed.tokens.worker, "worker", WORKER_OWN_MONEY_ROUTES);
    expect({ leaks, unexpectedStatuses }).toEqual({ leaks: [], unexpectedStatuses: [] });

    expectRows(bodies, ["GET /api/v1/shifts", "GET /api/v1/time-entries", "GET /api/v1/notifications"]);
    expect(bodies.get("GET /api/v1/shifts/:id")).toMatchObject({ id: seed.shift.id, project: { name: "Test Project" } });
  });

  it("the Worker's own-money exceptions only ever contain the Worker's own data", async () => {
    const http = app.getHttpServer();
    const workerProfileId = seed.worker.workerProfile.id;
    const auth = `Bearer ${seed.tokens.worker}`;

    const ownProfiles = await request(http).get(`/api/v1/workers/${workerProfileId}/compensation-profiles`).set("Authorization", auth).expect(200);
    expect(ownProfiles.body.length).toBeGreaterThan(0);
    for (const profile of ownProfiles.body) expect(profile.workerProfileId).toBe(workerProfileId);
    await request(http).get(`/api/v1/workers/${seed.otherWorker.workerProfile.id}/compensation-profiles`).set("Authorization", auth).expect(403);

    const payslip = await request(http).get(`/api/v1/payroll-periods/${seed.yearMonth}/my-payslip`).set("Authorization", auth).expect(200);
    expect(payslip.body.workerProfileId).toBe(workerProfileId);
    expect(payslip.body.adjustments.length).toBeGreaterThan(0);
    for (const adjustment of payslip.body.adjustments) expect(adjustment.workerProfileId).toBe(workerProfileId);
    // Every row the payslip came from belongs to the Worker.
    const itemIds = new Set((await prisma.payrollItem.findMany({ where: { workerProfileId } })).map((item) => item.id));
    expect(itemIds.has(payslip.body.id)).toBe(true);
  });

  it("a Field Manager's WebSocket and SSE notification payloads carry no money", async () => {
    const managerSocket = await connectNotificationsSocket(seed.tokens.manager);
    const ownerSocket = await connectNotificationsSocket(seed.tokens.owner);
    const managerSse = openSse(`/api/v1/notifications/stream?token=${encodeURIComponent(seed.tokens.manager)}`);
    try {
      await managerSse.ready;

      // A real flow whose Owner copy carries a cost: the other worker clocks in and out of the manager's shift.
      await clockEvent(seed.tokens.otherWorker, "clock-in", { shiftId: seed.shift.id, deviceId: "scanner-other-device" }).expect(201);
      await clockEvent(seed.tokens.otherWorker, "clock-out", {
        deviceId: "scanner-other-device",
        summaryText: "Replaced the damaged road signs.",
        taskCategory: "TRAFFIC_CONTROL",
      }).expect(201);
      // A call site that wrongly puts money in a Field Manager's data: the safety net must strip it on the wire too.
      await app.get(NotificationsService).notify({
        organizationId: seed.owner.org.id,
        recipientUserId: seed.manager.user.id,
        type: NotificationType.WORKER_CLOCKED_OUT,
        title: "Call-site mistake",
        body: "Carries money it must not.",
        data: { estimatedCostAgorot: 12_345, shiftId: seed.shift.id },
      });

      const isClockOut = (n: { type: string }) => n.type === NotificationType.WORKER_CLOCKED_OUT;
      await waitFor(() => managerSocket.received.filter(isClockOut).length >= 2 && managerSse.received.filter(isClockOut).length >= 2);
      await waitFor(() => ownerSocket.received.some(isClockOut));

      const leaks = [
        ...managerSocket.received.flatMap((payload, i) => findForbiddenKeys(payload, `ws[${i}]`)),
        ...managerSse.received.flatMap((payload, i) => findForbiddenKeys(payload, `sse[${i}]`)),
      ];
      expect(leaks).toEqual([]);
      // The same event does carry money for the Owner, so the scan above had something to catch.
      expect(findForbiddenKeys(ownerSocket.received.filter(isClockOut))).toContain("$[0].dataJson.estimatedCostAgorot");
    } finally {
      managerSocket.socket.disconnect();
      ownerSocket.socket.disconnect();
      managerSse.close();
    }
  });

  async function connectNotificationsSocket(accessToken: string) {
    const received: Array<{ type: string }> = [];
    const socket: Socket = io(`${baseUrl}/notifications`, { auth: { token: accessToken }, transports: ["websocket"], reconnection: false });
    socket.on("notification", (payload) => received.push(payload));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return { socket, received };
  }

  function openSse(path: string) {
    const received: Array<{ type: string }> = [];
    let response: IncomingMessage | undefined;
    let buffer = "";
    const req = httpGet(`${baseUrl}${path}`, { headers: { Accept: "text/event-stream" } });
    const ready = new Promise<void>((resolve, reject) => {
      req.on("response", (res) => {
        response = res;
        if (res.statusCode !== 200) return reject(new Error(`SSE answered ${res.statusCode}`));
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const data = event
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (data) received.push(JSON.parse(data));
          }
        });
        resolve();
      });
      req.on("error", reject);
    });
    return {
      ready,
      received,
      close: () => {
        response?.destroy();
        req.destroy();
      },
    };
  }

  async function waitFor(condition: () => boolean, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for notification payloads.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
});
