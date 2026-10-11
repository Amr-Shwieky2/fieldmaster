import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
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

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";
const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center, inside the 100 m geofence.
const INSIDE_LAT = 32.0858;

async function seedShiftWithWorker(app: INestApplication) {
  await resetDatabase(app);
  const prisma = app.get(PrismaService);
  const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
  const manager = await addFieldManager(prisma, owner.org.id, MANAGER_PHONE, "Yossi Manager");
  const worker = await addWorker(prisma, owner.org.id, WORKER_PHONE, "Eli Worker", {
    type: "DAILY",
    dailyRateAgorot: 50_000,
    overtimeRateAgorot: 7_000,
  });
  const project = await createProject(prisma, owner.org.id);
  const { site, geofence } = await createSiteWithGeofence(prisma, owner.org.id, project.id, SITE_LAT, SITE_LNG, 100);
  const start = new Date(Date.now() - 60 * 60_000);
  const end = new Date(Date.now() + 8 * 60 * 60_000);
  const shift = await createStandardShift(prisma, owner.org.id, project.id, site.id, geofence.id, manager.user.id, start, end);
  await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);
  return { owner, manager, worker, shift };
}

/** Quick login (dev login on): the same session payload as OTP verification. */
async function devLogin(app: INestApplication, membershipId: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post("/api/v1/auth/dev/login")
    .send({ membershipId, deviceId: "e2e-dev-tools", platform: "WEB" })
    .expect(201);
  return response.body.accessToken as string;
}

function clockIn(app: INestApplication, token: string, shiftId: string, key: string) {
  return request(app.getHttpServer())
    .post("/api/v1/clock-events/clock-in")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", key)
    .send({
      shiftId,
      deviceId: "sim-device",
      clientEventId: key,
      deviceTimestamp: new Date().toISOString(),
      latitude: INSIDE_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
    });
}

function clockOut(app: INestApplication, token: string, key: string) {
  return request(app.getHttpServer())
    .post("/api/v1/clock-events/clock-out")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", key)
    .send({
      deviceId: "sim-device",
      clientEventId: key,
      deviceTimestamp: new Date().toISOString(),
      latitude: INSIDE_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
      summaryText: "Installed signs",
      taskCategory: "TRAFFIC_SIGN",
    });
}

function rewind(app: INestApplication, token: string | null, timeEntryId: string, minutes: number) {
  const req = request(app.getHttpServer()).post(`/api/v1/dev/time-entries/${timeEntryId}/rewind`);
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send({ minutes });
}

