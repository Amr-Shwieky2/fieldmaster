import type { INestApplication } from "@nestjs/common";
import { OrgRole, TimeEntryStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { v7 as uuidv7 } from "uuid";
import { createTestApp, resetDatabase, loginAs, request } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";
import {
  createOrgWithOwner,
  addFieldManager,
  addWorker,
  createProject,
  createSiteWithGeofence,
  createStandardShift,
  assignWorkerToShift,
} from "./fixtures";

/**
 * Notifications carry structured `dataJson` next to the English title/body so
 * the admin web can render them in Arabic or English. These tests pin down
 * what each call site stores and, above all, financial isolation: money
 * (`*Agorot`) appears only in an Owner's notification data, never in a Field
 * Manager's or Worker's -- exactly like the cost line in the English body.
 */

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
const NEARBY_LAT = 32.0858;
const NEARBY_LNG = 34.7818;

const OWNER_PHONE = "+972500000001";
const FM_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  dataJson: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

const MONEY_KEY = /agorot/i;

function moneyKeys(data: Record<string, unknown> | null): string[] {
  return Object.keys(data ?? {}).filter((key) => MONEY_KEY.test(key));
}

describe("Notification data (e2e)", () => {
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

  async function setup() {
    const { org, user: ownerUser } = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const fm = await addFieldManager(prisma, org.id, FM_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, org.id, WORKER_PHONE, "Eli Worker", { type: "DAILY", dailyRateAgorot: 40000, overtimeRateAgorot: 6000 });
    const project = await createProject(prisma, org.id);
    const { site, geofence } = await createSiteWithGeofence(prisma, org.id, project.id, SITE_LAT, SITE_LNG, 100);
    const start = new Date(Date.now() - 3_600_000);
    const end = new Date(Date.now() + 8 * 3_600_000);
    const shift = await createStandardShift(prisma, org.id, project.id, site.id, geofence.id, fm.user.id, start, end);
    return { org, ownerUser, fm, worker, project, site, geofence, shift };
  }

  async function listNotifications(phoneNumber: string): Promise<NotificationRow[]> {
    const session = await loginAs(app, phoneNumber, `device-${phoneNumber}`);
    const response = await request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", `Bearer ${session.accessToken}`).expect(200);
    return response.body;
  }

  function only(rows: NotificationRow[], type: string): NotificationRow {
    const matches = rows.filter((row) => row.type === type);
    expect(matches).toHaveLength(1);
    return matches[0];
  }

  /** Every notification stored for a non-Owner of the organization is free of money keys. */
  async function expectNoMoneyOutsideOwners(organizationId: string) {
    const owners = await prisma.organizationMembership.findMany({ where: { organizationId, role: OrgRole.OWNER }, select: { userId: true } });
    const ownerIds = new Set(owners.map((o) => o.userId));
    const rows = await prisma.notification.findMany({ where: { organizationId } });
    const nonOwnerRows = rows.filter((row) => !ownerIds.has(row.recipientUserId));
    expect(nonOwnerRows.length).toBeGreaterThan(0);
    for (const row of nonOwnerRows) {
      expect({ type: row.type, moneyKeys: moneyKeys(row.dataJson as Record<string, unknown> | null) }).toEqual({ type: row.type, moneyKeys: [] });
      expect(JSON.stringify(row.dataJson)).not.toMatch(MONEY_KEY);
      expect(row.body).not.toMatch(/Estimated cost|₪/);
    }
  }

  it("clock-in and clock-out: the shift's Field Manager gets durations without money, the Owner also gets the estimated cost", async () => {
    const { org, shift, worker } = await setup();
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, shift.managerId);
    const workerSession = await loginAs(app, WORKER_PHONE);

    await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-in")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "notif-clockin-1")
      .send({ shiftId: shift.id, deviceId: "d1", clientEventId: "e1", deviceTimestamp: new Date().toISOString(), latitude: NEARBY_LAT, longitude: NEARBY_LNG, accuracyMeters: 10 })
      .expect(201);
    const clockOut = await request(app.getHttpServer())
      .post("/api/v1/clock-events/clock-out")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "notif-clockout-1")
      .send({
        deviceId: "d1",
        clientEventId: "e2",
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: NEARBY_LNG,
        accuracyMeters: 10,
        summaryText: "Placed cones and checked signal timing.",
        taskCategory: "TRAFFIC_CONTROL",
      })
      .expect(201);
    const timeEntryId: string = clockOut.body.id;

    const ownerRows = await listNotifications(OWNER_PHONE);
    const fmRows = await listNotifications(FM_PHONE);

    // Clock-in: same values for both, no money for anyone.
    for (const rows of [ownerRows, fmRows]) {
      const clockIn = only(rows, "WORKER_CLOCKED_IN");
      expect(clockIn.title).toBe("Worker clocked in");
      expect(clockIn.body).toBe('A worker clocked in for "Test Shift".');
      expect(clockIn.dataJson).toEqual({
        timeEntryId,
        shiftId: shift.id,
        shiftTitle: "Test Shift",
        workerProfileId: worker.workerProfile.id,
        workerName: "Eli Worker",
        clockInAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    }

    const baseClockOutData = {
      timeEntryId,
      shiftId: shift.id,
      shiftTitle: "Test Shift",
      workerProfileId: worker.workerProfile.id,
      workerName: "Eli Worker",
      clockOutAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      durationMinutes: expect.any(Number),
      regularMinutes: expect.any(Number),
      overtimeMinutes: 0,
    };

    // Field Manager (the shift's manager): durations, no cost -- in the body and in the data.
    const fmClockOut = only(fmRows, "WORKER_CLOCKED_OUT");
    expect(fmClockOut.body).toContain("Approval is required.");
    expect(fmClockOut.body).not.toContain("Estimated cost");
    expect(fmClockOut.dataJson).toEqual(baseClockOutData);
    expect(moneyKeys(fmClockOut.dataJson)).toEqual([]);

    // Owner: the same values plus the estimate shown in the English body.
    const ownerClockOut = only(ownerRows, "WORKER_CLOCKED_OUT");
    expect(ownerClockOut.dataJson).toEqual({ ...baseClockOutData, estimatedCostAgorot: expect.any(Number) });
    const cost = ownerClockOut.dataJson!.estimatedCostAgorot as number;
    expect(Number.isInteger(cost)).toBe(true);
    expect(ownerClockOut.body).toContain(`Estimated cost: ₪${(cost / 100).toFixed(2)}`);

    await expectNoMoneyOutsideOwners(org.id);
  });

  it("emergency call-out: start data has no money for anyone; end data has the estimated cost for Owners only", async () => {
    const { org, worker } = await setup();
    const fmSession = await loginAs(app, FM_PHONE);

    // A Night Turan covering now makes the worker eligible to start a call-out.
    const startAt = new Date(Date.now() - 3_600_000);
    const endAt = new Date(Date.now() + 8 * 3_600_000);
    const turan = await request(app.getHttpServer())
      .post("/api/v1/turan-assignments")
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({ turanType: "NIGHT_TURAN", startAt: startAt.toISOString(), endAt: endAt.toISOString(), assignedWorkerProfileId: worker.workerProfile.id })
      .expect(201);

    const workerSession = await loginAs(app, WORKER_PHONE);
    const started = await request(app.getHttpServer())
      .post("/api/v1/emergency-callouts/start")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "notif-emergency-start")
      .send({ deviceId: "d1", clientEventId: "e1", deviceTimestamp: new Date().toISOString(), latitude: SITE_LAT, longitude: SITE_LNG, accuracyMeters: 10 })
      .expect(201);
    const ended = await request(app.getHttpServer())
      .post("/api/v1/emergency-callouts/end")
      .set("Authorization", `Bearer ${workerSession.accessToken}`)
      .set("Idempotency-Key", "notif-emergency-end")
      .send({
        deviceId: "d1",
        clientEventId: "e2",
        deviceTimestamp: new Date().toISOString(),
        latitude: SITE_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
        summaryText: "Reset the traffic light controller.",
        taskCategory: "EMERGENCY_REPAIR",
      })
      .expect(201);

    // The worker's Turan notification carries the raw Turan values.
    const workerRows = await listNotifications(WORKER_PHONE);
    expect(only(workerRows, "TURAN_ASSIGNMENT_CREATED").dataJson).toEqual({
      assignmentKind: "TURAN",
      turanAssignmentId: turan.body.id,
      turanType: "NIGHT_TURAN",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    const ownerRows = await listNotifications(OWNER_PHONE);
    const fmRows = await listNotifications(FM_PHONE);

    for (const rows of [ownerRows, fmRows]) {
      expect(only(rows, "EMERGENCY_SHIFT_STARTED").dataJson).toEqual({
        timeEntryId: started.body.timeEntryId,
        calloutId: started.body.calloutId,
        workerProfileId: worker.workerProfile.id,
        workerName: "Eli Worker",
        startedAt: new Date(started.body.actualStartClick).toISOString(),
        compensatedStartAt: new Date(started.body.compensatedStart).toISOString(),
        authorizationSource: "NIGHT_TURAN_ASSIGNMENT",
      });
    }

    const baseEndData = {
      timeEntryId: started.body.timeEntryId,
      calloutId: started.body.calloutId,
      workerProfileId: worker.workerProfile.id,
      workerName: "Eli Worker",
      endedAt: new Date(ended.body.actualEndClick).toISOString(),
      compensatedDurationMinutes: ended.body.compensatedDurationMinutes,
    };
    const fmEnd = only(fmRows, "EMERGENCY_SHIFT_ENDED");
    expect(fmEnd.body).not.toContain("Estimated cost");
    expect(fmEnd.dataJson).toEqual(baseEndData);

    const ownerEnd = only(ownerRows, "EMERGENCY_SHIFT_ENDED");
    expect(ownerEnd.dataJson).toEqual({ ...baseEndData, estimatedCostAgorot: expect.any(Number) });
    const cost = ownerEnd.dataJson!.estimatedCostAgorot as number;
    expect(cost).toBeGreaterThan(0);
    expect(ownerEnd.body).toContain(`Estimated cost: ₪${(cost / 100).toFixed(2)}`);

    await expectNoMoneyOutsideOwners(org.id);
  });

  it("approval, rejection, shift assignment and Turan cancellation give the worker the values the text is built from", async () => {
    const { org, shift, worker, fm } = await setup();
    const fmSession = await loginAs(app, FM_PHONE);

    // Shift assignment (sent as TURAN_ASSIGNMENT_CREATED with assignmentKind SHIFT).
    await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shift.id}/assignments`)
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({ workerProfileId: worker.workerProfile.id })
      .expect(201);

    // Two finished entries awaiting approval: approve one, reject the other.
    const businessDate = toBusinessDate(shift.scheduledStart);
    const pending = async (minutes: number) =>
      prisma.timeEntry.create({
        data: {
          id: uuidv7(),
          organizationId: org.id,
          workerProfileId: worker.workerProfile.id,
          shiftId: shift.id,
          status: TimeEntryStatus.PENDING_APPROVAL,
          businessDate,
          clockInAt: shift.scheduledStart,
          clockOutAt: new Date(shift.scheduledStart.getTime() + minutes * 60_000),
          rawDurationMinutes: minutes,
          checkInMethod: "GEOFENCED",
        },
      });
    const toApprove = await pending(600);
    const toReject = await pending(20);
    await request(app.getHttpServer()).post(`/api/v1/time-entries/${toApprove.id}/approve`).set("Authorization", `Bearer ${fmSession.accessToken}`).send({}).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/time-entries/${toReject.id}/reject`)
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({ reason: "Accidental double clock-in" })
      .expect(201);

    // Turan created then cancelled.
    const startAt = new Date(Date.now() + 24 * 3_600_000);
    const endAt = new Date(Date.now() + 34 * 3_600_000);
    const turan = await request(app.getHttpServer())
      .post("/api/v1/turan-assignments")
      .set("Authorization", `Bearer ${fmSession.accessToken}`)
      .send({ turanType: "DAY_TURAN", startAt: startAt.toISOString(), endAt: endAt.toISOString(), assignedWorkerProfileId: worker.workerProfile.id })
      .expect(201);
    await request(app.getHttpServer()).post(`/api/v1/turan-assignments/${turan.body.id}/cancel`).set("Authorization", `Bearer ${fmSession.accessToken}`).expect(201);

    const rows = await listNotifications(WORKER_PHONE);

    const shiftAssigned = rows.find((row) => row.type === "TURAN_ASSIGNMENT_CREATED" && row.dataJson?.assignmentKind === "SHIFT");
    expect(shiftAssigned?.title).toBe("New shift assignment");
    expect(shiftAssigned?.dataJson).toEqual({
      assignmentKind: "SHIFT",
      shiftId: shift.id,
      shiftTitle: "Test Shift",
      startAt: shift.scheduledStart.toISOString(),
      endAt: shift.scheduledEnd.toISOString(),
    });

    expect(only(rows, "SHIFT_APPROVED").dataJson).toEqual({
      timeEntryId: toApprove.id,
      shiftId: shift.id,
      shiftTitle: "Test Shift",
      businessDate,
      approvedRegularMinutes: 540,
      approvedOvertimeMinutes: 60,
    });

    const rejected = only(rows, "SHIFT_REJECTED");
    expect(rejected.body).toBe("Accidental double clock-in");
    expect(rejected.dataJson).toEqual({
      timeEntryId: toReject.id,
      shiftId: shift.id,
      shiftTitle: "Test Shift",
      businessDate,
      reason: "Accidental double clock-in",
    });

    expect(only(rows, "TURAN_ASSIGNMENT_CHANGED").dataJson).toEqual({
      change: "CANCELLED",
      turanAssignmentId: turan.body.id,
      turanType: "DAY_TURAN",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    await expectNoMoneyOutsideOwners(org.id);
    void fm;
  });

  it("strips money from a non-Owner recipient's data even if a call site passes it (safety net)", async () => {
    const { org, ownerUser, fm } = await setup();
    const notifications = app.get(NotificationsService);

    const toFm = await notifications.notify({
      organizationId: org.id,
      recipientUserId: fm.user.id,
      type: "WORKER_CLOCKED_OUT",
      title: "Worker clocked out",
      body: "Worker clocked out.",
      data: { shiftTitle: "Test Shift", durationMinutes: 60, estimatedCostAgorot: 12345, netPayableAgorot: 1 },
    });
    expect(toFm.dataJson).toEqual({ shiftTitle: "Test Shift", durationMinutes: 60 });

    const toOwner = await notifications.notify({
      organizationId: org.id,
      recipientUserId: ownerUser.id,
      type: "WORKER_CLOCKED_OUT",
      title: "Worker clocked out",
      body: "Worker clocked out.",
      data: { shiftTitle: "Test Shift", durationMinutes: 60, estimatedCostAgorot: 12345 },
    });
    expect(toOwner.dataJson).toEqual({ shiftTitle: "Test Shift", durationMinutes: 60, estimatedCostAgorot: 12345 });
  });
});
