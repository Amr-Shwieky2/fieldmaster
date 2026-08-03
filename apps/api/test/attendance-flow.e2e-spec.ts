import type { INestApplication } from "@nestjs/common";
import { CorrectionReason, TimeEntryStatus } from "@fieldmaster/shared-types";
import { createTestApp, resetDatabase, loginAs, request } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import {
  createOrgWithOwner,
  addFieldManager,
  addWorker,
  createProject,
  createSiteWithGeofence,
  createStandardShift,
  assignWorkerToShift,
} from "./fixtures";

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55m north of the site center -- inside a 100m geofence.
const NEARBY_LAT = 32.0858;
const NEARBY_LNG = 34.7818;
// ~1.1km away -- well outside a 100m geofence.
const FAR_LAT = 32.095;
const FAR_LNG = 34.7818;

describe("Attendance flow (e2e)", () => {
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

  async function setupShift(checkInMethod: "GEOFENCED" | "FLEXI_CHECK" = "GEOFENCED") {
    const { org, user: ownerUser } = await createOrgWithOwner(prisma, "+972500000001");
    const fm = await addFieldManager(prisma, org.id, "+972500000011", "FM One");
    const worker = await addWorker(prisma, org.id, "+972500010001", "Worker One", {
      type: "DAILY",
      dailyRateAgorot: 40000,
      overtimeRateAgorot: 6000,
    });
    const project = await createProject(prisma, org.id);
    const { site, geofence } = await createSiteWithGeofence(prisma, org.id, project.id, SITE_LAT, SITE_LNG, 100);
    const start = new Date();
    start.setHours(start.getHours() - 1);
    const end = new Date();
    end.setHours(end.getHours() + 8);
    const shift = await createStandardShift(prisma, org.id, project.id, site.id, geofence.id, fm.user.id, start, end, checkInMethod);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, fm.user.id);

    return { org, ownerUser, fm, worker, project, site, geofence, shift };
  }

  it("rejects clock-in outside the permitted geofence radius with distance details (scenario 8)", async () => {
    const { shift, worker } = await setupShift();
    const session = await loginAs(app, "+972500010001");

    const response = await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-in")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "clockin-far-1")
      .send({
        shiftId: shift.id,
        deviceId: "device-1",
        clientEventId: "evt-1",
        deviceTimestamp: new Date().toISOString(),
        latitude: FAR_LAT,
        longitude: FAR_LNG,
        accuracyMeters: 10,
      })
      .expect(400);

    expect(response.body.code).toBe("GEOFENCE_OUTSIDE_ALLOWED_RADIUS");
    expect(response.body.details.distanceMeters).toBeGreaterThan(100);
    expect(response.body.details.allowedRadiusMeters).toBe(100);

    const activeEntry = await prisma.timeEntry.findFirst({ where: { workerProfileId: worker.workerProfile.id, status: TimeEntryStatus.ACTIVE } });
    expect(activeEntry).toBeNull();
  });

  it("full geofenced clock-in -> mandatory summary -> approval -> minute split (scenario 1 & 4)", async () => {
    const { shift, worker, fm } = await setupShift();
    const workerSession = await loginAs(app, "+972500010001");

    const clockIn = await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-in")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "clockin-ok-1")
      .send({
        shiftId: shift.id,
        deviceId: "device-1",
        clientEventId: "evt-1",
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: NEARBY_LNG,
        accuracyMeters: 10,
      })
      .expect(201);
    expect(clockIn.body.timeEntry.status).toBe(TimeEntryStatus.ACTIVE);

    // Clock-out without a summary must be rejected.
    await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-out")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "clockout-no-summary")
      .send({
        deviceId: "device-1",
        clientEventId: "evt-2",
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: NEARBY_LNG,
        accuracyMeters: 10,
        taskCategory: "TRAFFIC_CONTROL",
      })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe("SUMMARY_REQUIRED"));

    const clockOut = await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-out")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "clockout-ok-1")
      .send({
        deviceId: "device-1",
        clientEventId: "evt-3",
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: NEARBY_LNG,
        accuracyMeters: 10,
        summaryText: "Installed traffic cones and inspected signal timing.",
        taskCategory: "TRAFFIC_CONTROL",
      })
      .expect(201);
    expect(clockOut.body.status).toBe(TimeEntryStatus.PENDING_APPROVAL);

    // Directly correct the raw duration to a known 10h30m so the 9h/overtime
    // split is deterministic for this test (real elapsed time is ~1s here).
    await prisma.timeEntry.update({ where: { id: clockOut.body.id }, data: { rawDurationMinutes: 630 } });

    const fmSession = await loginAs(app, "+972500000011");
    const approval = await request(app.getHttpServer())
      .post(`/api/v1/time-entries/${clockOut.body.id}/approve`)
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({})
      .expect(201);

    expect(approval.body.status).toBe(TimeEntryStatus.APPROVED);
    expect(approval.body.approvedRegularMinutes).toBe(540);
    expect(approval.body.approvedOvertimeMinutes).toBe(90);

    void worker;
  });

  it("applies manual full-day credit to a short day without exposing money to the Field Manager (scenario 3)", async () => {
    const { shift, fm } = await setupShift();
    const workerSession = await loginAs(app, "+972500010001");

    const clockIn = await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-in")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "clockin-short-1")
      .send({ shiftId: shift.id, deviceId: "d1", clientEventId: "e1", deviceTimestamp: new Date().toISOString(), latitude: NEARBY_LAT, longitude: NEARBY_LNG, accuracyMeters: 10 })
      .expect(201);

    const clockOut = await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-out")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "clockout-short-1")
      .send({ deviceId: "d1", clientEventId: "e2", deviceTimestamp: new Date().toISOString(), latitude: NEARBY_LAT, longitude: NEARBY_LNG, accuracyMeters: 10, summaryText: "Left early due to weather.", taskCategory: "MAINTENANCE" })
      .expect(201);

    await prisma.timeEntry.update({ where: { id: clockOut.body.id }, data: { rawDurationMinutes: 360 } }); // 6h

    const fmSession = await loginAs(app, "+972500000011");
    const creditResponse = await request(app.getHttpServer())
      .post(`/api/v1/time-entries/${clockOut.body.id}/full-day-credit`)
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({ reason: "Weather stopped work" })
      .expect(201);

    // Field Manager response must never include compensation figures.
    expect(JSON.stringify(creditResponse.body)).not.toMatch(/Agorot/);
    expect(creditResponse.body.fullDayCredit).toBe(true);

    const approval = await request(app.getHttpServer())
      .post(`/api/v1/time-entries/${clockOut.body.id}/approve`)
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({})
      .expect(201);

    expect(approval.body.approvedRegularMinutes).toBe(540);
    expect(approval.body.approvedOvertimeMinutes).toBe(0);

    void clockIn;
    void fm;
  });

  it("applies the forgotten-stamp two-strike rule: first two free, third deducts 1000 agorot (scenario 5)", async () => {
    const { org, shift, worker, fm } = await setupShift();
    const fmSession = await loginAs(app, "+972500000011");

    for (let i = 1; i <= 3; i++) {
      // Hours apart (not days) so all three infractions land in the same
      // calendar month regardless of when this test runs.
      const clockInAt = new Date(Date.now() - i * 3_600_000);
      const response = await request(app.getHttpServer())
        .post("/api/v1/manual-corrections")
        .set("Authorization", `Bearer ${fmSession.accessToken}`)
        .send({
          shiftId: shift.id,
          workerProfileId: worker.workerProfile.id,
          field: "CLOCK_IN",
          newValue: clockInAt.toISOString(),
          reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
        })
        .expect(201);
      expect(response.body.timeEntry.status).toBe(TimeEntryStatus.ACTIVE);

      // Close the entry out so the next iteration's "missing clock-in" can
      // create its own ACTIVE entry (a worker may only have one at a time).
      await request(app.getHttpServer())
        .post("/api/v1/manual-corrections")
        .set("Authorization", `Bearer ${fmSession.accessToken}`)
        .send({
          timeEntryId: response.body.timeEntry.id,
          field: "CLOCK_OUT",
          newValue: new Date(clockInAt.getTime() + 9 * 3_600_000).toISOString(),
          reason: CorrectionReason.MANAGER_INSTRUCTION,
        })
        .expect(201);
    }

    const infractions = await prisma.forgottenStampInfraction.findMany({ where: { workerProfileId: worker.workerProfile.id }, orderBy: { monthlySequenceNumber: "asc" } });
    expect(infractions).toHaveLength(3);
    expect(infractions[0].deductionAgorot).toBe(0);
    expect(infractions[1].deductionAgorot).toBe(0);
    expect(infractions[2].deductionAgorot).toBe(1000);

    const adjustments = await prisma.payrollAdjustment.findMany({ where: { workerProfileId: worker.workerProfile.id } });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amountAgorot).toBe(-1000);
    expect(adjustments[0].type).toBe("FORGOTTEN_STAMP_PENALTY");

    void org;
  });

  it("does not count a DEVICE_FAILURE correction as a forgotten-stamp infraction (scenario 6)", async () => {
    const { shift, worker, fm } = await setupShift();
    const fmSession = await loginAs(app, "+972500000011");

    await request(app.getHttpServer())
      .post("/api/v1/manual-corrections")
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({
        shiftId: shift.id,
        workerProfileId: worker.workerProfile.id,
        field: "CLOCK_IN",
        newValue: new Date().toISOString(),
        reason: CorrectionReason.DEVICE_FAILURE,
        note: "Phone battery died",
      })
      .expect(201);

    const infractions = await prisma.forgottenStampInfraction.count({ where: { workerProfileId: worker.workerProfile.id } });
    expect(infractions).toBe(0);
  });

  it("accepts Flexi-Check clock-in from any location", async () => {
    const { shift } = await setupShift("FLEXI_CHECK");
    const session = await loginAs(app, "+972500010001");

    const response = await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-in")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "flexi-1")
      .send({ shiftId: shift.id, deviceId: "d1", clientEventId: "e1", deviceTimestamp: new Date().toISOString(), latitude: FAR_LAT, longitude: FAR_LNG, accuracyMeters: 30 })
      .expect(201);

    expect(response.body.timeEntry.checkInMethod).toBe("FLEXI_CHECK");
  });
});