describe("Dev tools (dev login on): time-entry rewind + worker simulator context", () => {
  useEnv({ APP_ENV: "development", DEV_LOGIN_ENABLED: "true", OTP_PROVIDER: undefined });
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: Awaited<ReturnType<typeof seedShiftWithWorker>>;
  let ownerToken: string;
  let managerToken: string;
  let workerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    seed = await seedShiftWithWorker(app);
    ownerToken = await devLogin(app, seed.owner.membership.id);
    managerToken = await devLogin(app, seed.manager.membership.id);
    workerToken = await devLogin(app, seed.worker.membership.id);
  });

  async function openEntry() {
    const response = await clockIn(app, workerToken, seed.shift.id, `in-${uuidv7()}`).expect(201);
    return response.body.timeEntry as { id: string; clockInAt: string; businessDate: string };
  }

  it("moves an open entry's clock-in back, marks the entry and writes a DEV_REWIND audit event with old and new values", async () => {
    const entry = await openEntry();
    const oldClockInAt = new Date(entry.clockInAt);

    const response = await rewind(app, ownerToken, entry.id, 540).expect(201);

    const expected = new Date(oldClockInAt.getTime() - 540 * 60_000);
    expect(response.body.id).toBe(entry.id);
    expect(response.body.status).toBe("ACTIVE");
    expect(new Date(response.body.clockInAt).toISOString()).toBe(expected.toISOString());
    expect(response.body.businessDate).toBe(toBusinessDate(expected));
    expect(response.body.devRewoundAt).toEqual(expect.any(String));

    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.clockInAt?.toISOString()).toBe(expected.toISOString());
    expect(stored.devRewoundAt).not.toBeNull();

    const audit = await prisma.auditLog.findMany({ where: { action: "DEV_REWIND" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      organizationId: seed.owner.org.id,
      actorUserId: seed.owner.user.id,
      entityType: "TimeEntry",
      entityId: entry.id,
      field: "clockInAt",
      oldValue: oldClockInAt.toISOString(),
      newValue: expected.toISOString(),
    });
    expect(audit[0]!.note).toContain("540 min");

    // The real clock-in evidence is untouched: only the entry moved.
    const clockInEvent = await prisma.clockEvent.findFirstOrThrow({ where: { timeEntryId: entry.id, eventType: "CLOCK_IN" } });
    expect(clockInEvent.serverReceivedAt.getTime()).toBeGreaterThanOrEqual(oldClockInAt.getTime() - 1000);
  });

  it("lets the existing rules split a rewound 10 h 30 m shift into 540 regular + 90 overtime minutes", async () => {
    const entry = await openEntry();
    await rewind(app, managerToken, entry.id, 630).expect(201);

    const closed = await clockOut(app, workerToken, `out-${uuidv7()}`).expect(201);
    expect(closed.body.rawDurationMinutes).toBe(630);
    expect(closed.body.devRewoundAt).toEqual(expect.any(String));

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/time-entries/${entry.id}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({})
      .expect(201);
    expect(approved.body.approvedRegularMinutes).toBe(540);
    expect(approved.body.approvedOvertimeMinutes).toBe(90);
  });

  it("is not available to a Worker", async () => {
    const entry = await openEntry();
    const response = await rewind(app, workerToken, entry.id, 60).expect(403);
    expect(response.body.code).toBe("FORBIDDEN");
    expect(await prisma.auditLog.count({ where: { action: "DEV_REWIND" } })).toBe(0);
  });

  it("rejects a closed entry", async () => {
    const entry = await openEntry();
    await clockOut(app, workerToken, `out-${uuidv7()}`).expect(201);

    const response = await rewind(app, ownerToken, entry.id, 60).expect(409);
    expect(response.body.code).toBe("TIME_ENTRY_NOT_OPEN");
    expect(await prisma.auditLog.count({ where: { action: "DEV_REWIND" } })).toBe(0);
  });

  it("rejects an entry in a finalized payroll period", async () => {
    const entry = await openEntry();
    await prisma.payrollPeriod.create({
      data: { id: uuidv7(), organizationId: seed.owner.org.id, yearMonth: entry.businessDate.slice(0, 7), status: "FINALIZED" },
    });

    const response = await rewind(app, ownerToken, entry.id, 60).expect(409);
    expect(response.body.code).toBe("PAYROLL_PERIOD_FINALIZED");
    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.clockInAt?.toISOString()).toBe(new Date(entry.clockInAt).toISOString());
    expect(stored.devRewoundAt).toBeNull();
  });

  it("rejects more than 24 hours, in one step or in total", async () => {
    const entry = await openEntry();

    const tooMuch = await rewind(app, ownerToken, entry.id, 24 * 60 + 1).expect(400);
    expect(tooMuch.body.code).toBe("VALIDATION_FAILED");
    await rewind(app, ownerToken, entry.id, 0).expect(400);

    await rewind(app, ownerToken, entry.id, 1000).expect(201);
    const total = await rewind(app, ownerToken, entry.id, 500).expect(400);
    expect(total.body.code).toBe("DEV_REWIND_LIMIT_EXCEEDED");
    expect(await prisma.auditLog.count({ where: { action: "DEV_REWIND" } })).toBe(1);
  });

  it("rejects an emergency call-out and an entry of another organization", async () => {
    await prisma.turanAssignment.create({
      data: {
        id: uuidv7(),
        organizationId: seed.owner.org.id,
        turanType: "NIGHT_TURAN",
        startAt: new Date(Date.now() - 60 * 60_000),
        endAt: new Date(Date.now() + 60 * 60_000),
        assignedWorkerProfileId: seed.worker.workerProfile.id,
        createdBy: seed.manager.user.id,
      },
    });
    const started = await request(app.getHttpServer())
      .post("/api/v1/emergency-callouts/start")
      .set("Authorization", `Bearer ${workerToken}`)
      .set("Idempotency-Key", `em-${uuidv7()}`)
      .send({ deviceId: "sim-device", clientEventId: "em-1", deviceTimestamp: new Date().toISOString(), latitude: SITE_LAT, longitude: SITE_LNG, accuracyMeters: 10 })
      .expect(201);

    const emergency = await rewind(app, ownerToken, started.body.timeEntryId, 60).expect(409);
    expect(emergency.body.code).toBe("DEV_REWIND_EMERGENCY_NOT_SUPPORTED");

    const other = await createOrgWithOwner(prisma, "+972500000099", "Other Owner");
    const otherToken = await devLogin(app, other.membership.id);
    const foreign = await rewind(app, otherToken, started.body.timeEntryId, 60).expect(404);
    expect(foreign.body.code).toBe("NOT_FOUND");
  });

  it("tells the simulated worker about their Turan and temporary-supervisor assignments", async () => {
    const empty = await request(app.getHttpServer())
      .get("/api/v1/dev/worker-simulator/me")
      .set("Authorization", `Bearer ${workerToken}`)
      .expect(200);
    expect(empty.body).toEqual({
      workerProfileId: seed.worker.workerProfile.id,
      turanAssignments: [],
      emergencyEligibleTuranAssignmentId: null,
      temporarySupervisorAssignments: [],
    });

    const turan = await prisma.turanAssignment.create({
      data: {
        id: uuidv7(),
        organizationId: seed.owner.org.id,
        turanType: "NIGHT_TURAN",
        startAt: new Date(Date.now() - 60 * 60_000),
        endAt: new Date(Date.now() + 60 * 60_000),
        assignedWorkerProfileId: seed.worker.workerProfile.id,
        createdBy: seed.manager.user.id,
      },
    });
    const supervisor = await prisma.temporarySupervisorAssignment.create({
      data: {
        id: uuidv7(),
        shiftId: seed.shift.id,
        workerProfileId: seed.worker.workerProfile.id,
        activatedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        assignedBy: seed.manager.user.id,
      },
    });

    const response = await request(app.getHttpServer())
      .get("/api/v1/dev/worker-simulator/me")
      .set("Authorization", `Bearer ${workerToken}`)
      .expect(200);
    expect(response.body.emergencyEligibleTuranAssignmentId).toBe(turan.id);
    expect(response.body.turanAssignments).toEqual([
      expect.objectContaining({ id: turan.id, turanType: "NIGHT_TURAN", status: "SCHEDULED", role: "ASSIGNED" }),
    ]);
    expect(response.body.temporarySupervisorAssignments).toEqual([
      expect.objectContaining({ id: supervisor.id, shiftId: seed.shift.id, shiftTitle: "Test Shift" }),
    ]);
  });
});

