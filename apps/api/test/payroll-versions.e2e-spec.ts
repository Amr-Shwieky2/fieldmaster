import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import {
  CheckInMethod,
  CorrectionReason,
  EmergencyAuthorizationSource,
  PayrollAdjustmentSource,
  PayrollAdjustmentType,
  ShiftStatus,
  ShiftType,
  TimeEntryStatus,
  TuranStatus,
  TuranType,
} from "@fieldmaster/shared-types";
import { computeEmergencyCompensation, getBusinessMonthRange, toBusinessDate, toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";
import { calculatePayroll, waitForCalculation } from "./payroll-helpers";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { PayrollInputsService } from "../src/modules/payroll/payroll-inputs.service";
import { PayrollCalculationProcessor } from "../src/modules/payroll/payroll-calculation.processor";
import { WorkRulesService } from "../src/common/settings/work-rules.service";

/**
 * Step 7: the payroll engine with the spec's concrete numbers (fixtures: daily
 * 45,000 agorot, hourly 5,000, overtime 7,000), immutable versions, the
 * background calculation, warnings, manual adjustments, the worker's own
 * statements and the Owner dashboard. Attendance goes through the real
 * endpoints wherever it can (approval, full-day credit, corrections,
 * reversals); entries are created the way a clock-out leaves them.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const DAILY = { type: "DAILY" as const, dailyRateAgorot: 45_000, overtimeRateAgorot: 7_000 };
const HOURLY = { type: "HOURLY" as const, hourlyRateAgorot: 5_000, overtimeRateAgorot: 7_000 };

const minutes = (n: number) => n * 60_000;

describe("Payroll versions, background calculation and dashboard (e2e, Step 7)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ctx: Awaited<ReturnType<typeof setupOrganization>>;
  let phoneCounter = 0;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    ctx = await setupOrganization();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function setupOrganization() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const manager = await addFieldManager(prisma, owner.org.id, MANAGER_PHONE, "Yossi Manager");
    const project = await createProject(prisma, owner.org.id);
    const { site, geofence } = await createSiteWithGeofence(prisma, owner.org.id, project.id, 32.08, 34.78, 100);
    const ownerSession = await loginAs(app, OWNER_PHONE);
    const managerSession = await loginAs(app, MANAGER_PHONE);
    return { org: owner.org, owner, manager, project, site, geofence, ownerToken: ownerSession.accessToken, managerToken: managerSession.accessToken };
  }

  async function worker(name: string, compensation?: typeof DAILY | typeof HOURLY) {
    phoneCounter += 1;
    const phone = `+97250002${String(phoneCounter).padStart(4, "0")}`;
    const created = await addWorker(prisma, ctx.org.id, phone, name, compensation);
    return { ...created, id: created.workerProfile.id, phone };
  }

  const http = () => app.getHttpServer();
  const asOwner = (req: ReturnType<ReturnType<typeof request>["get"]>) => req.set("Authorization", `Bearer ${ctx.ownerToken}`);
  const asManager = (req: ReturnType<ReturnType<typeof request>["get"]>) => req.set("Authorization", `Bearer ${ctx.managerToken}`);

  /** A shift of the organization's project/site starting at `start` (UTC). */
  async function shiftAt(
    start: Date,
    durationMinutes: number,
    place: { projectId: string; siteId: string; geofenceId: string } = { projectId: ctx.project.id, siteId: ctx.site.id, geofenceId: ctx.geofence.id },
  ) {
    return createStandardShift(
      prisma,
      ctx.org.id,
      place.projectId,
      place.siteId,
      place.geofenceId,
      ctx.manager.user.id,
      start,
      new Date(start.getTime() + minutes(durationMinutes)),
    );
  }

  /** An entry as a clock-out leaves it: closed, waiting for approval. */
  async function pendingEntry(
    workerProfileId: string,
    start: Date,
    durationMinutes: number,
    place?: { projectId: string; siteId: string; geofenceId: string },
  ) {
    const shift = await shiftAt(start, durationMinutes, place);
    await assignWorkerToShift(prisma, shift.id, workerProfileId, ctx.manager.user.id);
    return prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.org.id,
        workerProfileId,
        shiftId: shift.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        businessDate: toBusinessDate(start),
        clockInAt: start,
        clockOutAt: new Date(start.getTime() + minutes(durationMinutes)),
        rawDurationMinutes: durationMinutes,
        checkInMethod: CheckInMethod.GEOFENCED,
      },
    });
  }

  async function approve(timeEntryId: string) {
    const response = await asManager(request(http()).post(`/api/v1/time-entries/${timeEntryId}/approve`))
      .send({})
      .expect(201);
    return response.body;
  }

  /** Waiting for approval -> (full-day credit by the manager) -> approved by the manager. */
  async function approvedEntry(
    workerProfileId: string,
    start: Date,
    durationMinutes: number,
    options: { fullDayCredit?: boolean; place?: { projectId: string; siteId: string; geofenceId: string } } = {},
  ) {
    const entry = await pendingEntry(workerProfileId, start, durationMinutes, options.place);
    if (options.fullDayCredit) {
      await asManager(request(http()).post(`/api/v1/time-entries/${entry.id}/full-day-credit`))
        .send({ reason: "Rain stopped the work" })
        .expect(201);
    }
    await approve(entry.id);
    return entry;
  }

  /** A Night Turan emergency call-out, stored exactly as the emergency endpoints store it (-60 / +15 around the clicks), waiting for approval. */
  async function nightTuranEmergency(workerProfileId: string, actualStartClick: Date, actualEndClick: Date) {
    const compensation = computeEmergencyCompensation(actualStartClick, actualEndClick, await app.get(WorkRulesService).rulesOn(ctx.org.id, toBusinessDate(actualStartClick)));
    const turan = await prisma.turanAssignment.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.org.id,
        turanType: TuranType.NIGHT_TURAN,
        status: TuranStatus.COMPLETED,
        startAt: new Date(actualStartClick.getTime() - minutes(180)),
        endAt: new Date(actualEndClick.getTime() + minutes(180)),
        assignedWorkerProfileId: workerProfileId,
        createdBy: ctx.owner.user.id,
      },
    });
    const shift = await prisma.shift.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.org.id,
        shiftType: ShiftType.EMERGENCY_CALLOUT,
        title: "Emergency Call-out",
        scheduledStart: compensation.compensatedStart,
        scheduledEnd: compensation.compensatedEnd,
        checkInMethod: CheckInMethod.FLEXI_CHECK,
        businessDate: toBusinessDate(compensation.compensatedStart),
        managerId: ctx.manager.user.id,
        status: ShiftStatus.ACTIVE,
        createdBy: workerProfileId,
      },
    });
    const entry = await prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.org.id,
        workerProfileId,
        shiftId: shift.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        businessDate: toBusinessDate(compensation.compensatedStart),
        clockInAt: compensation.compensatedStart,
        clockOutAt: compensation.compensatedEnd,
        rawDurationMinutes: compensation.compensatedDurationMinutes,
        checkInMethod: CheckInMethod.FLEXI_CHECK,
        isEmergency: true,
      },
    });
    await prisma.emergencyCallout.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.org.id,
        turanAssignmentId: turan.id,
        workerProfileId,
        timeEntryId: entry.id,
        authorizationSource: EmergencyAuthorizationSource.NIGHT_TURAN_ASSIGNMENT,
        actualStartClick,
        compensatedStart: compensation.compensatedStart,
        actualEndClick,
        compensatedEnd: compensation.compensatedEnd,
        actualWorkedMinutes: compensation.actualWorkedMinutes,
        retroactiveMinutes: compensation.retroactiveMinutes,
        returnBufferMinutes: compensation.returnBufferMinutes,
        compensatedDurationMinutes: compensation.compensatedDurationMinutes,
        startLatitude: 32.08,
        startLongitude: 34.78,
        endLatitude: 32.08,
        endLongitude: 34.78,
      },
    });
    return entry;
  }

  /** A manual correction by the manager (the real endpoint; FORGOTTEN_* reasons record an infraction). */
  function correct(body: Record<string, unknown>) {
    return asManager(request(http()).post("/api/v1/manual-corrections")).send(body);
  }

  async function detail(yearMonth: string, version?: number) {
    const path = version === undefined ? `/api/v1/payroll-periods/${yearMonth}` : `/api/v1/payroll-periods/${yearMonth}/versions/${version}`;
    return (await asOwner(request(http()).get(path)).expect(200)).body;
  }

  function line(body: { workers: { workerProfileId: string }[] }, workerProfileId: string) {
    const found = body.workers.find((row) => row.workerProfileId === workerProfileId);
    if (!found) throw new Error(`worker ${workerProfileId} not in ${JSON.stringify(body.workers)}`);
    return found as Record<string, unknown>;
  }

  describe("calculation numbers (daily 45,000 / hourly 5,000 / overtime 7,000)", () => {
    it("daily: 9 h -> 45,000; 6 h without credit -> 30,000; 6 h with credit -> 45,000; 10 h 30 m -> 45,000 + 10,500", async () => {
      const nine = await worker("Daily Nine", DAILY);
      const six = await worker("Daily Six", DAILY);
      const credited = await worker("Daily Credit", DAILY);
      const long = await worker("Daily Long", DAILY);
      // 07:00 Asia/Jerusalem (UTC+2 in early March 2026).
      await approvedEntry(nine.id, new Date("2026-03-03T05:00:00Z"), 540);
      await approvedEntry(six.id, new Date("2026-03-03T05:00:00Z"), 360);
      await approvedEntry(credited.id, new Date("2026-03-03T05:00:00Z"), 360, { fullDayCredit: true });
      const longEntry = await approvedEntry(long.id, new Date("2026-03-03T05:00:00Z"), 630);

      await calculatePayroll(app, ctx.ownerToken, "2026-03");
      const body = await detail("2026-03");

      expect(body).toMatchObject({ status: "REVIEW", version: 1, isCurrent: true, legacy: false });
      expect(line(body, nine.id)).toMatchObject({
        approvedShifts: 1,
        standardDaysCredited: 1,
        regularMinutes: 540,
        overtimeMinutes: 0,
        grossBaseAgorot: 45_000,
        overtimeAgorot: 0,
        netPayableAgorot: 45_000,
      });
      expect(line(body, six.id)).toMatchObject({
        standardDaysCredited: 0,
        regularMinutes: 360,
        grossBaseAgorot: 30_000,
        overtimeAgorot: 0,
        netPayableAgorot: 30_000,
      });
      expect(line(body, credited.id)).toMatchObject({
        standardDaysCredited: 1,
        regularMinutes: 540,
        grossBaseAgorot: 45_000,
        overtimeAgorot: 0,
        netPayableAgorot: 45_000,
      });
      expect(line(body, long.id)).toMatchObject({
        standardDaysCredited: 1,
        regularMinutes: 540,
        overtimeMinutes: 90,
        grossBaseAgorot: 45_000,
        overtimeAgorot: 10_500,
        netPayableAgorot: 55_500,
      });
      expect(body.totals).toMatchObject({ workers: 4, approvedShifts: 4, grossBaseAgorot: 165_000, overtimeAgorot: 10_500, netPayableAgorot: 175_500 });

      // Drill-down: the entry as the calculation saw and paid it.
      const drill = (await asOwner(request(http()).get(`/api/v1/payroll-periods/2026-03/versions/1/workers/${long.id}`)).expect(200)).body;
      expect(drill.entries).toEqual([
        expect.objectContaining({
          timeEntryId: longEntry.id,
          businessDate: "2026-03-03",
          approvedRegularMinutes: 540,
          approvedOvertimeMinutes: 90,
          compensationType: "DAILY",
          baseAgorot: 45_000,
          overtimeAgorot: 10_500,
          totalAgorot: 55_500,
          projectName: "Test Project",
          siteName: "Test Site",
        }),
      ]);
    });

    it("hourly: 6 h -> 30,000; a Night Turan emergency 02:00-03:00 -> 135 compensated minutes -> 11,250", async () => {
      const six = await worker("Hourly Six", HOURLY);
      const night = await worker("Night Turan", HOURLY);
      await approvedEntry(six.id, new Date("2026-03-03T05:00:00Z"), 360);
      // 02:00-03:00 Asia/Jerusalem on 10 March 2026 = 00:00-01:00 UTC; paid 01:00-03:15.
      const emergency = await nightTuranEmergency(night.id, new Date("2026-03-10T00:00:00Z"), new Date("2026-03-10T01:00:00Z"));
      const approved = await approve(emergency.id);
      expect(approved).toMatchObject({ approvedRegularMinutes: 135, approvedOvertimeMinutes: 0, businessDate: "2026-03-10" });

      await calculatePayroll(app, ctx.ownerToken, "2026-03");
      const body = await detail("2026-03");
      expect(line(body, six.id)).toMatchObject({ regularMinutes: 360, overtimeMinutes: 0, grossBaseAgorot: 30_000, netPayableAgorot: 30_000 });
      expect(line(body, night.id)).toMatchObject({
        approvedShifts: 1,
        regularMinutes: 135,
        overtimeMinutes: 0,
        emergencyRetroactiveMinutes: 60,
        emergencyReturnMinutes: 15,
        grossBaseAgorot: 11_250,
        netPayableAgorot: 11_250,
      });
      // The emergency has no project or site: its own group.
      expect(body.projects).toEqual(expect.arrayContaining([expect.objectContaining({ id: null, name: null, totalAgorot: 11_250, approvedShifts: 1 })]));
    });

    it("forgotten stamps: 4 in a month -> -2,000; reversing one -> -1,000, and the original deduction is kept", async () => {
      const forgetful = await worker("Forgetful", DAILY);
      // Four forgotten clock-ins: each correction creates the entry, so it counts in the clock-in's month (March).
      for (let day = 2; day <= 5; day++) {
        const start = new Date(`2026-03-0${day}T05:00:00Z`);
        const shift = await shiftAt(start, 540);
        await assignWorkerToShift(prisma, shift.id, forgetful.id, ctx.manager.user.id);
        const created = await correct({
          shiftId: shift.id,
          workerProfileId: forgetful.id,
          field: "CLOCK_IN",
          newValue: start.toISOString(),
          reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
        }).expect(201);
        await correct({
          timeEntryId: created.body.timeEntry.id,
          field: "CLOCK_OUT",
          newValue: new Date(start.getTime() + minutes(540)).toISOString(),
          reason: CorrectionReason.MANAGER_INSTRUCTION,
        }).expect(201);
        await approve(created.body.timeEntry.id);
      }
      const infractions = (await asOwner(request(http()).get("/api/v1/forgotten-stamp-infractions?month=2026-03")).expect(200)).body as {
        id: string;
        monthlySequenceNumber: number;
        deductionAgorot: number;
      }[];
      expect(infractions.map((i) => [i.monthlySequenceNumber, i.deductionAgorot]).sort()).toEqual([
        [1, 0],
        [2, 0],
        [3, 1_000],
        [4, 1_000],
      ]);

      await calculatePayroll(app, ctx.ownerToken, "2026-03");
      expect(line(await detail("2026-03"), forgetful.id)).toMatchObject({
        approvedShifts: 4,
        grossBaseAgorot: 180_000,
        forgottenStampPenaltiesAgorot: 2_000,
        reversalsAgorot: 0,
        netPayableAgorot: 178_000,
      });

      const third = infractions.find((i) => i.monthlySequenceNumber === 3)!;
      const penalty = await prisma.payrollAdjustment.findFirstOrThrow({
        where: { relatedInfractionId: third.id, type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY },
      });
      await asOwner(request(http()).post(`/api/v1/forgotten-stamp-infractions/${third.id}/reverse`))
        .send({ reason: "The phone was broken that week" })
        .expect(201);

      // Not included until the next calculation, and the working version says the month changed.
      const before = await detail("2026-03");
      expect(before.changedSinceCalculation).toBe(true);
      expect(before.adjustmentsNotIncluded).toEqual([
        expect.objectContaining({ type: "FORGOTTEN_STAMP_REVERSAL", amountAgorot: 1_000, reversalOfId: penalty.id }),
      ]);

      await calculatePayroll(app, ctx.ownerToken, "2026-03");
      const after = await detail("2026-03");
      expect(after.changedSinceCalculation).toBe(false);
      expect(line(after, forgetful.id)).toMatchObject({ forgottenStampPenaltiesAgorot: 2_000, reversalsAgorot: 1_000, netPayableAgorot: 179_000 });
      // The original deduction is untouched; the reversal is a separate, offsetting adjustment that links to it.
      expect(await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: penalty.id } })).toMatchObject({
        amountAgorot: -1_000,
        type: "FORGOTTEN_STAMP_PENALTY",
      });
      const lines = after.adjustments as { id: string; type: string; reversalOfId: string | null; reversedById: string | null; timeEntryId: string | null }[];
      expect(lines).toHaveLength(3);
      const reversal = lines.find((l) => l.type === "FORGOTTEN_STAMP_REVERSAL")!;
      expect(reversal.reversalOfId).toBe(penalty.id);
      expect(lines.find((l) => l.id === penalty.id)).toMatchObject({ reversedById: reversal.id, timeEntryId: expect.any(String) });
    });
  });

  describe("dates", () => {
    it("a mid-month rate change pays each shift at the rate in effect on its date", async () => {
      const raised = await worker("Raised Mid-Month");
      const createdBy = ctx.owner.user.id;
      await prisma.compensationProfile.create({
        data: {
          id: uuidv7(),
          workerProfileId: raised.id,
          compensationType: "DAILY",
          dailyBaseRateAgorot: 45_000,
          overtimeHourlyRateAgorot: 7_000,
          effectiveStartDate: new Date("2020-01-01"),
          effectiveEndDate: new Date("2026-04-14"),
          changeReason: "Start",
          createdBy,
        },
      });
      await prisma.compensationProfile.create({
        data: {
          id: uuidv7(),
          workerProfileId: raised.id,
          compensationType: "DAILY",
          dailyBaseRateAgorot: 50_000,
          overtimeHourlyRateAgorot: 7_000,
          effectiveStartDate: new Date("2026-04-15"),
          changeReason: "Raise",
          createdBy,
        },
      });
      // 09:00 Asia/Jerusalem (UTC+3) on the 14th and the 15th.
      await approvedEntry(raised.id, new Date("2026-04-14T06:00:00Z"), 540);
      await approvedEntry(raised.id, new Date("2026-04-15T06:00:00Z"), 540);

      await calculatePayroll(app, ctx.ownerToken, "2026-04");
      expect(line(await detail("2026-04"), raised.id)).toMatchObject({ approvedShifts: 2, standardDaysCredited: 2, grossBaseAgorot: 95_000 });
      const drill = (await asOwner(request(http()).get(`/api/v1/payroll-periods/2026-04/versions/1/workers/${raised.id}`)).expect(200)).body;
      expect(drill.entries.map((e: { businessDate: string; baseAgorot: number }) => [e.businessDate, e.baseAgorot])).toEqual([
        ["2026-04-14", 45_000],
        ["2026-04-15", 50_000],
      ]);
    });

    it("a shift starting 00:30 Asia/Jerusalem on the 1st (21:30 UTC the day before) counts in the new month", async () => {
      const early = await worker("Early Bird", DAILY);
      const start = new Date("2026-04-30T21:30:00Z"); // 1 May 2026, 00:30 in Jerusalem (UTC+3)
      const shift = await shiftAt(start, 540);
      await assignWorkerToShift(prisma, shift.id, early.id, ctx.manager.user.id);
      const created = await correct({
        shiftId: shift.id,
        workerProfileId: early.id,
        field: "CLOCK_IN",
        newValue: start.toISOString(),
        reason: CorrectionReason.DEVICE_FAILURE,
      }).expect(201);
      expect(created.body.timeEntry.businessDate).toBe("2026-05-01");
      await correct({
        timeEntryId: created.body.timeEntry.id,
        field: "CLOCK_OUT",
        newValue: new Date(start.getTime() + minutes(540)).toISOString(),
        reason: CorrectionReason.DEVICE_FAILURE,
      }).expect(201);
      await approve(created.body.timeEntry.id);

      await calculatePayroll(app, ctx.ownerToken, "2026-05");
      expect(line(await detail("2026-05"), early.id)).toMatchObject({ approvedShifts: 1, grossBaseAgorot: 45_000 });
      await calculatePayroll(app, ctx.ownerToken, "2026-04");
      expect((await detail("2026-04")).workers).toEqual([]);
    });
  });

  describe("immutable versions", () => {
    it("finalize -> Field Manager edits refused (409) -> Owner reopens with a reason -> version 2, version 1 unchanged and readable -> recalculate -> finalize version 2", async () => {
      const steady = await worker("Steady Worker", DAILY);
      const nine = await approvedEntry(steady.id, new Date("2026-06-02T06:00:00Z"), 540);
      const six = await approvedEntry(steady.id, new Date("2026-06-03T06:00:00Z"), 360);
      const waiting = await pendingEntry(steady.id, new Date("2026-06-04T06:00:00Z"), 540);

      await calculatePayroll(app, ctx.ownerToken, "2026-06");
      const v1Calculated = await detail("2026-06");
      expect(v1Calculated).toMatchObject({ version: 1, status: "REVIEW", totals: { netPayableAgorot: 75_000 }, pending: { entries: 1 } });
      expect(line(v1Calculated, steady.id)).toMatchObject({ pendingEntries: 1 });

      const finalized = (await asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/finalize")).expect(201)).body;
      expect(finalized).toMatchObject({
        version: 1,
        status: "FINALIZED",
        allowedActions: { calculate: false, finalize: false, reopen: true, addAdjustment: false },
      });
      const v1Before = await detail("2026-06", 1);
      const v1RowBefore = await prisma.payrollPeriod.findFirstOrThrow({ where: { yearMonth: "2026-06", version: 1 } });

      // Every edit of the finalized month is refused.
      const refused = async (pending: Promise<{ status: number; body: { code: string } }>) => {
        const response = await pending;
        expect({ status: response.status, code: response.body.code }).toEqual({ status: 409, code: "PAYROLL_PERIOD_FINALIZED" });
      };
      await refused(
        correct({
          timeEntryId: nine.id,
          field: "CLOCK_OUT",
          newValue: new Date("2026-06-02T16:00:00Z").toISOString(),
          reason: CorrectionReason.MANAGER_INSTRUCTION,
        }),
      );
      await refused(asManager(request(http()).post(`/api/v1/time-entries/${six.id}/full-day-credit`)).send({ reason: "Rain" }));
      await refused(asManager(request(http()).post(`/api/v1/time-entries/${waiting.id}/approve`)).send({}));
      await refused(asManager(request(http()).post(`/api/v1/time-entries/${nine.id}/request-correction`)).send({ notes: "Check the hours" }));
      await refused(asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/calculate")).set("Idempotency-Key", uuidv7()));
      await refused(
        asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/adjustments")).send({
          workerProfileId: steady.id,
          type: "MANUAL_BONUS",
          amountAgorot: 5_000,
          reason: "Bonus",
        }),
      );
      await refused(asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/finalize")));

      // The database itself refuses to change a finalized version, its items or its snapshot.
      await expect(prisma.payrollPeriod.update({ where: { id: v1RowBefore.id }, data: { reopenReason: "tamper" } })).rejects.toThrow(/finalized/);
      await expect(prisma.payrollItem.updateMany({ where: { payrollPeriodId: v1RowBefore.id }, data: { netPayableAgorot: 1 } })).rejects.toThrow(/finalized/);
      await expect(prisma.payrollCalculationSnapshot.update({ where: { id: v1RowBefore.currentSnapshotId! }, data: { version: 99 } })).rejects.toThrow(
        /immutable/,
      );

      // Reopen: Owner only, with a reason.
      await asManager(request(http()).post("/api/v1/payroll-periods/2026-06/reopen")).send({ reason: "Missing shift" }).expect(403);
      await asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/reopen")).send({}).expect(400);
      await asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/reopen")).send({ reason: "   " }).expect(400);
      const reopened = (
        await asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/reopen")).send({ reason: "A shift waiting for approval was left out" }).expect(201)
      ).body;
      expect(reopened).toMatchObject({
        version: 2,
        status: "REOPENED",
        isCurrent: true,
        previousVersion: 1,
        reopenReason: "A shift waiting for approval was left out",
        reopenedByName: "Dana Owner",
        totals: null,
        workers: [],
        allowedActions: { calculate: true, finalize: false, reopen: false, addAdjustment: true },
      });
      const again = await asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/reopen")).send({ reason: "Twice" }).expect(409);
      expect(again.body.code).toBe("PAYROLL_PERIOD_NOT_FINALIZED");

      // Version 1 is unchanged and still readable (only "is it the latest" changed).
      const v1After = await detail("2026-06", 1);
      expect(v1After).toEqual({ ...v1Before, isCurrent: false, allowedActions: { calculate: false, finalize: false, reopen: false, addAdjustment: false } });
      expect(await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: v1RowBefore.id } })).toEqual(v1RowBefore);

      // The working version accepts edits again; the worker still sees version 1 (the last finalized one).
      const workerSession = await loginAs(app, steady.phone);
      const statementsBetween = (
        await request(http()).get("/api/v1/payroll-statements/me").set("Authorization", `Bearer ${workerSession.accessToken}`).expect(200)
      ).body;
      expect(statementsBetween.statements).toEqual([
        expect.objectContaining({ yearMonth: "2026-06", version: 1, status: "FINALIZED", netPayableAgorot: 75_000 }),
      ]);
      await approve(waiting.id);
      await asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/adjustments"))
        .send({ workerProfileId: steady.id, type: "MANUAL_BONUS", amountAgorot: 5_000, reason: "Covered a colleague" })
        .expect(201);

      await calculatePayroll(app, ctx.ownerToken, "2026-06");
      const v2 = await detail("2026-06");
      expect(v2).toMatchObject({ version: 2, status: "REVIEW", totals: { netPayableAgorot: 125_000 }, pending: { entries: 0 } });
      expect(line(v2, steady.id)).toMatchObject({ approvedShifts: 3, grossBaseAgorot: 120_000, positiveAdjustmentsAgorot: 5_000, netPayableAgorot: 125_000 });
      await asOwner(request(http()).post("/api/v1/payroll-periods/2026-06/finalize")).expect(201);

      const versions = (await asOwner(request(http()).get("/api/v1/payroll-periods/2026-06/versions")).expect(200)).body;
      expect(versions).toEqual([
        expect.objectContaining({
          version: 2,
          status: "FINALIZED",
          isCurrent: true,
          reopenReason: "A shift waiting for approval was left out",
          reopenedByName: "Dana Owner",
          finalizedByName: "Dana Owner",
          netPayableAgorot: 125_000,
          workers: 1,
        }),
        expect.objectContaining({
          version: 1,
          status: "FINALIZED",
          isCurrent: false,
          reopenReason: null,
          createdByName: "Dana Owner",
          finalizedByName: "Dana Owner",
          netPayableAgorot: 75_000,
          workers: 1,
        }),
      ]);
      expect((await detail("2026-06", 1)).totals.netPayableAgorot).toBe(75_000);
      const months = (await asOwner(request(http()).get("/api/v1/payroll-periods")).expect(200)).body;
      expect(months).toEqual([expect.objectContaining({ yearMonth: "2026-06", version: 2, versionCount: 2, status: "FINALIZED", netPayableAgorot: 125_000 })]);

      const statementsAfter = (
        await request(http()).get("/api/v1/payroll-statements/me").set("Authorization", `Bearer ${workerSession.accessToken}`).expect(200)
      ).body;
      expect(statementsAfter.statements).toEqual([
        expect.objectContaining({ yearMonth: "2026-06", version: 2, netPayableAgorot: 125_000, adjustmentsAgorot: 5_000 }),
      ]);

      const reopenAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PAYROLL_PERIOD_REOPENED" } });
      expect(reopenAudit).toMatchObject({ entityId: v1RowBefore.id, reason: "A shift waiting for approval was left out", oldValue: "1", newValue: "2" });
    });
  });

  describe("background calculation", () => {
    function startCalculation(yearMonth: string, key: string) {
      return asOwner(request(http()).post(`/api/v1/payroll-periods/${yearMonth}/calculate`)).set("Idempotency-Key", key);
    }

    it("the same Idempotency-Key returns the same job; a calculation while one is queued or running is refused", async () => {
      const steady = await worker("Steady", DAILY);
      await approvedEntry(steady.id, new Date("2026-07-01T06:00:00Z"), 540);
      const jobs = app.get(PayrollCalculationProcessor).worker;
      await jobs.pause();
      try {
        const first = await startCalculation("2026-07", "key-1").expect(202);
        expect(first.body).toMatchObject({ yearMonth: "2026-07", version: 1, state: "QUEUED", progress: 0 });
        const replay = await startCalculation("2026-07", "key-1").expect(202);
        expect(replay.body.id).toBe(first.body.id);

        const concurrent = await startCalculation("2026-07", "key-2").expect(409);
        expect(concurrent.body.code).toBe("PAYROLL_CALCULATION_IN_PROGRESS");
        const both = await Promise.all([startCalculation("2026-07", "key-3"), startCalculation("2026-07", "key-4")]);
        expect(both.map((r) => [r.status, r.body.code])).toEqual([
          [409, "PAYROLL_CALCULATION_IN_PROGRESS"],
          [409, "PAYROLL_CALCULATION_IN_PROGRESS"],
        ]);
        const finalize = await asOwner(request(http()).post("/api/v1/payroll-periods/2026-07/finalize")).expect(409);
        expect(finalize.body.code).toBe("PAYROLL_CALCULATION_IN_PROGRESS");
        expect(await detail("2026-07")).toMatchObject({
          status: "CALCULATING",
          calculation: { id: first.body.id, state: "QUEUED" },
          allowedActions: { calculate: false },
        });
      } finally {
        jobs.resume();
      }
      const finished = await waitForCalculation(app, ctx.ownerToken, "2026-07", (await detail("2026-07")).calculation.id);
      expect(finished).toMatchObject({ state: "SUCCEEDED", progress: 100, processedWorkers: 1, totalWorkers: 1 });
      // Even after it finished, the key still answers the same job.
      expect((await startCalculation("2026-07", "key-1").expect(202)).body).toMatchObject({ id: finished.id, state: "SUCCEEDED" });

      // Two requests at the same moment: exactly one starts a job.
      await jobs.pause();
      try {
        const race = await Promise.all([startCalculation("2026-07", "key-5"), startCalculation("2026-07", "key-6")]);
        expect(race.map((r) => r.status).sort()).toEqual([202, 409]);
      } finally {
        jobs.resume();
      }
      await waitForCalculation(app, ctx.ownerToken, "2026-07", (await detail("2026-07")).calculation.id);
      expect(await prisma.payrollCalculationRun.count({ where: { state: "SUCCEEDED" } })).toBe(2);

      // A key is bound to its request: another month with it is a conflict; no key at all is refused.
      expect((await startCalculation("2026-08", "key-1").expect(409)).body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
      expect((await asOwner(request(http()).post("/api/v1/payroll-periods/2026-07/calculate")).expect(400)).body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      // A malformed month never becomes a payroll period.
      await startCalculation("2026-13", "key-7").expect(400);
      expect(await prisma.payrollPeriod.count({ where: { yearMonth: "2026-13" } })).toBe(0);
    });

    it("a run that stopped without finishing is replaced by the next calculation", async () => {
      const steady = await worker("Steady", DAILY);
      await approvedEntry(steady.id, new Date("2026-07-01T06:00:00Z"), 540);
      const jobs = app.get(PayrollCalculationProcessor).worker;
      await jobs.pause();
      let stuckId = "";
      try {
        stuckId = (await startCalculation("2026-07", "stuck").expect(202)).body.id;
        await prisma.payrollCalculationRun.update({ where: { id: stuckId }, data: { requestedAt: new Date(Date.now() - minutes(20)) } });
        const replacement = await startCalculation("2026-07", "replacement").expect(202);
        expect(replacement.body.id).not.toBe(stuckId);
        expect(await prisma.payrollCalculationRun.findUniqueOrThrow({ where: { id: stuckId } })).toMatchObject({
          state: "FAILED",
          errorCode: "PAYROLL_CALCULATION_STALE",
        });
      } finally {
        jobs.resume();
      }
      const run = await waitForCalculation(app, ctx.ownerToken, "2026-07", (await detail("2026-07")).calculation.id);
      expect(run.state).toBe("SUCCEEDED");
      expect(await prisma.payrollCalculationRun.findUniqueOrThrow({ where: { id: stuckId } })).toMatchObject({ state: "FAILED" });
    });

    it("a failed calculation is a clear error state and keeps the previous results", async () => {
      const steady = await worker("Steady", DAILY);
      await approvedEntry(steady.id, new Date("2026-07-01T06:00:00Z"), 540);
      const inputs = app.get(PayrollInputsService);

      jest.spyOn(inputs, "load").mockRejectedValueOnce(new Error("database went away"));
      const failedFirst = await startCalculation("2026-07", uuidv7()).expect(202);
      const failedRun = await waitForCalculation(app, ctx.ownerToken, "2026-07", failedFirst.body.id);
      expect(failedRun).toMatchObject({ state: "FAILED", errorCode: "PAYROLL_CALCULATION_FAILED" });
      expect(await detail("2026-07")).toMatchObject({
        status: "OPEN",
        totals: null,
        calculation: { state: "FAILED", errorCode: "PAYROLL_CALCULATION_FAILED" },
        allowedActions: { calculate: true },
      });

      await calculatePayroll(app, ctx.ownerToken, "2026-07");
      const calculated = await detail("2026-07");
      expect(calculated.totals.netPayableAgorot).toBe(45_000);

      await approvedEntry(steady.id, new Date("2026-07-02T06:00:00Z"), 540);
      jest.spyOn(inputs, "load").mockRejectedValueOnce(new Error("database went away"));
      const failedAgain = await startCalculation("2026-07", uuidv7()).expect(202);
      await waitForCalculation(app, ctx.ownerToken, "2026-07", failedAgain.body.id);
      const kept = await detail("2026-07");
      expect(kept).toMatchObject({
        status: "REVIEW",
        calculatedAt: calculated.calculatedAt,
        totals: { netPayableAgorot: 45_000 },
        changedSinceCalculation: true,
      });
      expect(kept.calculation).toMatchObject({ state: "FAILED", errorCode: "PAYROLL_CALCULATION_FAILED" });
      expect(await prisma.auditLog.count({ where: { action: "PAYROLL_CALCULATION_FAILED" } })).toBe(2);
    });
  });

  describe("inputs, warnings and adjustments", () => {
    it("warns about approved entries without a compensation profile and leaves entries waiting for approval out, with counts", async () => {
      const paid = await worker("Paid Worker", DAILY);
      const unpaid = await worker("No Rate Yet");
      const waiting = await worker("Waiting Worker", HOURLY);
      await approvedEntry(paid.id, new Date("2026-08-03T06:00:00Z"), 540);
      await pendingEntry(paid.id, new Date("2026-08-04T06:00:00Z"), 540);
      await approvedEntry(unpaid.id, new Date("2026-08-05T06:00:00Z"), 540);
      await pendingEntry(waiting.id, new Date("2026-08-05T06:00:00Z"), 360);

      await calculatePayroll(app, ctx.ownerToken, "2026-08");
      const body = await detail("2026-08");
      expect(body.warnings.workersWithoutCompensation).toEqual([
        { workerProfileId: unpaid.id, fullLegalName: "No Rate Yet", entries: 1, businessDates: ["2026-08-05"] },
      ]);
      expect(line(body, unpaid.id)).toMatchObject({ approvedShifts: 0, entriesWithoutCompensation: 1, grossBaseAgorot: 0, netPayableAgorot: 0 });
      expect(line(body, paid.id)).toMatchObject({ approvedShifts: 1, pendingEntries: 1, netPayableAgorot: 45_000 });
      expect(body.pending).toEqual({
        entries: 2,
        byWorker: expect.arrayContaining([
          { workerProfileId: paid.id, fullLegalName: "Paid Worker", entries: 1 },
          { workerProfileId: waiting.id, fullLegalName: "Waiting Worker", entries: 1 },
        ]),
      });
      expect(body.workers.map((w: { workerProfileId: string }) => w.workerProfileId)).not.toContain(waiting.id);
      expect(body.totals).toMatchObject({ workers: 2, netPayableAgorot: 45_000 });
    });

    it("manual adjustments: Owner only, a reason and a positive amount, counted from the next calculation (+/-)", async () => {
      const steady = await worker("Steady", DAILY);
      const bonusOnly = await worker("Bonus Only", HOURLY);
      await approvedEntry(steady.id, new Date("2026-08-03T06:00:00Z"), 540);
      await calculatePayroll(app, ctx.ownerToken, "2026-08");

      const adjust = (body: Record<string, unknown>) => asOwner(request(http()).post("/api/v1/payroll-periods/2026-08/adjustments")).send(body);
      await asManager(request(http()).post("/api/v1/payroll-periods/2026-08/adjustments"))
        .send({ workerProfileId: steady.id, type: "MANUAL_BONUS", amountAgorot: 100, reason: "x" })
        .expect(403);
      await adjust({ workerProfileId: steady.id, type: "MANUAL_BONUS", amountAgorot: 0, reason: "Zero" }).expect(400);
      await adjust({ workerProfileId: steady.id, type: "MANUAL_BONUS", amountAgorot: 12.5, reason: "Fraction" }).expect(400);
      await adjust({ workerProfileId: steady.id, type: "MANUAL_BONUS", amountAgorot: 100, reason: "  " }).expect(400);
      await adjust({ workerProfileId: steady.id, type: "FORGOTTEN_STAMP_PENALTY", amountAgorot: 100, reason: "Not manual" }).expect(400);
      await adjust({ workerProfileId: "not-a-uuid", type: "MANUAL_BONUS", amountAgorot: 100, reason: "Bad id" }).expect(400);
      await adjust({ workerProfileId: uuidv7(), type: "MANUAL_BONUS", amountAgorot: 100, reason: "Unknown" }).expect(404);

      const bonus = await adjust({ workerProfileId: steady.id, type: "MANUAL_BONUS", amountAgorot: 2_500, reason: "  Weekend cover  " }).expect(201);
      expect(bonus.body).toMatchObject({
        type: "MANUAL_BONUS",
        source: "MANUAL",
        amountAgorot: 2_500,
        reason: "Weekend cover",
        fullLegalName: "Steady",
        createdByName: "Dana Owner",
      });
      await adjust({ workerProfileId: steady.id, type: "MANUAL_DEDUCTION", amountAgorot: 700, reason: "Lost safety vest" }).expect(201);
      await adjust({ workerProfileId: bonusOnly.id, type: "MANUAL_BONUS", amountAgorot: 1_000, reason: "Referral bonus" }).expect(201);

      const before = await detail("2026-08");
      expect(before.changedSinceCalculation).toBe(true);
      expect(before.adjustmentsNotIncluded).toHaveLength(3);
      expect(before.totals.netPayableAgorot).toBe(45_000);

      await calculatePayroll(app, ctx.ownerToken, "2026-08");
      const after = await detail("2026-08");
      expect(after.adjustmentsNotIncluded).toEqual([]);
      expect(line(after, steady.id)).toMatchObject({ positiveAdjustmentsAgorot: 2_500, otherDeductionsAgorot: 700, netPayableAgorot: 46_800 });
      expect(line(after, bonusOnly.id)).toMatchObject({ approvedShifts: 0, positiveAdjustmentsAgorot: 1_000, netPayableAgorot: 1_000 });
      expect(await prisma.auditLog.count({ where: { action: "PAYROLL_ADJUSTMENT_CREATED" } })).toBe(3);
    });
  });

  describe("the worker's own salary statements", () => {
    it("only the caller's own data, only finalized versions, plus a labeled estimate for the open month", async () => {
      const own = await worker("Own Worker", DAILY);
      const other = await worker("Other Worker", HOURLY);
      await approvedEntry(own.id, new Date("2026-02-03T05:00:00Z"), 630);
      await approvedEntry(other.id, new Date("2026-02-03T05:00:00Z"), 600);
      await calculatePayroll(app, ctx.ownerToken, "2026-02");
      await asOwner(request(http()).post("/api/v1/payroll-periods/2026-02/finalize")).expect(201);
      // A calculated but not finalized month is never a statement.
      await approvedEntry(own.id, new Date("2026-01-05T05:00:00Z"), 540);
      await calculatePayroll(app, ctx.ownerToken, "2026-01");

      // The open month: one approved and one waiting entry of the caller (the other worker's are never read).
      const currentMonth = toBusinessYearMonth(new Date());
      const monthStart = getBusinessMonthRange(currentMonth).startUtc;
      await approvedEntry(own.id, new Date(monthStart.getTime() + minutes(8 * 60)), 540);
      await pendingEntry(own.id, new Date(monthStart.getTime() + minutes(32 * 60)), 540);
      await approvedEntry(other.id, new Date(monthStart.getTime() + minutes(8 * 60)), 540);

      const session = await loginAs(app, own.phone);
      const body = (await request(http()).get("/api/v1/payroll-statements/me").set("Authorization", `Bearer ${session.accessToken}`).expect(200)).body;
      expect(body.statements).toEqual([
        {
          yearMonth: "2026-02",
          status: "FINALIZED",
          isEstimate: false,
          version: 1,
          finalizedAt: expect.any(String),
          approvedShifts: 1,
          standardDaysCredited: 1,
          regularMinutes: 540,
          overtimeMinutes: 90,
          baseAgorot: 45_000,
          overtimeAgorot: 10_500,
          grossAgorot: 55_500,
          adjustmentsAgorot: 0,
          forgottenStampDeductionsAgorot: 0,
          netPayableAgorot: 55_500,
          pendingEntries: null,
        },
      ]);
      expect(body.estimates[0]).toMatchObject({
        yearMonth: currentMonth,
        status: "DRAFT",
        isEstimate: true,
        version: null,
        grossAgorot: 45_000,
        netPayableAgorot: 45_000,
        pendingEntries: 1,
      });
      // Nothing of the other worker: not their amounts (hourly 10 h = 52,000 / 45,000), not their id.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(other.id);
      expect(serialized).not.toContain("52000");

      // Without a worker profile there is nothing to show.
      await asManager(request(http()).get("/api/v1/payroll-statements/me")).expect(404);
      await asOwner(request(http()).get("/api/v1/payroll-statements/me")).expect(404);
    });
  });

  describe("Owner financial dashboard", () => {
    it("totals, cost by project / site / worker, top earners, overtime spikes, forgotten stamps, emergencies, daily trend and pending exposure; finalized months come from their version", async () => {
      const secondProject = await createProject(prisma, ctx.org.id, "PRJ-SOUTH");
      const second = await createSiteWithGeofence(prisma, ctx.org.id, secondProject.id, 32.1, 34.8, 100);
      const north = { projectId: ctx.project.id, siteId: ctx.site.id, geofenceId: ctx.geofence.id };
      const south = { projectId: secondProject.id, siteId: second.site.id, geofenceId: second.geofence.id };
      const daily = await worker("Daily Dashboard", DAILY);
      const hourly = await worker("Hourly Dashboard", HOURLY);
      const unpaid = await worker("Unpaid Dashboard");

      // September 2026 is UTC+3: 06:00 UTC = 09:00 in Jerusalem.
      await approvedEntry(daily.id, new Date("2026-09-01T06:00:00Z"), 540, { place: north });
      await approvedEntry(daily.id, new Date("2026-09-02T06:00:00Z"), 540, { place: north });
      await approvedEntry(daily.id, new Date("2026-09-03T06:00:00Z"), 720, { place: south }); // 180 min overtime
      await approvedEntry(hourly.id, new Date("2026-09-01T06:00:00Z"), 540, { place: north });
      await approvedEntry(hourly.id, new Date("2026-09-02T06:00:00Z"), 600, { place: south }); // 60 min overtime
      const emergency = await nightTuranEmergency(hourly.id, new Date("2026-09-04T23:00:00Z"), new Date("2026-09-05T00:00:00Z")); // 02:00-03:00 on the 5th
      await approve(emergency.id);
      await approvedEntry(unpaid.id, new Date("2026-09-01T06:00:00Z"), 540, { place: north });
      await pendingEntry(daily.id, new Date("2026-09-04T06:00:00Z"), 540, north);
      const penalty = await prisma.payrollAdjustment.create({
        data: {
          id: uuidv7(),
          organizationId: ctx.org.id,
          workerProfileId: daily.id,
          businessMonth: "2026-09",
          type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY,
          source: PayrollAdjustmentSource.SYSTEM,
          amountAgorot: -1_000,
          createdBy: ctx.manager.user.id,
        },
      });
      await prisma.payrollAdjustment.create({
        data: {
          id: uuidv7(),
          organizationId: ctx.org.id,
          workerProfileId: daily.id,
          businessMonth: "2026-09",
          type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY,
          source: PayrollAdjustmentSource.SYSTEM,
          amountAgorot: -1_000,
          createdBy: ctx.manager.user.id,
        },
      });
      await prisma.payrollAdjustment.create({
        data: {
          id: uuidv7(),
          organizationId: ctx.org.id,
          workerProfileId: daily.id,
          businessMonth: "2026-09",
          type: PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL,
          source: PayrollAdjustmentSource.MANUAL,
          amountAgorot: 1_000,
          reversalOfId: penalty.id,
          reason: "Broken phone",
          createdBy: ctx.owner.user.id,
        },
      });
      await asOwner(request(http()).post("/api/v1/payroll-periods/2026-09/adjustments"))
        .send({ workerProfileId: hourly.id, type: "MANUAL_BONUS", amountAgorot: 2_500, reason: "Night bonus" })
        .expect(201);
      // August, for the comparison.
      await approvedEntry(daily.id, new Date("2026-08-10T06:00:00Z"), 540, { place: north });

      await asManager(request(http()).get("/api/v1/payroll-periods/2026-09/dashboard")).expect(403);
      const live = (await asOwner(request(http()).get("/api/v1/payroll-periods/2026-09/dashboard")).expect(200)).body;

      // daily: 45,000 + 45,000 + (45,000 + 21,000) = 156,000, -2,000 + 1,000 -> 155,000
      // hourly: 45,000 + (45,000 + 7,000) + 11,250 = 108,250, + 2,500 -> 110,750
      expect(live).toMatchObject({
        yearMonth: "2026-09",
        source: "LIVE",
        finalizedVersion: null,
        laborCostAgorot: 264_250,
        netPayableAgorot: 265_750,
        previousMonth: { yearMonth: "2026-08", source: "LIVE", netPayableAgorot: 45_000, laborCostAgorot: 45_000 },
        costByProject: [
          { id: ctx.project.id, name: "Test Project", approvedShifts: 3, laborCostAgorot: 135_000, overtimeAgorot: 0 },
          { id: secondProject.id, name: "Test Project", approvedShifts: 2, laborCostAgorot: 118_000, overtimeAgorot: 28_000 },
          { id: null, name: null, approvedShifts: 1, laborCostAgorot: 11_250, overtimeAgorot: 0 },
        ],
        costBySite: [
          { id: ctx.site.id, name: "Test Site", projectName: "Test Project", laborCostAgorot: 135_000 },
          { id: second.site.id, name: "Test Site", projectName: "Test Project", laborCostAgorot: 118_000 },
          { id: null, name: null, projectName: null, laborCostAgorot: 11_250 },
        ],
        costByWorker: [
          { workerProfileId: daily.id, laborCostAgorot: 156_000, netPayableAgorot: 155_000, overtimeMinutes: 180, approvedShifts: 3 },
          { workerProfileId: hourly.id, laborCostAgorot: 108_250, netPayableAgorot: 110_750, overtimeMinutes: 60, approvedShifts: 3 },
          { workerProfileId: unpaid.id, laborCostAgorot: 0, netPayableAgorot: 0, approvedShifts: 0 },
        ],
        overtime: {
          totalAgorot: 28_000,
          totalMinutes: 240,
          averageDailyMinutes: 60, // 240 overtime minutes over 4 working days
          spikeFactor: 2,
          spikeMinimumMinutes: 60,
          spikes: [
            {
              date: "2026-09-03",
              overtimeMinutes: 180,
              overtimeAgorot: 21_000,
              thresholdMinutes: 120,
              workers: [{ workerProfileId: daily.id, fullLegalName: "Daily Dashboard", overtimeMinutes: 180 }],
            },
          ],
        },
        forgottenStamps: { penalties: 2, penaltiesAgorot: 2_000, reversals: 1, reversalsAgorot: 1_000, netDeductionsAgorot: 1_000 },
        emergencies: { callouts: 1, compensatedMinutes: 135, costAgorot: 11_250 },
        pendingApproval: { entries: 1, exposureAgorot: 45_000, entriesWithoutCompensation: 0 },
        workersWithoutCompensation: [{ workerProfileId: unpaid.id, fullLegalName: "Unpaid Dashboard", entries: 1 }],
      });
      expect(live.topEarners.map((w: { workerProfileId: string }) => w.workerProfileId)).toEqual([daily.id, hourly.id, unpaid.id]);
      expect(live.dailyTrend).toHaveLength(30);
      const day = (date: string) => live.dailyTrend.find((d: { date: string }) => d.date === date);
      expect(day("2026-09-01")).toEqual({ date: "2026-09-01", laborCostAgorot: 90_000, overtimeAgorot: 0, overtimeMinutes: 0, isOvertimeSpike: false });
      expect(day("2026-09-02")).toMatchObject({ laborCostAgorot: 97_000, overtimeMinutes: 60, isOvertimeSpike: false });
      expect(day("2026-09-03")).toMatchObject({ laborCostAgorot: 66_000, overtimeMinutes: 180, isOvertimeSpike: true });
      expect(day("2026-09-05")).toMatchObject({ laborCostAgorot: 11_250, isOvertimeSpike: false });

      // Finalized: the same figures, now from the finalized version -- a live record changing afterwards (here the
      // hourly rate, edited behind the API's back) no longer moves them.
      await calculatePayroll(app, ctx.ownerToken, "2026-09");
      await asOwner(request(http()).post("/api/v1/payroll-periods/2026-09/finalize")).expect(201);
      await prisma.compensationProfile.updateMany({ where: { workerProfileId: hourly.id }, data: { baseHourlyRateAgorot: 9_999 } });
      const finalized = (await asOwner(request(http()).get("/api/v1/payroll-periods/2026-09/dashboard")).expect(200)).body;
      expect(finalized).toMatchObject({ source: "FINALIZED", finalizedVersion: 1, netPayableAgorot: 265_750, laborCostAgorot: 264_250 });
      expect(finalized.costByWorker).toEqual(live.costByWorker);
      expect(finalized.dailyTrend).toEqual(live.dailyTrend);
      expect(finalized.overtime).toEqual(live.overtime);
    });
  });
});
