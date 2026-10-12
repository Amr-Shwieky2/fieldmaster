import { get as httpGet, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { io, type Socket } from "socket.io-client";
import { v7 as uuidv7 } from "uuid";
import { LocationValidationStatus, NotificationType, TimeEntryStatus } from "@fieldmaster/shared-types";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";
import { NotificationsGateway } from "../src/modules/notifications/notifications.gateway";
import { LongOpenEntriesService } from "../src/modules/operations/long-open-entries.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";

/**
 * Step 6: the live operations page -- one snapshot of what is happening now
 * (who is on shift and where they last clocked, who is late, refused
 * attempts, temporary points, entries open for 9 hours or more) for Owners
 * and Field Managers, with no money for anyone; the `operations` events on
 * the notifications WebSocket and SSE stream that tell them to refetch it;
 * and the "open for more than 9 hours" alert.
 */

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center: inside the 100 m geofence.
const NEARBY_LAT = 32.0858;
// ~300 m north: where a temporary point is opened.
const POINT_LAT = 32.088;
// ~1.1 km north: outside the geofence.
const FAR_LAT = 32.095;
// ~2.2 km north: a second site.
const DEPOT_LAT = 32.105;

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const OTHER_MANAGER_PHONE = "+972500000012";
const ON_SITE_PHONE = "+972500010001";
const LATE_PHONE = "+972500010002";
const FAR_PHONE = "+972500010003";
const LONG_PHONE = "+972500010004";
const GRACE_PHONE = "+972500010005";
const UPCOMING_PHONE = "+972500010006";
const OTHER_ORG_OWNER_PHONE = "+972500000099";
const OTHER_ORG_WORKER_PHONE = "+972500010099";

/**
 * The financial leak scanner's rule (financial-leak-scanner.e2e-spec.ts): a key is forbidden if it ends in
 * "Agorot" or "rate" (rate, hourlyRate, dailyRate, overtimeRate, ...) or contains one of these words, case-insensitively.
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
  return Object.entries(value).flatMap(([key, nested]) => [...(isForbiddenKey(key) ? [`${path}.${key}`] : []), ...findForbiddenKeys(nested, `${path}.${key}`)]);
}

interface OperationsEvent {
  kind: string;
  at: string;
}

interface Named {
  fullLegalName: string;
}

const byWorkerName = (a: { worker: Named }, b: { worker: Named }) => a.worker.fullLegalName.localeCompare(b.worker.fullLegalName);

const BARRIER_TITLE = "Test barrier";

describe("Live operations API (Step 6)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  /** Real-time connections opened by a test; closed after it, whatever happened, so Jest can exit. */
  const openConnections: Array<() => void> = [];

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterEach(() => {
    for (const close of openConnections.splice(0)) close();
  });

  const http = () => app.getHttpServer();
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(http()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", uuidv7()).send(body);
  const patch = (token: string, path: string, body: Record<string, unknown>) =>
    request(http()).patch(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).send(body);

  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  /** The response has this status and error code. */
  async function expectError(pending: PromiseLike<{ status: number; body: { code?: string } }>, status: number, code: string) {
    const response = await pending;
    expect({ status: response.status, code: response.body.code }).toEqual({ status, code });
  }

  function clockIn(token: string, body: Record<string, unknown>) {
    return post(token, "/clock-events/clock-in", {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
      ...body,
    });
  }

  function clockOut(token: string) {
    return post(token, "/clock-events/clock-out", {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
      summaryText: "Closed the lane and directed traffic.",
      taskCategory: "TRAFFIC_CONTROL",
    });
  }

  /** An Owner, a Field Manager (the shift's manager) and three workers of a shift that started an hour ago. */
  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    // Rates and a project budget: money a leak would show.
    const onSite = await addWorker(prisma, organizationId, ON_SITE_PHONE, "Eli Worker", { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
    const late = await addWorker(prisma, organizationId, LATE_PHONE, "Rami Worker", { type: "HOURLY", hourlyRateAgorot: 5_000, overtimeRateAgorot: 7_500 });
    const far = await addWorker(prisma, organizationId, FAR_PHONE, "Noa Worker", { type: "HOURLY", hourlyRateAgorot: 5_500, overtimeRateAgorot: 8_000 });
    const project = await createProject(prisma, organizationId, "PRJ-MAIN");
    await prisma.project.update({ where: { id: project.id }, data: { budgetAgorot: 50_000_000 } });
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const start = inMinutes(-60);
    const end = inMinutes(8 * 60);
    // Grace: the default 10 minutes.
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, start, end);
    for (const worker of [onSite, late, far]) await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);

    const tokens = {
      owner: (await loginAs(app, OWNER_PHONE)).accessToken,
      manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
      onSite: (await loginAs(app, ON_SITE_PHONE)).accessToken,
      late: (await loginAs(app, LATE_PHONE)).accessToken,
      far: (await loginAs(app, FAR_PHONE)).accessToken,
    };
    return { organizationId, owner, manager, onSite, late, far, project, site, geofence, shift, start, end, tokens };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  /** Another shift of the context's organization and project, with its own title. */
  async function createShift(ctx: Context, title: string, at: { site: { id: string }; geofence: { id: string } }, start: Date, end: Date) {
    const shift = await createStandardShift(prisma, ctx.organizationId, ctx.project.id, at.site.id, at.geofence.id, ctx.manager.user.id, start, end);
    return prisma.shift.update({ where: { id: shift.id }, data: { title } });
  }

  /** A second organization whose Owner manages its shift; its worker is assigned to it. */
  async function otherOrganization() {
    const owner = await createOrgWithOwner(prisma, OTHER_ORG_OWNER_PHONE, "Other Owner");
    const worker = await addWorker(prisma, owner.org.id, OTHER_ORG_WORKER_PHONE, "Other Worker", {
      type: "DAILY",
      dailyRateAgorot: 45_000,
      overtimeRateAgorot: 7_000,
    });
    const project = await createProject(prisma, owner.org.id, "PRJ-OTHER-ORG");
    const { site, geofence } = await createSiteWithGeofence(prisma, owner.org.id, project.id, SITE_LAT, SITE_LNG, 100);
    const shift = await createStandardShift(prisma, owner.org.id, project.id, site.id, geofence.id, owner.user.id, inMinutes(-60), inMinutes(8 * 60));
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, owner.user.id);
    const tokens = { owner: (await loginAs(app, OTHER_ORG_OWNER_PHONE)).accessToken, worker: (await loginAs(app, OTHER_ORG_WORKER_PHONE)).accessToken };
    return { org: owner.org, owner, worker, project, site, shift, tokens };
  }

  async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** A notifications socket, once the server has authenticated it and joined it to its rooms. */
  async function connectSocket(accessToken: string) {
    const operations: OperationsEvent[] = [];
    const notifications: Array<{ type: string; title: string }> = [];
    const socket: Socket = io(`${baseUrl}/notifications`, { auth: { token: accessToken }, transports: ["websocket"], reconnection: false });
    openConnections.push(() => socket.disconnect());
    socket.on("operations", (payload: OperationsEvent) => operations.push(payload));
    socket.on("notification", (payload: { type: string; title: string }) => notifications.push(payload));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    // The handshake completes before the server's (async) authentication joins the socket to its rooms.
    const gateway = app.get(NotificationsGateway);
    await waitFor(async () => (await gateway.server.fetchSockets()).some((remote) => remote.id === socket.id && remote.rooms.size > 1), "the socket's rooms");
    return { socket, operations, notifications };
  }

  /** The SSE stream, parsed into events: the `event:` name (`message` when absent, as in EventSource) and the JSON data. */
  function openSse(accessToken: string) {
    const events: Array<{ event: string; data: { type?: string; title?: string; kind?: string; at?: string } }> = [];
    let response: IncomingMessage | undefined;
    let buffer = "";
    const req = httpGet(`${baseUrl}/api/v1/notifications/stream?token=${encodeURIComponent(accessToken)}`, { headers: { Accept: "text/event-stream" } });
    const close = () => {
      response?.destroy();
      req.destroy();
    };
    openConnections.push(close);
    const ready = new Promise<void>((resolve, reject) => {
      req.on("response", (res) => {
        response = res;
        if (res.statusCode !== 200) return reject(new Error(`SSE answered ${res.statusCode}`));
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const lines = block.split("\n");
            const eventLine = lines.find((line) => line.startsWith("event:"));
            const event = eventLine ? eventLine.slice(6).trim() : "message";
            const data = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (data) events.push({ event, data: JSON.parse(data) });
          }
        });
        resolve();
      });
      req.on("error", reject);
    });
    return { ready, events, close };
  }

  /**
   * A notification to one user, sent now. A socket or stream receives its events in order, so once this
   * arrives, any `operations` event addressed to the same connection earlier would have arrived before it.
   */
  async function sendBarrier(organizationId: string, recipientUserId: string) {
    await app.get(NotificationsService).notify({
      organizationId,
      recipientUserId,
      type: NotificationType.TURAN_ASSIGNMENT_CHANGED,
      title: BARRIER_TITLE,
      body: "Sent by the test to order the real-time events.",
    });
  }

  it("the snapshot: who is on shift and where they last clocked, late workers, refused attempts, temporary points, long-open entries, per-shift counts", async () => {
    const ctx = await setup();
    // A second site whose shift started 11 hours ago: its worker has been clocked in for 10 of them.
    const depot = await createSiteWithGeofence(prisma, ctx.organizationId, ctx.project.id, DEPOT_LAT, SITE_LNG, 150);
    await prisma.site.update({ where: { id: depot.site.id }, data: { name: "North Depot" } });
    const longShift = await createShift(ctx, "Depot Night Shift", depot, inMinutes(-11 * 60), inMinutes(60));
    const longWorker = await addWorker(prisma, ctx.organizationId, LONG_PHONE, "Avi Worker");
    await assignWorkerToShift(prisma, longShift.id, longWorker.workerProfile.id, ctx.manager.user.id);
    // A shift that started 5 minutes ago (its worker is still within the 10 grace minutes) and one that starts in 2 hours.
    const justStarted = await createShift(ctx, "Morning Shift", ctx, inMinutes(-5), inMinutes(8 * 60));
    const graceWorker = await addWorker(prisma, ctx.organizationId, GRACE_PHONE, "Dina Worker");
    await assignWorkerToShift(prisma, justStarted.id, graceWorker.workerProfile.id, ctx.manager.user.id);
    const upcoming = await createShift(ctx, "Evening Shift", ctx, inMinutes(120), inMinutes(10 * 60));
    const upcomingWorker = await addWorker(prisma, ctx.organizationId, UPCOMING_PHONE, "Tal Worker");
    await assignWorkerToShift(prisma, upcoming.id, upcomingWorker.workerProfile.id, ctx.manager.user.id);

    const onSiteIn = await clockIn(ctx.tokens.onSite, { shiftId: ctx.shift.id, accuracyMeters: 12 }).expect(201);
    const refused = await clockIn(ctx.tokens.far, { shiftId: ctx.shift.id, latitude: FAR_LAT }).expect(400);
    expect(refused.body.code).toBe("GEOFENCE_OUTSIDE_ALLOWED_RADIUS");
    const longIn = await clockIn((await loginAs(app, LONG_PHONE)).accessToken, { shiftId: longShift.id, latitude: DEPOT_LAT, accuracyMeters: 8 }).expect(201);
    // Make the depot entry 10 hours old (its clock event keeps the real times).
    const longClockInAt = inMinutes(-600);
    await prisma.timeEntry.update({ where: { id: longIn.body.timeEntry.id }, data: { clockInAt: longClockInAt } });
    const point = await post(ctx.tokens.manager, "/shifts/temporary-check-in-points", {
      shiftId: ctx.shift.id,
      name: "North gate",
      latitude: POINT_LAT,
      longitude: SITE_LNG,
      radiusMeters: 80,
    }).expect(201);

    const snapshot = (await get(ctx.tokens.manager, "/operations/live").expect(200)).body;
    const longWorkerRef = { id: longWorker.workerProfile.id, fullLegalName: "Avi Worker" };
    const longShiftRef = { id: longShift.id, title: "Depot Night Shift", shiftType: "STANDARD" };
    const mainShiftRef = { id: ctx.shift.id, title: "Test Shift", shiftType: "STANDARD" };

    // On shift, oldest clock-in first, each at the position of their last clock event.
    expect(snapshot.workersOnShift).toEqual([
      {
        timeEntryId: longIn.body.timeEntry.id,
        worker: longWorkerRef,
        shift: longShiftRef,
        clockInAt: longClockInAt.toISOString(),
        openMinutes: expect.any(Number),
        isEmergency: false,
        position: {
          latitude: DEPOT_LAT,
          longitude: SITE_LNG,
          accuracyMeters: 8,
          at: longIn.body.clockEvent.serverReceivedAt,
          eventType: "CLOCK_IN",
          locationValidationStatus: LocationValidationStatus.PASSED,
        },
      },
      {
        timeEntryId: onSiteIn.body.timeEntry.id,
        worker: { id: ctx.onSite.workerProfile.id, fullLegalName: "Eli Worker" },
        shift: mainShiftRef,
        clockInAt: onSiteIn.body.timeEntry.clockInAt,
        openMinutes: expect.any(Number),
        isEmergency: false,
        position: {
          latitude: NEARBY_LAT,
          longitude: SITE_LNG,
          accuracyMeters: 12,
          at: onSiteIn.body.clockEvent.serverReceivedAt,
          eventType: "CLOCK_IN",
          locationValidationStatus: LocationValidationStatus.PASSED,
        },
      },
    ]);
    const longOpenMinutes: number = snapshot.workersOnShift[0].openMinutes;
    expect(longOpenMinutes).toBeGreaterThanOrEqual(600);
    expect(longOpenMinutes).toBeLessThanOrEqual(601);
    expect(snapshot.workersOnShift[1].openMinutes).toBeLessThanOrEqual(1);

    // Open 540 minutes or more: only the depot entry.
    expect(snapshot.longOpenEntries).toEqual([
      {
        timeEntryId: longIn.body.timeEntry.id,
        worker: longWorkerRef,
        shift: longShiftRef,
        clockInAt: longClockInAt.toISOString(),
        openMinutes: longOpenMinutes,
        isEmergency: false,
      },
    ]);

    // Late: assigned to a shift past its start + grace minutes, and never clocked in for it -- the refused worker too.
    const lateWorkers = [...snapshot.lateWorkers].sort(byWorkerName);
    expect(lateWorkers).toEqual([
      {
        worker: { id: ctx.far.workerProfile.id, fullLegalName: "Noa Worker" },
        shift: mainShiftRef,
        scheduledStart: ctx.start.toISOString(),
        graceMinutes: 10,
        lateMinutes: expect.any(Number),
      },
      {
        worker: { id: ctx.late.workerProfile.id, fullLegalName: "Rami Worker" },
        shift: mainShiftRef,
        scheduledStart: ctx.start.toISOString(),
        graceMinutes: 10,
        lateMinutes: expect.any(Number),
      },
    ]);
    for (const late of lateWorkers) {
      expect(late.lateMinutes).toBeGreaterThanOrEqual(60);
      expect(late.lateMinutes).toBeLessThanOrEqual(61);
    }

    // The refused clock-in, with how far away it was.
    expect(snapshot.recentRejectedAttempts).toEqual([
      {
        id: expect.any(String),
        eventType: "CLOCK_IN",
        code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
        at: expect.any(String),
        latitude: FAR_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
        distanceMeters: refused.body.details.distanceMeters,
        allowedRadiusMeters: 100,
        requiredAccuracyMeters: null,
        timeEntryId: null,
        worker: { id: ctx.far.workerProfile.id, fullLegalName: "Noa Worker" },
        shift: mainShiftRef,
      },
    ]);
    expect(snapshot.recentRejectedAttempts[0].distanceMeters).toBeGreaterThan(1_000);

    expect(snapshot.temporaryPoints).toEqual([
      {
        id: point.body.id,
        name: "North gate",
        latitude: POINT_LAT,
        longitude: SITE_LNG,
        radiusMeters: 80,
        expiresAt: ctx.end.toISOString(),
        shift: mainShiftRef,
      },
    ]);

    // Shifts on now, by scheduled start (not the evening one), with their counts; and their sites.
    expect(snapshot.activeShifts).toEqual([
      {
        ...longShiftRef,
        scheduledStart: longShift.scheduledStart.toISOString(),
        scheduledEnd: longShift.scheduledEnd.toISOString(),
        siteName: "North Depot",
        expectedCount: 1,
        clockedInCount: 1,
        lateCount: 0,
      },
      {
        ...mainShiftRef,
        scheduledStart: ctx.start.toISOString(),
        scheduledEnd: ctx.end.toISOString(),
        siteName: "Test Site",
        expectedCount: 3,
        clockedInCount: 1,
        lateCount: 2,
      },
      {
        id: justStarted.id,
        title: "Morning Shift",
        shiftType: "STANDARD",
        scheduledStart: justStarted.scheduledStart.toISOString(),
        scheduledEnd: justStarted.scheduledEnd.toISOString(),
        siteName: "Test Site",
        expectedCount: 1,
        clockedInCount: 0,
        lateCount: 0,
      },
    ]);
    expect(snapshot.sites).toEqual([
      { siteId: depot.site.id, name: "North Depot", centerLatitude: DEPOT_LAT, centerLongitude: SITE_LNG, radiusMeters: 150 },
      { siteId: ctx.site.id, name: "Test Site", centerLatitude: SITE_LAT, centerLongitude: SITE_LNG, radiusMeters: 100 },
    ]);
    expect(snapshot).toMatchObject({ generatedAt: expect.any(String), activeEmergencies: [], suspiciousLocations: [], offlineReview: [] });

    // The Owner gets exactly the same page.
    const asOwner = (await get(ctx.tokens.owner, "/operations/live").expect(200)).body;
    expect({ ...asOwner, generatedAt: null }).toEqual({ ...snapshot, generatedAt: null });
  });

  it("Workers are refused; another organization's operations never appear; no money for anyone, Owner included", async () => {
    const ctx = await setup();
    const onSiteIn = await clockIn(ctx.tokens.onSite, { shiftId: ctx.shift.id }).expect(201);
    await clockIn(ctx.tokens.far, { shiftId: ctx.shift.id, latitude: FAR_LAT }).expect(400);
    const point = await post(ctx.tokens.manager, "/shifts/temporary-check-in-points", {
      shiftId: ctx.shift.id,
      name: "North gate",
      latitude: POINT_LAT,
      longitude: SITE_LNG,
    }).expect(201);

    // Workers -- on the clock or not -- never see the page.
    await expectError(get(ctx.tokens.onSite, "/operations/live"), 403, "FORBIDDEN");
    await expectError(get(ctx.tokens.late, "/operations/live"), 403, "FORBIDDEN");

    // Another organization, just as busy: a refused attempt, a clock-in, a temporary point.
    const other = await otherOrganization();
    await clockIn(other.tokens.worker, { shiftId: other.shift.id, latitude: FAR_LAT }).expect(400);
    const otherIn = await clockIn(other.tokens.worker, { shiftId: other.shift.id }).expect(201);
    const otherPoint = await post(other.tokens.owner, "/shifts/temporary-check-in-points", {
      shiftId: other.shift.id,
      name: "Other gate",
      latitude: POINT_LAT,
      longitude: SITE_LNG,
    }).expect(201);
    await expectError(get(other.tokens.worker, "/operations/live"), 403, "FORBIDDEN");

    const ours = (await get(ctx.tokens.owner, "/operations/live").expect(200)).body;
    const theirs = (await get(other.tokens.owner, "/operations/live").expect(200)).body;
    const ourAttempt = await prisma.rejectedClockAttempt.findFirstOrThrow({ where: { organizationId: ctx.organizationId } });
    const theirAttempt = await prisma.rejectedClockAttempt.findFirstOrThrow({ where: { organizationId: other.org.id } });

    // Each organization sees its own operations...
    const summary = (body: {
      workersOnShift: Array<{ timeEntryId: string }>;
      temporaryPoints: Array<{ id: string }>;
      recentRejectedAttempts: Array<{ id: string }>;
      activeShifts: Array<{ id: string }>;
    }) => ({
      workersOnShift: body.workersOnShift.map((row) => row.timeEntryId),
      temporaryPoints: body.temporaryPoints.map((row) => row.id),
      recentRejectedAttempts: body.recentRejectedAttempts.map((row) => row.id),
      activeShifts: body.activeShifts.map((row) => row.id),
    });
    expect(summary(ours)).toEqual({
      workersOnShift: [onSiteIn.body.timeEntry.id],
      temporaryPoints: [point.body.id],
      recentRejectedAttempts: [ourAttempt.id],
      activeShifts: [ctx.shift.id],
    });
    expect(summary(theirs)).toEqual({
      workersOnShift: [otherIn.body.timeEntry.id],
      temporaryPoints: [otherPoint.body.id],
      recentRejectedAttempts: [theirAttempt.id],
      activeShifts: [other.shift.id],
    });
    // ...and no id of the other one appears anywhere in it.
    const ourIds = [
      ctx.organizationId,
      ctx.shift.id,
      ctx.site.id,
      ctx.onSite.workerProfile.id,
      ctx.far.workerProfile.id,
      onSiteIn.body.timeEntry.id,
      point.body.id,
      ourAttempt.id,
    ];
    const theirIds = [
      other.org.id,
      other.shift.id,
      other.site.id,
      other.worker.workerProfile.id,
      otherIn.body.timeEntry.id,
      otherPoint.body.id,
      theirAttempt.id,
    ];
    for (const id of theirIds) expect(JSON.stringify(ours)).not.toContain(id);
    for (const id of ourIds) expect(JSON.stringify(theirs)).not.toContain(id);

    // No money key for anyone, the Owner included -- though the Owner does see money elsewhere (so the check can find it).
    const asManager = (await get(ctx.tokens.manager, "/operations/live").expect(200)).body;
    expect({ owner: findForbiddenKeys(ours), manager: findForbiddenKeys(asManager), otherOwner: findForbiddenKeys(theirs) }).toEqual({
      owner: [],
      manager: [],
      otherOwner: [],
    });
    expect(findForbiddenKeys((await get(ctx.tokens.owner, "/projects").expect(200)).body)).toContain("$[0].budgetAgorot");
  });

  it("real-time: Owner and Field Manager sockets get an `operations` event for a clock-in and a refused attempt; Worker and other-organization sockets get none", async () => {
    const ctx = await setup();
    const other = await createOrgWithOwner(prisma, OTHER_ORG_OWNER_PHONE, "Other Owner");
    const managerSocket = await connectSocket(ctx.tokens.manager);
    const ownerSocket = await connectSocket(ctx.tokens.owner);
    // The worker who clocks in, and an Owner of another organization.
    const workerSocket = await connectSocket(ctx.tokens.onSite);
    const otherOwnerSocket = await connectSocket((await loginAs(app, OTHER_ORG_OWNER_PHONE)).accessToken);

    await clockIn(ctx.tokens.onSite, { shiftId: ctx.shift.id }).expect(201);
    await waitFor(() => [managerSocket, ownerSocket].every((s) => s.operations.some((event) => event.kind === "CLOCK_IN")), "the CLOCK_IN event");
    await clockIn(ctx.tokens.far, { shiftId: ctx.shift.id, latitude: FAR_LAT }).expect(400);
    await waitFor(
      () => [managerSocket, ownerSocket].every((s) => s.operations.some((event) => event.kind === "REJECTED_ATTEMPT")),
      "the REJECTED_ATTEMPT event",
    );

    for (const connection of [managerSocket, ownerSocket]) {
      expect(connection.operations.map((event) => event.kind)).toEqual(["CLOCK_IN", "REJECTED_ATTEMPT"]);
      for (const event of connection.operations) {
        // Operational only: what changed and when; the client refetches the snapshot.
        expect(Object.keys(event).sort()).toEqual(["at", "kind"]);
        expect(new Date(event.at).toISOString()).toBe(event.at);
      }
    }

    // A notification sent after both events reaches the worker and the other Owner: nothing came before it.
    await sendBarrier(ctx.organizationId, ctx.onSite.user.id);
    await sendBarrier(other.org.id, other.user.id);
    await waitFor(
      () => [workerSocket, otherOwnerSocket].every((s) => s.notifications.some((notification) => notification.title === BARRIER_TITLE)),
      "the barrier notifications",
    );
    expect(workerSocket.operations).toEqual([]);
    expect(otherOwnerSocket.operations).toEqual([]);
  });

  it("real-time: the SSE stream sends a Field Manager the named `operations` event; a Worker's stream carries notifications but no `operations`", async () => {
    const ctx = await setup();
    const managerStream = openSse(ctx.tokens.manager);
    const workerStream = openSse(ctx.tokens.onSite);
    await Promise.all([managerStream.ready, workerStream.ready]);

    await clockIn(ctx.tokens.onSite, { shiftId: ctx.shift.id }).expect(201);
    await waitFor(() => managerStream.events.some((entry) => entry.event === "operations"), "the SSE `operations` event");
    // The manager's clock-in notification arrives on the same stream, as a default (`message`) event.
    await waitFor(
      () => managerStream.events.some((entry) => entry.event === "message" && entry.data.type === NotificationType.WORKER_CLOCKED_IN),
      "the SSE notification",
    );
    expect(managerStream.events.filter((entry) => entry.event === "operations")).toEqual([
      { event: "operations", data: { kind: "CLOCK_IN", at: expect.any(String) } },
    ]);

    // A notification sent after the event reaches the worker's stream: no `operations` event came before it.
    await sendBarrier(ctx.organizationId, ctx.onSite.user.id);
    await waitFor(() => workerStream.events.some((entry) => entry.data.title === BARRIER_TITLE), "the barrier notification");
    expect(workerStream.events.filter((entry) => entry.event === "operations")).toEqual([]);
    expect(workerStream.events.filter((entry) => entry.event === "message").map((entry) => entry.data.title)).toEqual([BARRIER_TITLE]);
  });

  it("9-hour alert: an entry open 540 minutes is reported once to the shift's manager and the Owner, without money; later sweeps send nothing", async () => {
    const ctx = await setup();
    // A Field Manager who does not manage this shift: not told.
    await addFieldManager(prisma, ctx.organizationId, OTHER_MANAGER_PHONE, "Other Manager");
    const clockedIn = await clockIn(ctx.tokens.onSite, { shiftId: ctx.shift.id }).expect(201);
    const timeEntryId: string = clockedIn.body.timeEntry.id;
    const clockInAt = new Date(clockedIn.body.timeEntry.clockInAt);
    // An entry closed before the threshold is never reported.
    await clockIn(ctx.tokens.late, { shiftId: ctx.shift.id }).expect(201);
    await clockOut(ctx.tokens.late).expect(201);
    // Another organization's entry, open just as long, is reported to that organization only.
    const other = await otherOrganization();
    const otherIn = await clockIn(other.tokens.worker, { shiftId: other.shift.id }).expect(201);

    // The sweeps run at chosen times after the clock-in. (The every-minute background job sweeps at the real
    // time, when these entries are minutes old, so it can never report them first.)
    const sweeper = app.get(LongOpenEntriesService);
    const minutesAfterClockIn = (minutes: number) => new Date(clockInAt.getTime() + minutes * 60_000);
    const overtime = () => prisma.notification.findMany({ where: { type: NotificationType.OVERTIME_THRESHOLD_CROSSED }, orderBy: { createdAt: "asc" } });

    expect(await sweeper.sweep(minutesAfterClockIn(539))).toEqual({ notifiedEntries: 0 });
    expect(await overtime()).toEqual([]);

    expect(await sweeper.sweep(minutesAfterClockIn(600))).toEqual({ notifiedEntries: 2 });
    const rows = await overtime();
    const ours = rows.filter((row) => row.organizationId === ctx.organizationId);
    expect(ours.map((row) => row.recipientUserId).sort()).toEqual([ctx.manager.user.id, ctx.owner.user.id].sort());
    for (const row of ours) {
      expect(row).toMatchObject({ title: "Shift open for more than 9 hours", body: 'Eli Worker has been clocked in to "Test Shift" for more than 9 hours.' });
      expect(row.dataJson).toEqual({
        timeEntryId,
        shiftId: ctx.shift.id,
        shiftTitle: "Test Shift",
        workerProfileId: ctx.onSite.workerProfile.id,
        workerName: "Eli Worker",
        clockInAt: clockInAt.toISOString(),
        openMinutes: 600,
      });
      expect(findForbiddenKeys(row.dataJson)).toEqual([]);
    }
    // The other organization's Owner (also its shift's manager) is told once, about their own entry only.
    const theirs = rows.filter((row) => row.organizationId === other.org.id);
    expect(theirs.map((row) => [row.recipientUserId, (row.dataJson as { timeEntryId: string }).timeEntryId])).toEqual([
      [other.owner.user.id, otherIn.body.timeEntry.id],
    ]);
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } })).longOpenNotifiedAt).toEqual(minutesAfterClockIn(600));
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } })).status).toBe(TimeEntryStatus.ACTIVE);

    // Through the API: the shift's manager and the Owner have it once; the other Field Manager and the workers do not.
    const isOvertime = (row: { type: string }) => row.type === NotificationType.OVERTIME_THRESHOLD_CROSSED;
    for (const token of [ctx.tokens.manager, ctx.tokens.owner]) {
      const received = (await get(token, "/notifications").expect(200)).body.filter(isOvertime);
      expect(received).toHaveLength(1);
      expect(received[0].dataJson).toMatchObject({ timeEntryId, workerName: "Eli Worker", openMinutes: 600 });
      expect(findForbiddenKeys(received)).toEqual([]);
    }
    const otherManagerToken = (await loginAs(app, OTHER_MANAGER_PHONE)).accessToken;
    for (const token of [otherManagerToken, ctx.tokens.onSite, ctx.tokens.late]) {
      expect((await get(token, "/notifications").expect(200)).body.filter(isOvertime)).toEqual([]);
    }

    // Later sweeps -- a minute later, a day later, at the real time -- send nothing more.
    expect(await sweeper.sweep(minutesAfterClockIn(601))).toEqual({ notifiedEntries: 0 });
    expect(await sweeper.sweep(minutesAfterClockIn(24 * 60))).toEqual({ notifiedEntries: 0 });
    expect(await sweeper.sweep()).toEqual({ notifiedEntries: 0 });
    expect(await prisma.notification.count({ where: { type: NotificationType.OVERTIME_THRESHOLD_CROSSED } })).toBe(3);
  });

  it("9-hour alert follows the notification settings: Owners switched off, only the shift's manager; Field Managers off, only the Owner", async () => {
    const ctx = await setup();
    const settingsPath = "/organizations/me/settings/notifications";
    const sweeper = app.get(LongOpenEntriesService);
    const recipientsOf = async (timeEntryId: string) =>
      (await prisma.notification.findMany({ where: { type: NotificationType.OVERTIME_THRESHOLD_CROSSED } }))
        .filter((row) => (row.dataJson as { timeEntryId: string }).timeEntryId === timeEntryId)
        .map((row) => row.recipientUserId);

    // Only an Owner changes who is told.
    const ownersOff = { preferences: [{ type: NotificationType.OVERTIME_THRESHOLD_CROSSED, owners: false }] };
    await expectError(patch(ctx.tokens.manager, settingsPath, ownersOff), 403, "FORBIDDEN");
    const updated = await patch(ctx.tokens.owner, settingsPath, ownersOff).expect(200);
    expect(updated.body.notifications).toContainEqual(
      expect.objectContaining({ type: NotificationType.OVERTIME_THRESHOLD_CROSSED, fieldManagerAudience: "SHIFT_MANAGER", owners: false, fieldManagers: true }),
    );

    const first = await clockIn(ctx.tokens.onSite, { shiftId: ctx.shift.id }).expect(201);
    const firstAt = new Date(first.body.timeEntry.clockInAt).getTime();
    expect(await sweeper.sweep(new Date(firstAt + 600 * 60_000))).toEqual({ notifiedEntries: 1 });
    expect(await recipientsOf(first.body.timeEntry.id)).toEqual([ctx.manager.user.id]);

    // Reported once: switching the Owners back on does not send it again.
    await patch(ctx.tokens.owner, settingsPath, {
      preferences: [{ type: NotificationType.OVERTIME_THRESHOLD_CROSSED, owners: true, fieldManagers: false }],
    }).expect(200);
    expect(await sweeper.sweep(new Date(firstAt + 660 * 60_000))).toEqual({ notifiedEntries: 0 });
    expect(await recipientsOf(first.body.timeEntry.id)).toEqual([ctx.manager.user.id]);

    // With the Field Managers switched off, the next entry reaches the Owner only.
    const second = await clockIn(ctx.tokens.late, { shiftId: ctx.shift.id }).expect(201);
    const secondAt = new Date(second.body.timeEntry.clockInAt).getTime();
    expect(await sweeper.sweep(new Date(secondAt + 600 * 60_000))).toEqual({ notifiedEntries: 1 });
    expect(await recipientsOf(second.body.timeEntry.id)).toEqual([ctx.owner.user.id]);
    expect(await prisma.notification.count({ where: { type: NotificationType.OVERTIME_THRESHOLD_CROSSED } })).toBe(2);
  });
});