describe("Dev tools (dev login off): every route answers 404 like an unknown route", () => {
  useEnv({ APP_ENV: "development", DEV_LOGIN_ENABLED: "false", OTP_PROVIDER: undefined });
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns 404 with and without a valid session, and changes nothing", async () => {
    const seed = await seedShiftWithWorker(app);
    const owner = await loginAs(app, OWNER_PHONE);
    const worker = await loginAs(app, WORKER_PHONE);
    const opened = await clockIn(app, worker.accessToken, seed.shift.id, "in-off-1").expect(201);
    const entryId = opened.body.timeEntry.id as string;
    const http = app.getHttpServer();

    const unknown = await request(http).post("/api/v1/dev/does-not-exist").expect(404);

    for (const token of [null, owner.accessToken]) {
      const response = await rewind(app, token, entryId, 60).expect(404);
      expect(response.body.code).toBe(unknown.body.code);
      expect(response.body.message).toBe(`Cannot POST /api/v1/dev/time-entries/${entryId}/rewind`);
    }
    for (const token of [null, worker.accessToken]) {
      const req = request(http).get("/api/v1/dev/worker-simulator/me");
      if (token) req.set("Authorization", `Bearer ${token}`);
      const response = await req.expect(404);
      expect(response.body.message).toBe("Cannot GET /api/v1/dev/worker-simulator/me");
    }

    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(stored.clockInAt?.toISOString()).toBe(new Date(opened.body.timeEntry.clockInAt).toISOString());
    expect(stored.devRewoundAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "DEV_REWIND" } })).toBe(0);
  });
});
