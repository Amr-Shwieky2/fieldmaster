import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { AttendanceFlag, CorrectionReason, PayrollAdjustmentType, TimeEntryStatus, TuranType } from "@fieldmaster/shared-types";
import { toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";
import { calculatePayroll } from "./payroll-helpers";

/**
 * Step 5: the attendance screens' API -- the list, the evidence of one entry,
 * the Owner-only cost estimates, emergency call-outs, forgotten stamps -- and
 * the evidence of refused clock attempts.
 */

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center: inside the 100 m geofence.
const NEARBY_LAT = 32.0858;
// ~1.1 km north: outside it.
const FAR_LAT = 32.095;

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";
const SECOND_WORKER_PHONE = "+972500010002";
const OTHER_ORG_OWNER_PHONE = "+972500000099";
const OTHER_ORG_WORKER_PHONE = "+972500010099";

/** Every money key the financial leak scanner looks for, at any depth. */
const MONEY_KEY = /agorot|rate"|budget|bank|amount|estimatedcost|netpay|grosspay/i;

describe("Attendance screens API (Step 5)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  const http = () => app.getHttpServer();
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(http()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", uuidv7()).send(body);

  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker", { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
    const project = await createProject(prisma, organizationId);
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const start = new Date(Date.now() - 60 * 60_000);
    const end = new Date(Date.now() + 8 * 60 * 60_000);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, start, end);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);

    const tokens = {
      owner: (await loginAs(app, OWNER_PHONE)).accessToken,
      manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
      worker: (await loginAs(app, WORKER_PHONE)).accessToken,
    };
    return { organizationId, owner, manager, worker, project, site, geofence, shift, start, end, tokens };
  }

  /** A second organization whose Owner must never reach the first one's records. */
  async function otherOrganization() {
    const owner = await createOrgWithOwner(prisma, OTHER_ORG_OWNER_PHONE, "Other Owner");
    const worker = await addWorker(prisma, owner.org.id, OTHER_ORG_WORKER_PHONE, "Other Worker");
    return { owner, worker, ownerToken: (await loginAs(app, OTHER_ORG_OWNER_PHONE)).accessToken };
  }

  function clock(token: string, kind: "clock-in" | "clock-out", body: Record<string, unknown>) {
    return post(token, `/clock-events/${kind}`, {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
      ...body,
    });
  }

  async function clockInAndOut(token: string, shiftId: string): Promise<string> {
    const clockIn = await clock(token, "clock-in", { shiftId }).expect(201);
    await clock(token, "clock-out", { summaryText: "Closed the lane and directed traffic.", taskCategory: "TRAFFIC_CONTROL" }).expect(201);
    return clockIn.body.timeEntry.id;
  }

  /** Moves an ended entry's clock-in back so it lasts `minutes` (a manager's correction, no infraction). */
  async function makeEntryLast(managerToken: string, timeEntryId: string, minutes: number, reason: CorrectionReason = CorrectionReason.MANAGER_INSTRUCTION) {
    const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    const clockInAt = new Date(entry.clockOutAt!.getTime() - minutes * 60_000).toISOString();
    await post(managerToken, "/manual-corrections", { timeEntryId, field: "CLOCK_IN", newValue: clockInAt, reason }).expect(201);
  }

  it("stores refused clock attempts as evidence without changing the worker's answer, and links them to the entry", async () => {
    const ctx = await setup();

    const far = await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id, latitude: FAR_LAT }).expect(400);
    // The worker's answer is exactly what it was before attempts were stored.
    expect(Object.keys(far.body).sort()).toEqual(["code", "correlationId", "details", "message", "statusCode"]);
    expect(far.body.code).toBe("GEOFENCE_OUTSIDE_ALLOWED_RADIUS");
    expect(far.body.details.allowedRadiusMeters).toBe(100);
    const poorGps = await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id, accuracyMeters: 80 }).expect(400);
    expect(poorGps.body).toMatchObject({ code: "GPS_ACCURACY_TOO_LOW", details: { accuracyMeters: 80, requiredMeters: 50 } });

    const unlinked = await prisma.rejectedClockAttempt.findMany({ where: { workerProfileId: ctx.worker.workerProfile.id }, orderBy: { createdAt: "asc" } });
    expect(unlinked).toHaveLength(2);
    expect(unlinked[0]).toMatchObject({
      code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
      eventType: "CLOCK_IN",
      origin: "ONLINE",
      shiftId: ctx.shift.id,
      timeEntryId: null,
      latitude: FAR_LAT,
      distanceMeters: far.body.details.distanceMeters,
      allowedRadiusMeters: 100,
    });
    expect(unlinked[1]).toMatchObject({ code: "GPS_ACCURACY_TOO_LOW", accuracyMeters: 80, requiredAccuracyMeters: 50, timeEntryId: null });

    const clockIn = await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id }).expect(201);
    const timeEntryId: string = clockIn.body.timeEntry.id;
    // A refused clock-out is linked to the open entry right away.
    const mock = await clock(ctx.tokens.worker, "clock-out", { mockLocationSuspected: true, summaryText: "x", taskCategory: "OTHER" }).expect(403);
    expect(mock.body.code).toBe("MOCK_LOCATION_BLOCKED");
    await clock(ctx.tokens.worker, "clock-out", { summaryText: "Closed the lane.", taskCategory: "TRAFFIC_CONTROL" }).expect(201);

    const linked = await prisma.rejectedClockAttempt.findMany({ where: { timeEntryId }, orderBy: { createdAt: "asc" } });
    expect(linked.map((attempt) => [attempt.eventType, attempt.code])).toEqual([
      ["CLOCK_IN", "GEOFENCE_OUTSIDE_ALLOWED_RADIUS"],
      ["CLOCK_IN", "GPS_ACCURACY_TOO_LOW"],
      ["CLOCK_OUT", "MOCK_LOCATION_BLOCKED"],
    ]);

    const evidence = await get(ctx.tokens.manager, `/time-entries/${timeEntryId}/evidence`).expect(200);
    expect(evidence.body.rejectedAttempts).toHaveLength(3);
    expect(evidence.body.rejectedAttempts[0]).toMatchObject({
      code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
      distanceMeters: far.body.details.distanceMeters,
      allowedRadiusMeters: 100,
    });

    const list = await get(ctx.tokens.manager, "/attendance/entries?tab=ALL").expect(200);
    expect(list.body.items[0].flags).toEqual([AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT, AttendanceFlag.SUSPICIOUS_LOCATION]);
    const outside = await get(ctx.tokens.manager, `/attendance/entries?tab=ALL&flags=${AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT}`).expect(200);
    expect(outside.body.items.map((item: { id: string }) => item.id)).toEqual([timeEntryId]);
    const offline = await get(ctx.tokens.manager, `/attendance/entries?tab=ALL&flags=${AttendanceFlag.OFFLINE}`).expect(200);
    expect(offline.body).toMatchObject({ items: [], total: 0 });
  });

  it("records the temporary check-in point a clock-in used and flags the entry", async () => {
    const ctx = await setup();
    // 300 m from the site: outside the geofence, inside the point.
    const pointLat = 32.088;
    const point = await post(ctx.tokens.manager, "/shifts/temporary-check-in-points", {
      shiftId: ctx.shift.id,
      name: "Bridge north",
      latitude: pointLat,
      longitude: SITE_LNG,
      radiusMeters: 80,
    }).expect(201);
    const clockIn = await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id, latitude: pointLat, temporaryCheckInPointId: point.body.id }).expect(
      201,
    );

    const evidence = await get(ctx.tokens.manager, `/time-entries/${clockIn.body.timeEntry.id}/evidence`).expect(200);
    expect(evidence.body.clockEvents[0].temporaryCheckInPoint).toMatchObject({ id: point.body.id, name: "Bridge north", radiusMeters: 80 });
    const list = await get(ctx.tokens.manager, `/attendance/entries?tab=ALL&flags=${AttendanceFlag.TEMPORARY_POINT}`).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([clockIn.body.timeEntry.id]);
  });

  it("lists entries by tab with counts, filters and pagination, and refuses Workers", async () => {
    const ctx = await setup();
    const second = await addWorker(prisma, ctx.organizationId, SECOND_WORKER_PHONE, "Rami Worker");
    const secondProject = await createProject(prisma, ctx.organizationId, "PRJ-SECOND");
    const otherSite = await createSiteWithGeofence(prisma, ctx.organizationId, secondProject.id, SITE_LAT, SITE_LNG, 100);
    const otherShift = await createStandardShift(
      prisma,
      ctx.organizationId,
      secondProject.id,
      otherSite.site.id,
      otherSite.geofence.id,
      ctx.manager.user.id,
      ctx.start,
      ctx.end,
    );
    await assignWorkerToShift(prisma, otherShift.id, second.workerProfile.id, ctx.manager.user.id);
    const secondToken = (await loginAs(app, SECOND_WORKER_PHONE)).accessToken;

    const approved = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    const pending = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    const rejected = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    const otherPending = await clockInAndOut(secondToken, otherShift.id);
    await post(ctx.tokens.manager, `/time-entries/${approved}/approve`).expect(201);
    await post(ctx.tokens.manager, `/time-entries/${rejected}/reject`, { reason: "Wrong shift" }).expect(201);

    const pendingTab = await get(ctx.tokens.manager, "/attendance/entries").expect(200);
    expect(pendingTab.body.tabCounts).toEqual({ PENDING: 2, APPROVED: 1, REJECTED: 1, ALL: 4 });
    expect(pendingTab.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(pendingTab.body.items.map((item: { id: string }) => item.id).sort()).toEqual([pending, otherPending].sort());
    expect(pendingTab.body.items.find((item: { id: string }) => item.id === pending)).toMatchObject({
      status: TimeEntryStatus.PENDING_APPROVAL,
      worker: { id: ctx.worker.workerProfile.id, fullLegalName: "Eli Worker" },
      shift: {
        id: ctx.shift.id,
        title: "Test Shift",
        shiftType: "STANDARD",
        project: { id: ctx.project.id, name: "Test Project" },
        site: { id: ctx.site.id, name: "Test Site" },
      },
      dailySummary: { text: "Closed the lane and directed traffic.", taskCategory: "TRAFFIC_CONTROL" },
      flags: [],
    });
    expect(JSON.stringify(pendingTab.body)).not.toMatch(MONEY_KEY);

    expect((await get(ctx.tokens.manager, "/attendance/entries?tab=APPROVED").expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual([
      approved,
    ]);
    expect((await get(ctx.tokens.manager, "/attendance/entries?tab=REJECTED").expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual([
      rejected,
    ]);

    const page2 = await get(ctx.tokens.manager, "/attendance/entries?tab=ALL&pageSize=3&page=2").expect(200);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 3, total: 4 });
    expect(page2.body.items).toHaveLength(1);

    const byWorker = await get(ctx.tokens.manager, `/attendance/entries?tab=ALL&workerProfileId=${second.workerProfile.id}`).expect(200);
    expect(byWorker.body.items.map((item: { id: string }) => item.id)).toEqual([otherPending]);
    const byProject = await get(ctx.tokens.manager, `/attendance/entries?tab=ALL&projectId=${secondProject.id}`).expect(200);
    expect(byProject.body.items.map((item: { id: string }) => item.id)).toEqual([otherPending]);
    const bySite = await get(ctx.tokens.manager, `/attendance/entries?tab=ALL&siteId=${ctx.site.id}`).expect(200);
    expect(bySite.body.total).toBe(3);
    expect((await get(ctx.tokens.manager, "/attendance/entries?tab=ALL&shiftType=NIGHT_TURAN").expect(200)).body.total).toBe(0);

    const today = (await prisma.timeEntry.findUniqueOrThrow({ where: { id: pending } })).businessDate;
    expect((await get(ctx.tokens.manager, `/attendance/entries?tab=ALL&from=${today}&to=${today}`).expect(200)).body.total).toBe(4);
    expect((await get(ctx.tokens.manager, "/attendance/entries?tab=ALL&from=2099-01-01").expect(200)).body.total).toBe(0);

    await get(ctx.tokens.manager, "/attendance/entries?flags=NOT_A_FLAG").expect(400);
    await get(ctx.tokens.manager, "/attendance/entries?workerProfileId=not-a-uuid").expect(400);
    await get(ctx.tokens.manager, "/attendance/entries?from=2026-13-01").expect(400);
    await get(ctx.tokens.worker, "/attendance/entries").expect(403);

    // Another organization's Owner sees none of these entries.
    const other = await otherOrganization();
    expect((await get(other.ownerToken, "/attendance/entries?tab=ALL").expect(200)).body).toMatchObject({ items: [], total: 0 });
  });

  it("evidence: the same money-free response for Owner and Field Manager; Workers and other organizations are refused", async () => {
    const ctx = await setup();
    const timeEntryId = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);

    const asManager = await get(ctx.tokens.manager, `/time-entries/${timeEntryId}/evidence`).expect(200);
    const asOwner = await get(ctx.tokens.owner, `/time-entries/${timeEntryId}/evidence`).expect(200);
    expect(asOwner.body).toEqual(asManager.body);
    expect(JSON.stringify(asManager.body)).not.toMatch(MONEY_KEY);

    expect(asManager.body).toMatchObject({
      id: timeEntryId,
      status: TimeEntryStatus.PENDING_APPROVAL,
      worker: { id: ctx.worker.workerProfile.id, fullLegalName: "Eli Worker", phoneNumber: WORKER_PHONE },
      shift: { id: ctx.shift.id, project: { id: ctx.project.id, name: "Test Project" }, geofence: { radiusMeters: 100 } },
      duration: { basis: "EXPECTED", unpaidBreakMinutes: 0 },
      dailySummary: { text: "Closed the lane and directed traffic.", taskCategory: "TRAFFIC_CONTROL" },
      allowedActions: { approve: true, reject: true, requestCorrection: true, correct: true },
    });
    expect(asManager.body.clockEvents.map((event: { eventType: string }) => event.eventType)).toEqual(["CLOCK_IN", "CLOCK_OUT"]);
    expect(asManager.body.clockEvents[0]).toMatchObject({ origin: "ONLINE", locationValidationStatus: "PASSED", offlineSync: null });
    expect(asManager.body.clockEvents[0].validatedAt).toBe(asManager.body.clockInAt);
    expect(asManager.body.history.auditEvents.map((event: { action: string }) => event.action)).toEqual(["CLOCK_IN", "CLOCK_OUT"]);
    expect(asManager.body.shift.project).not.toHaveProperty("budgetAgorot");

    await get(ctx.tokens.worker, `/time-entries/${timeEntryId}/evidence`).expect(403);
    const other = await otherOrganization();
    await get(other.ownerToken, `/time-entries/${timeEntryId}/evidence`).expect(404);
    await get(ctx.tokens.manager, `/time-entries/${uuidv7()}/evidence`).expect(404);
    await get(ctx.tokens.manager, "/time-entries/not-a-uuid/evidence").expect(404);
  });

  it("the estimated cost of an entry is Owner-only and matches payroll (estimated while pending, approved after approval)", async () => {
    const ctx = await setup();
    const timeEntryId = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    await makeEntryLast(ctx.tokens.manager, timeEntryId, 630); // 10 h 30 m

    const pending = await get(ctx.tokens.owner, `/time-entries/${timeEntryId}/estimated-cost`).expect(200);
    // DAILY: one day (400.00) + 90 overtime minutes at 60.00/h (90.00).
    expect(pending.body).toEqual({
      timeEntryId,
      basis: "ESTIMATED",
      compensationType: "DAILY",
      regularMinutes: 540,
      overtimeMinutes: 90,
      baseAgorot: 40_000,
      overtimeAgorot: 9_000,
      estimatedCostAgorot: 49_000,
    });

    await post(ctx.tokens.manager, `/time-entries/${timeEntryId}/approve`).expect(201);
    const approved = await get(ctx.tokens.owner, `/time-entries/${timeEntryId}/estimated-cost`).expect(200);
    expect(approved.body).toMatchObject({ basis: "APPROVED", estimatedCostAgorot: 49_000 });

    // The monthly payroll pays the same amount for this entry.
    const yearMonth = (await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } })).businessDate.slice(0, 7);
    // Step 7: the calculation is a background job (202), awaited here.
    await calculatePayroll(app, ctx.tokens.owner, yearMonth);
    const item = await prisma.payrollItem.findFirstOrThrow({ where: { workerProfileId: ctx.worker.workerProfile.id } });
    expect(item.grossBaseAgorot + item.overtimeAgorot).toBe(49_000);

    await get(ctx.tokens.manager, `/time-entries/${timeEntryId}/estimated-cost`).expect(403);
    await get(ctx.tokens.worker, `/time-entries/${timeEntryId}/estimated-cost`).expect(403);
    const other = await otherOrganization();
    await get(other.ownerToken, `/time-entries/${timeEntryId}/estimated-cost`).expect(404);
  });

  it("a worker's estimated earnings for a month (Owner only): approved, pending and the month's adjustments", async () => {
    const ctx = await setup();
    const approved = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    await makeEntryLast(ctx.tokens.manager, approved, 630);
    await post(ctx.tokens.manager, `/time-entries/${approved}/approve`).expect(201);
    const pending = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    // Three forgotten clock-ins this month: the third deducts 10.00.
    for (let i = 0; i < 3; i++) await makeEntryLast(ctx.tokens.manager, pending, 540, CorrectionReason.FORGOTTEN_CLOCK_IN);

    const month = toBusinessYearMonth(new Date());
    const earnings = await get(ctx.tokens.owner, `/workers/${ctx.worker.workerProfile.id}/estimated-earnings?month=${month}`).expect(200);
    expect(earnings.body).toEqual({
      workerProfileId: ctx.worker.workerProfile.id,
      month,
      approvedAgorot: 49_000,
      pendingEstimateAgorot: 40_000,
      adjustmentsAgorot: -1_000,
      totalEstimatedAgorot: 88_000,
      approvedEntries: 1,
      pendingEntries: 1,
      openEntries: 0,
      entriesWithoutCompensationProfile: 0,
    });
    // The current month is the default.
    expect((await get(ctx.tokens.owner, `/workers/${ctx.worker.workerProfile.id}/estimated-earnings`).expect(200)).body.month).toBe(month);

    await get(ctx.tokens.owner, `/workers/${ctx.worker.workerProfile.id}/estimated-earnings?month=2026-13`).expect(400);
    await get(ctx.tokens.manager, `/workers/${ctx.worker.workerProfile.id}/estimated-earnings`).expect(403);
    await get(ctx.tokens.worker, `/workers/${ctx.worker.workerProfile.id}/estimated-earnings`).expect(403);
    const other = await otherOrganization();
    await get(other.ownerToken, `/workers/${ctx.worker.workerProfile.id}/estimated-earnings`).expect(404);
  });

  it("correcting an existing clock-in keeps the original evidence and writes the audit old -> new", async () => {
    const ctx = await setup();
    const timeEntryId = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    const before = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId }, include: { clockEvents: true } });
    const originalClockIn = before.clockEvents.find((event) => event.eventType === "CLOCK_IN")!;
    const newClockIn = new Date(before.clockInAt!.getTime() - 2 * 60 * 60_000);

    await post(ctx.tokens.manager, "/manual-corrections", {
      timeEntryId,
      field: "CLOCK_IN",
      newValue: newClockIn.toISOString(),
      reason: CorrectionReason.DEVICE_FAILURE,
    }).expect(201);

    const after = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId }, include: { clockEvents: true } });
    // Only the validated time changed...
    expect(after.clockInAt!.toISOString()).toBe(newClockIn.toISOString());
    expect(after.rawDurationMinutes).toBe(Math.round((after.clockOutAt!.getTime() - newClockIn.getTime()) / 60_000));
    // ...the clock event (what the phone and the server recorded) is untouched.
    expect(after.clockEvents.find((event) => event.id === originalClockIn.id)).toEqual(originalClockIn);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: timeEntryId, action: "MANUAL_TIME_CORRECTION" } });
    expect(audit).toMatchObject({
      field: "clockInAt",
      oldValue: before.clockInAt!.toISOString(),
      newValue: newClockIn.toISOString(),
      reason: CorrectionReason.DEVICE_FAILURE,
    });

    const evidence = await get(ctx.tokens.manager, `/time-entries/${timeEntryId}/evidence`).expect(200);
    expect(evidence.body.clockInAt).toBe(newClockIn.toISOString());
    expect(evidence.body.clockEvents[0]).toMatchObject({
      deviceTimestamp: originalClockIn.deviceTimestamp.toISOString(),
      serverReceivedAt: originalClockIn.serverReceivedAt.toISOString(),
      validatedAt: newClockIn.toISOString(),
    });
    expect(evidence.body.history.corrections).toEqual([
      expect.objectContaining({
        field: "clockInAt",
        oldValue: before.clockInAt!.toISOString(),
        newValue: newClockIn.toISOString(),
        reason: CorrectionReason.DEVICE_FAILURE,
        editedByName: "Yossi Manager",
        // A device failure is not a forgotten stamp: no infraction.
        infraction: null,
      }),
    ]);
    expect(evidence.body.history.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "MANUAL_TIME_CORRECTION",
        actorName: "Yossi Manager",
        field: "clockInAt",
        oldValue: before.clockInAt!.toISOString(),
        newValue: newClockIn.toISOString(),
      }),
    );
    expect(await prisma.forgottenStampInfraction.count()).toBe(0);
  });

  it("a correction in a finalized payroll period is refused with 409 and changes nothing", async () => {
    const ctx = await setup();
    const timeEntryId = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    await post(ctx.tokens.manager, `/time-entries/${timeEntryId}/approve`).expect(201);
    const before = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    const yearMonth = before.businessDate.slice(0, 7);
    // Step 7: the calculation is a background job (202), awaited here.
    await calculatePayroll(app, ctx.tokens.owner, yearMonth);
    await post(ctx.tokens.owner, `/payroll-periods/${yearMonth}/finalize`).expect(201);

    const refused = await post(ctx.tokens.manager, "/manual-corrections", {
      timeEntryId,
      field: "CLOCK_IN",
      newValue: new Date(before.clockInAt!.getTime() - 60 * 60_000).toISOString(),
      reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
    }).expect(409);
    expect(refused.body.code).toBe("PAYROLL_PERIOD_FINALIZED");

    expect(await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } })).toEqual(before);
    expect(await prisma.manualTimeCorrection.count()).toBe(0);
    expect(await prisma.forgottenStampInfraction.count()).toBe(0);
    const evidence = await get(ctx.tokens.manager, `/time-entries/${timeEntryId}/evidence`).expect(200);
    expect(evidence.body).toMatchObject({ periodFinalized: true, allowedActions: { correct: false, approve: false, fullDayCredit: false } });
  });

  it("forgotten stamps: month list without money for a Field Manager; reversing a deduction keeps the original adjustment", async () => {
    const ctx = await setup();
    const timeEntryId = await clockInAndOut(ctx.tokens.worker, ctx.shift.id);
    for (let i = 0; i < 3; i++) await makeEntryLast(ctx.tokens.manager, timeEntryId, 540, CorrectionReason.FORGOTTEN_CLOCK_OUT);
    const month = toBusinessYearMonth(new Date());

    const asManager = await get(ctx.tokens.manager, `/forgotten-stamp-infractions?month=${month}`).expect(200);
    expect(asManager.body.map((row: { monthlySequenceNumber: number }) => row.monthlySequenceNumber)).toEqual([3, 2, 1]);
    expect(asManager.body[0]).toMatchObject({
      businessMonth: month,
      worker: { id: ctx.worker.workerProfile.id, fullLegalName: "Eli Worker" },
      correction: { reason: CorrectionReason.FORGOTTEN_CLOCK_OUT, field: "clockInAt", editedByName: "Yossi Manager" },
      timeEntry: { id: timeEntryId },
      reversedAt: null,
    });
    expect(JSON.stringify(asManager.body)).not.toMatch(MONEY_KEY);
    expect((await get(ctx.tokens.manager, "/forgotten-stamp-infractions?month=2020-01").expect(200)).body).toEqual([]);
    await get(ctx.tokens.manager, "/forgotten-stamp-infractions?month=January").expect(400);

    const asOwner = await get(ctx.tokens.owner, `/forgotten-stamp-infractions?month=${month}`).expect(200);
    expect(asOwner.body.map((row: { deductionAgorot: number }) => row.deductionAgorot)).toEqual([1_000, 0, 0]);
    const third = asOwner.body[0];
    const original = await prisma.payrollAdjustment.findFirstOrThrow({ where: { relatedInfractionId: third.id } });
    expect(original).toMatchObject({ type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY, amountAgorot: -1_000 });

    await post(ctx.tokens.owner, `/forgotten-stamp-infractions/${third.id}/reverse`, { reason: "   " }).expect(400);
    await post(ctx.tokens.manager, `/forgotten-stamp-infractions/${third.id}/reverse`, { reason: "Phone battery died" }).expect(403);
    await post(ctx.tokens.owner, `/forgotten-stamp-infractions/${third.id}/reverse`, { reason: "Phone battery died" }).expect(201);

    // The original deduction is still there, unchanged; a new offsetting adjustment points at it.
    expect(await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    const reversal = await prisma.payrollAdjustment.findFirstOrThrow({ where: { reversalOfId: original.id } });
    expect(reversal).toMatchObject({
      type: PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL,
      amountAgorot: 1_000,
      reason: "Phone battery died",
      relatedInfractionId: third.id,
    });

    const afterReversal = await get(ctx.tokens.manager, `/forgotten-stamp-infractions?month=${month}`).expect(200);
    expect(afterReversal.body[0]).toMatchObject({
      id: third.id,
      reversalReason: "Phone battery died",
      reversedByName: "Dana Owner",
      reversalAdjustmentId: reversal.id,
    });
    await post(ctx.tokens.owner, `/forgotten-stamp-infractions/${third.id}/reverse`, { reason: "Again" }).expect(409);
  });

  it("adding a missing clock-in checks the worker's organization and an open entry, and links earlier refused attempts", async () => {
    const ctx = await setup();
    const other = await otherOrganization();
    const clockInAt = new Date(Date.now() - 3 * 60 * 60_000).toISOString();

    // A worker of another organization: refused, nothing created.
    await post(ctx.tokens.manager, "/manual-corrections", {
      shiftId: ctx.shift.id,
      workerProfileId: other.worker.workerProfile.id,
      field: "CLOCK_IN",
      newValue: clockInAt,
      reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
    }).expect(404);
    expect(await prisma.timeEntry.count()).toBe(0);

    // The worker is on the clock: a second open entry would break "one open entry per worker".
    await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id }).expect(201);
    const conflict = await post(ctx.tokens.manager, "/manual-corrections", {
      shiftId: ctx.shift.id,
      workerProfileId: ctx.worker.workerProfile.id,
      field: "CLOCK_IN",
      newValue: clockInAt,
      reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
    }).expect(409);
    expect(conflict.body.code).toBe("ACTIVE_TIME_ENTRY_EXISTS");
    await clock(ctx.tokens.worker, "clock-out", { summaryText: "Done.", taskCategory: "OTHER" }).expect(201);

    // A refused attempt at another shift, then the manager adds the missing clock-in for it.
    const secondShift = await createStandardShift(
      prisma,
      ctx.organizationId,
      ctx.project.id,
      ctx.site.id,
      ctx.geofence.id,
      ctx.manager.user.id,
      ctx.start,
      ctx.end,
    );
    await assignWorkerToShift(prisma, secondShift.id, ctx.worker.workerProfile.id, ctx.manager.user.id);
    await clock(ctx.tokens.worker, "clock-in", { shiftId: secondShift.id, latitude: FAR_LAT }).expect(400);
    const created = await post(ctx.tokens.manager, "/manual-corrections", {
      shiftId: secondShift.id,
      workerProfileId: ctx.worker.workerProfile.id,
      field: "CLOCK_IN",
      newValue: clockInAt,
      reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
    }).expect(201);
    const attempt = await prisma.rejectedClockAttempt.findFirstOrThrow({ where: { shiftId: secondShift.id } });
    expect(attempt.timeEntryId).toBe(created.body.timeEntry.id);
    const infraction = await prisma.forgottenStampInfraction.findFirstOrThrow({ where: { timeEntryId: created.body.timeEntry.id } });
    expect(infraction).toMatchObject({ monthlySequenceNumber: 1, businessMonth: toBusinessYearMonth(new Date(clockInAt)) });
  });

  it("emergency call-outs: paginated and filtered, with the cost key only in an Owner's DTO; Workers refused", async () => {
    const ctx = await setup();
    const second = await addWorker(prisma, ctx.organizationId, SECOND_WORKER_PHONE, "Rami Worker", {
      type: "HOURLY",
      hourlyRateAgorot: 5_000,
      overtimeRateAgorot: 7_500,
    });
    await post(ctx.tokens.manager, "/turan-assignments", {
      turanType: TuranType.NIGHT_TURAN,
      startAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      endAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
      assignedWorkerProfileId: ctx.worker.workerProfile.id,
    }).expect(201);

    const emergencyBody = {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 12,
    };
    const started = await post(ctx.tokens.worker, "/emergency-callouts/start", emergencyBody).expect(201);
    await post(ctx.tokens.worker, "/emergency-callouts/end", {
      ...emergencyBody,
      clientEventId: uuidv7(),
      latitude: SITE_LAT,
      accuracyMeters: 8,
      summaryText: "Reset the traffic light controller.",
      taskCategory: "EMERGENCY_REPAIR",
    }).expect(201);
    const manual = await post(ctx.tokens.manager, "/emergency-callouts/start", {
      ...emergencyBody,
      clientEventId: uuidv7(),
      workerProfileId: second.workerProfile.id,
    }).expect(201);

    const asManager = await get(ctx.tokens.manager, "/emergency-callouts").expect(200);
    expect(asManager.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(JSON.stringify(asManager.body)).not.toMatch(MONEY_KEY);
    for (const item of asManager.body.items) expect(item).not.toHaveProperty("estimatedCostAgorot");

    const detail = await get(ctx.tokens.manager, `/emergency-callouts/${started.body.calloutId}`).expect(200);
    expect(detail.body).toMatchObject({
      id: started.body.calloutId,
      worker: { id: ctx.worker.workerProfile.id, fullLegalName: "Eli Worker" },
      authorizationSource: "NIGHT_TURAN_ASSIGNMENT",
      authorizedByName: null,
      turanAssignment: { turanType: "NIGHT_TURAN" },
      retroactiveMinutes: 60,
      returnBufferMinutes: 15,
      start: { latitude: NEARBY_LAT, longitude: SITE_LNG, accuracyMeters: 12 },
      end: { latitude: SITE_LAT, longitude: SITE_LNG, accuracyMeters: 8 },
      timeEntryId: started.body.timeEntryId,
      status: TimeEntryStatus.PENDING_APPROVAL,
      summary: { text: "Reset the traffic light controller.", taskCategory: "EMERGENCY_REPAIR" },
    });
    expect(new Date(detail.body.actualStartClick).getTime() - new Date(detail.body.compensatedStart).getTime()).toBe(60 * 60_000);
    expect(new Date(detail.body.compensatedEnd).getTime() - new Date(detail.body.actualEndClick).getTime()).toBe(15 * 60_000);
    expect(detail.body.compensatedDurationMinutes).toBe(detail.body.actualWorkedMinutes + 75);

    const active = await get(ctx.tokens.manager, `/emergency-callouts?status=${TimeEntryStatus.ACTIVE}`).expect(200);
    expect(active.body.items.map((item: { id: string }) => item.id)).toEqual([manual.body.calloutId]);
    expect(active.body.items[0]).toMatchObject({ authorizationSource: "MANUAL_MANAGER_AUTHORIZATION", authorizedByName: "Yossi Manager", end: null });
    const bySecond = await get(ctx.tokens.manager, `/emergency-callouts?workerProfileId=${second.workerProfile.id}`).expect(200);
    expect(bySecond.body.total).toBe(1);

    const asOwner = await get(ctx.tokens.owner, "/emergency-callouts").expect(200);
    const ended = asOwner.body.items.find((item: { id: string }) => item.id === started.body.calloutId);
    const open = asOwner.body.items.find((item: { id: string }) => item.id === manual.body.calloutId);
    // DAILY 400.00 prorated over the compensated minutes (no approval yet: estimated); still open: no estimate.
    expect(ended.estimatedCostAgorot).toBe(Math.round((40_000 * detail.body.compensatedDurationMinutes) / 540));
    expect(open).toHaveProperty("estimatedCostAgorot", null);
    expect((await get(ctx.tokens.owner, `/emergency-callouts/${started.body.calloutId}`).expect(200)).body.estimatedCostAgorot).toBe(ended.estimatedCostAgorot);

    await get(ctx.tokens.worker, "/emergency-callouts").expect(403);
    await get(ctx.tokens.worker, `/emergency-callouts/${started.body.calloutId}`).expect(403);
    const other = await otherOrganization();
    await get(other.ownerToken, `/emergency-callouts/${started.body.calloutId}`).expect(404);
    expect((await get(other.ownerToken, "/emergency-callouts").expect(200)).body).toMatchObject({ items: [], total: 0 });
  });
});
