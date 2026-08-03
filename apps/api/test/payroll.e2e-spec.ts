import type { INestApplication } from "@nestjs/common";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { createTestApp, resetDatabase, loginAs, request } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { createOrgWithOwner, addFieldManager, addWorker, createProject, createSiteWithGeofence, createStandardShift, assignWorkerToShift } from "./fixtures";
import { v7 as uuidv7 } from "uuid";

describe("Payroll engine (e2e)", () => {
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

  it("calculates a 9-hour standard day as exactly one credited standard day, then finalizes and blocks further edits (scenario 1 & 14)", async () => {
    const { org } = await createOrgWithOwner(prisma, "+972500000001");
    const fm = await addFieldManager(prisma, org.id, "+972500000011", "FM One");
    const worker = await addWorker(prisma, org.id, "+972500010001", "Worker One", { type: "DAILY", dailyRateAgorot: 40000, overtimeRateAgorot: 6000 });
    const project = await createProject(prisma, org.id);
    const { site, geofence } = await createSiteWithGeofence(prisma, org.id, project.id, 32.08, 34.78, 100);

    const start = new Date();
    start.setHours(6, 0, 0, 0);
    const end = new Date(start.getTime() + 9 * 3_600_000);
    const shift = await createStandardShift(prisma, org.id, project.id, site.id, geofence.id, fm.user.id, start, end);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, fm.user.id);

    const timeEntry = await prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        organizationId: org.id,
        workerProfileId: worker.workerProfile.id,
        shiftId: shift.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        businessDate: toBusinessDate(start),
        clockInAt: start,
        clockOutAt: end,
        rawDurationMinutes: 540,
        checkInMethod: "GEOFENCED",
      },
    });

    const fmSession = await loginAs(app, "+972500000011");
    const approval = await request(app.getHttpServer())
      .post(`/api/v1/time-entries/${timeEntry.id}/approve`)
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({})
      .expect(201);
    expect(approval.body.approvedRegularMinutes).toBe(540);
    expect(approval.body.approvedOvertimeMinutes).toBe(0);

    const yearMonth = toBusinessDate(start).slice(0, 7);
    const ownerSession = await loginAs(app, "+972500000001");

    const calc = await request(app.getHttpServer())
      .post(`/api/v1/payroll-periods/${yearMonth}/calculate`)
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .set("Idempotency-Key", "calc-1")
      .expect(201);
    expect(calc.body.status).toBe("REVIEW");

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/payroll-periods/${yearMonth}`)
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .expect(200);
    const item = detail.body.items.find((i: { workerProfileId: string }) => i.workerProfileId === worker.workerProfile.id);
    expect(item.standardDaysCredited).toBe(1);
    expect(item.grossBaseAgorot).toBe(40000);
    expect(item.netPayableAgorot).toBe(40000);

    await request(app.getHttpServer())
      .post(`/api/v1/payroll-periods/${yearMonth}/finalize`)
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .expect(201);

    // Editing an included shift after finalization must be blocked.
    const blocked = await request(app.getHttpServer())
      .post("/api/v1/manual-corrections")
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({ timeEntryId: timeEntry.id, field: "CLOCK_OUT", newValue: new Date(end.getTime() + 3_600_000).toISOString(), reason: "MANAGER_INSTRUCTION" })
      .expect(409);
    expect(blocked.body.code).toBe("PAYROLL_PERIOD_FINALIZED");

    // Owner reopens with a reason -> new version.
    const reopened = await request(app.getHttpServer())
      .post(`/api/v1/payroll-periods/${yearMonth}/reopen`)
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .send({ reason: "Correction needed after audit" })
      .expect(201);
    expect(reopened.body.status).toBe("REOPENED");
    expect(reopened.body.version).toBe(2);
  });

  it("prorates a short day with no full-day credit (scenario 2)", async () => {
    const { org } = await createOrgWithOwner(prisma, "+972500000001");
    const fm = await addFieldManager(prisma, org.id, "+972500000011", "FM One");
    const worker = await addWorker(prisma, org.id, "+972500010002", "Worker Two", { type: "DAILY", dailyRateAgorot: 40000, overtimeRateAgorot: 6000 });
    const project = await createProject(prisma, org.id);
    const { site, geofence } = await createSiteWithGeofence(prisma, org.id, project.id, 32.08, 34.78, 100);
    const start = new Date();
    start.setHours(6, 0, 0, 0);
    const end = new Date(start.getTime() + 6 * 3_600_000);
    const shift = await createStandardShift(prisma, org.id, project.id, site.id, geofence.id, fm.user.id, start, end);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, fm.user.id);

    const timeEntry = await prisma.timeEntry.create({
      data: {
        id: uuidv7(), organizationId: org.id, workerProfileId: worker.workerProfile.id, shiftId: shift.id,
        status: TimeEntryStatus.PENDING_APPROVAL, businessDate: toBusinessDate(start), clockInAt: start, clockOutAt: end,
        rawDurationMinutes: 360, checkInMethod: "GEOFENCED",
      },
    });

    const fmSession = await loginAs(app, "+972500000011");
    await request(app.getHttpServer()).post(`/api/v1/time-entries/${timeEntry.id}/approve`).set("Authorization", `Bearer ${fmSession.accessToken}`).send({}).expect(201);

    const yearMonth = toBusinessDate(start).slice(0, 7);
    const ownerSession = await loginAs(app, "+972500000001");
    await request(app.getHttpServer()).post(`/api/v1/payroll-periods/${yearMonth}/calculate`).set("Authorization", `Bearer ${ownerSession.accessToken}`).set("Idempotency-Key", "calc-2").expect(201);

    const detail = await request(app.getHttpServer()).get(`/api/v1/payroll-periods/${yearMonth}`).set("Authorization", `Bearer ${ownerSession.accessToken}`).expect(200);
    const item = detail.body.items.find((i: { workerProfileId: string }) => i.workerProfileId === worker.workerProfile.id);
    expect(item.standardDaysCredited).toBe(0);
    expect(item.grossBaseAgorot).toBe(26_667); // 40000 * 360/540, rounded
  });
});
