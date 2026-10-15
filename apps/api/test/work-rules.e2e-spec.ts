import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { CheckInMethod, CorrectionReason, DEFAULT_WORK_RULES, TimeEntryStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { createTestApp, resetDatabase, request, loginAs } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";
import { calculatePayroll } from "./payroll-helpers";

/**
 * Work rules as effective-dated versions (flexible organization model): what
 * used to be constants (9-hour day, two free forgotten stamps, 10.00 penalty,
 * -60 / +15 minutes, the clock-in window) is an organization setting. A change
 * is a NEW version dated after today; every calculation uses the version in
 * force on its own business date; a finalized month and the amounts already
 * recorded never change.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const DAILY_WORKER_PHONE = "+972500010001";
const SECOND_WORKER_PHONE = "+972500010002";
const SITE = { lat: 32.0853, lng: 34.7818 };

/** YYYY-MM-DD, `days` after the business date of `from`. */
function addDays(from: string, days: number): string {
  const [year, month, day] = from.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
const firstOfNextMonth = (date: string) => {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
};

describe("Work rules (flexible organization model)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => app.getHttpServer();

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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => request(http()).post(`/api/v1${path}`).set(auth(token)).send(body);

  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, organizationId, DAILY_WORKER_PHONE, "Eli Worker", { type: "DAILY", dailyRateAgorot: 48_000, overtimeRateAgorot: 6_000 });
    const other = await addWorker(prisma, organizationId, SECOND_WORKER_PHONE, "Rami Worker", { type: "HOURLY", hourlyRateAgorot: 6_000, overtimeRateAgorot: 9_000 });
    const project = await createProject(prisma, organizationId);
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE.lat, SITE.lng, 100);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, new Date(Date.now() - 3_600_000), new Date(Date.now() + 8 * 3_600_000));
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shift.id, other.workerProfile.id, manager.user.id);
    const today = toBusinessDate(new Date());
    return {
      organizationId,
      owner,
      manager,
      worker,
      other,
      shift,
      site,
      today,
      tomorrow: addDays(today, 1),
      tokens: {
        owner: (await loginAs(app, OWNER_PHONE)).accessToken,
        manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
        worker: (await loginAs(app, DAILY_WORKER_PHONE)).accessToken,
      },
    };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** A worked day waiting for approval, on a business date of the test's choosing (inserted directly). */
  async function waitingEntry(ctx: Ctx, workerProfileId: string, businessDate: string, minutes: number) {
    const clockInAt = new Date(`${businessDate}T05:00:00.000Z`);
    return prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.organizationId,
        workerProfileId,
        shiftId: ctx.shift.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        businessDate,
        clockInAt,
        clockOutAt: new Date(clockInAt.getTime() + minutes * 60_000),
        rawDurationMinutes: minutes,
        checkInMethod: CheckInMethod.GEOFENCED,
      },
    });
  }

  const newRules = (ctx: Ctx, effectiveFrom: string, rules: Record<string, number>, reason = "Agreed with the employees") =>
    post(ctx.tokens.owner, "/organizations/me/work-rules", { effectiveFrom, reason, ...rules });

  it("starts with the default rules and no stored version; a member who may not see money gets no penalty key; only the right members change rules", async () => {
    const ctx = await setup();
    const view = await get(ctx.tokens.owner, "/organizations/me/work-rules").expect(200);
    expect(view.body).toMatchObject({ canEdit: true, canSeeMoney: true, current: DEFAULT_WORK_RULES, defaults: DEFAULT_WORK_RULES, today: ctx.today });
    expect(view.body.versions).toHaveLength(1);
    expect(view.body.versions[0]).toMatchObject({ id: "baseline", version: 0, effectiveFrom: "2000-01-01", rules: DEFAULT_WORK_RULES });
    expect(await prisma.workRuleVersion.count()).toBe(0);

    const managerView = await get(ctx.tokens.manager, "/organizations/me/work-rules").expect(200);
    expect(managerView.body).toMatchObject({ canEdit: false, canSeeMoney: false });
    expect(JSON.stringify(managerView.body)).not.toMatch(/penalty/i);
    expect(managerView.body.current).toMatchObject({ standardDayMinutes: 540, emergencyMinutesBefore: 60 });
    await get(ctx.tokens.worker, "/organizations/me/work-rules").expect(403);
    await newRules(ctx, ctx.tomorrow, { standardDayMinutes: 480, overtimeThresholdMinutes: 480 }).set(auth(ctx.tokens.manager)).expect(403);
    await newRules(ctx, ctx.tomorrow, { standardDayMinutes: 480, overtimeThresholdMinutes: 480 }).set(auth(ctx.tokens.worker)).expect(403);
  });

  it("a new version needs a date after today, valid values, a reason and a real change; the history keeps every version and is audited old -> new", async () => {
    const ctx = await setup();
    const rules = { standardDayMinutes: 480, overtimeThresholdMinutes: 480 };
    // The date: after today only.
    for (const effectiveFrom of [ctx.today, addDays(ctx.today, -3)]) {
      expect((await newRules(ctx, effectiveFrom, rules).expect(400)).body.code).toBe("WORK_RULES_EFFECTIVE_DATE_PAST");
    }
    await newRules(ctx, "2026-02-30", rules).expect(400);
    await newRules(ctx, "tomorrow", rules).expect(400);
    // The values: in range, integers, and the overtime threshold never below the standard day.
    await newRules(ctx, ctx.tomorrow, { standardDayMinutes: 30 }).expect(400);
    await newRules(ctx, ctx.tomorrow, { freeForgottenStampsPerMonth: 1.5 }).expect(400);
    const invalid = await newRules(ctx, ctx.tomorrow, { standardDayMinutes: 600 }).expect(400);
    expect(invalid.body).toMatchObject({ code: "WORK_RULES_INVALID", details: { problems: [{ field: "overtimeThresholdMinutes", kind: "THRESHOLD_BELOW_STANDARD_DAY" }] } });
    // A reason, something to change, and a change that is one.
    await post(ctx.tokens.owner, "/organizations/me/work-rules", { effectiveFrom: ctx.tomorrow, standardDayMinutes: 480, overtimeThresholdMinutes: 480 }).expect(400);
    await newRules(ctx, ctx.tomorrow, {}).expect(400);
    await newRules(ctx, ctx.tomorrow, { standardDayMinutes: 540 }).expect(400);
    expect(await prisma.workRuleVersion.count()).toBe(0);

    const created = await newRules(ctx, addDays(ctx.today, 10), { ...rules, freeForgottenStampsPerMonth: 3 }, "Eight-hour day").expect(201);
    expect(created.body.current).toMatchObject(DEFAULT_WORK_RULES); // not in force yet
    expect(created.body.versions.map((version: { version: number; effectiveFrom: string; reason: string | null }) => [version.version, version.effectiveFrom, version.reason])).toEqual([
      [1, "2000-01-01", "القيم الأصلية"],
      [2, addDays(ctx.today, 10), "Eight-hour day"],
    ]);
    expect(created.body.versions[1].rules).toEqual({ ...DEFAULT_WORK_RULES, standardDayMinutes: 480, overtimeThresholdMinutes: 480, freeForgottenStampsPerMonth: 3 });
    // Another change, dated before the first one: it starts from the rules in force on ITS date.
    const earlier = await newRules(ctx, addDays(ctx.today, 5), { emergencyMinutesBefore: 30 }, "Shorter lead").expect(201);
    expect(earlier.body.versions.map((version: { version: number }) => version.version)).toEqual([1, 3, 2]);
    expect(earlier.body.versions[1].rules).toEqual({ ...DEFAULT_WORK_RULES, emergencyMinutesBefore: 30 });

    const audit = await prisma.auditLog.findMany({ where: { action: "WORK_RULE_CHANGED" }, orderBy: { sequenceNumber: "asc" } });
    expect(audit.map((row) => [row.field, row.oldValue, row.newValue, row.reason])).toEqual([
      ["workRules.standardDayMinutes", "540", "480", "Eight-hour day"],
      ["workRules.overtimeThresholdMinutes", "540", "480", "Eight-hour day"],
      ["workRules.freeForgottenStampsPerMonth", "2", "3", "Eight-hour day"],
      ["workRules.emergencyMinutesBefore", "60", "30", "Shorter lead"],
    ]);

    // Versions are never edited or deleted: not through the application, not even directly in the database.
    const stored = await prisma.workRuleVersion.findFirstOrThrow({ where: { version: 2 } });
    await expect(prisma.workRuleVersion.update({ where: { id: stored.id }, data: { standardDayMinutes: 500 } })).rejects.toThrow(/never changed or deleted/);
    await expect(prisma.workRuleVersion.delete({ where: { id: stored.id } })).rejects.toThrow(/never changed or deleted/);
    expect((await prisma.workRuleVersion.findUniqueOrThrow({ where: { id: stored.id } })).standardDayMinutes).toBe(480);
  });

  it("only a member who may see money changes the penalty; the impact of a change lists the open months and the finalized ones that stay as they are", async () => {
    const ctx = await setup();
    const manager = await post(ctx.tokens.owner, "/roles", { name: "Rules admin", permissions: ["VIEW_ORG_SETTINGS", "MANAGE_ORG_SETTINGS", "VIEW_ATTENDANCE"] }).expect(201);
    await post(ctx.tokens.owner, "/memberships", { phoneNumber: "+972500020005", fullLegalName: "Rules Admin", roleId: manager.body.id }).expect(201);
    const adminToken = (await loginAs(app, "+972500020005")).accessToken;
    await newRules(ctx, ctx.tomorrow, { forgottenStampPenaltyAgorot: 5_000 }).set(auth(adminToken)).expect(403);
    await newRules(ctx, ctx.tomorrow, { standardDayMinutes: 500, overtimeThresholdMinutes: 500 }).set(auth(adminToken)).expect(201);
    expect(JSON.stringify((await get(adminToken, "/organizations/me/work-rules").expect(200)).body)).not.toMatch(/penalty/i);
    await newRules(ctx, addDays(ctx.today, 2), { forgottenStampPenaltyAgorot: 5_000 }).expect(201);

    // Impact: this month is open before anyone calculates it; a calculated-and-finalized month is listed as unchanged.
    const impact = await get(ctx.tokens.owner, `/organizations/me/work-rules/impact?effectiveFrom=${ctx.tomorrow}`).expect(200);
    expect(impact.body).toMatchObject({ effectiveFrom: ctx.tomorrow, finalizedMonths: [] });
    expect(impact.body.openMonths).toContainEqual({ yearMonth: ctx.today.slice(0, 7), status: "NOT_CALCULATED", version: null });
    const entry = await waitingEntry(ctx, ctx.worker.workerProfile.id, ctx.today, 540);
    await post(ctx.tokens.manager, `/time-entries/${entry.id}/approve`).expect(201);
    await calculatePayroll(app, ctx.tokens.owner, ctx.today.slice(0, 7));
    expect((await get(ctx.tokens.owner, `/organizations/me/work-rules/impact?effectiveFrom=${ctx.tomorrow}`).expect(200)).body.openMonths).toContainEqual({
      yearMonth: ctx.today.slice(0, 7),
      status: "REVIEW",
      version: 1,
    });
    await post(ctx.tokens.owner, `/payroll-periods/${ctx.today.slice(0, 7)}/finalize`).expect(201);
    const after = (await get(ctx.tokens.owner, `/organizations/me/work-rules/impact?effectiveFrom=${ctx.tomorrow}`).expect(200)).body;
    expect(after.finalizedMonths).toEqual([{ yearMonth: ctx.today.slice(0, 7), version: 1 }]);
    expect(after.openMonths.map((month: { yearMonth: string }) => month.yearMonth)).not.toContain(ctx.today.slice(0, 7));
    // Default date: tomorrow.
    expect((await get(ctx.tokens.owner, "/organizations/me/work-rules/impact").expect(200)).body.effectiveFrom).toBe(ctx.tomorrow);
    await get(ctx.tokens.owner, "/organizations/me/work-rules/impact?effectiveFrom=nope").expect(400);
  });

  it("standard day 540 -> 480 effective next month: this month still uses 540, next month 480, and a finalized month never changes", async () => {
    const ctx = await setup();
    const thisMonth = ctx.today.slice(0, 7);
    const nextMonthFirst = firstOfNextMonth(ctx.today);
    const nextMonth = nextMonthFirst.slice(0, 7);

    // Nine hours worked on the 10th of this month and of next month, and an hourly worker's nine hours next month too.
    const now = await waitingEntry(ctx, ctx.worker.workerProfile.id, `${thisMonth}-10`, 540);
    const later = await waitingEntry(ctx, ctx.worker.workerProfile.id, `${nextMonth}-10`, 540);
    const hourlyLater = await waitingEntry(ctx, ctx.other.workerProfile.id, `${nextMonth}-11`, 540);

    await newRules(ctx, nextMonthFirst, { standardDayMinutes: 480, overtimeThresholdMinutes: 480 }, "From next month: an eight-hour day").expect(201);

    // Approval splits with the rules of each entry's own business date.
    for (const entry of [now, later, hourlyLater]) await post(ctx.tokens.manager, `/time-entries/${entry.id}/approve`).expect(201);
    const split = async (id: string) => {
      const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
      return [row.approvedRegularMinutes, row.approvedOvertimeMinutes];
    };
    expect(await split(now.id)).toEqual([540, 0]);
    expect(await split(later.id)).toEqual([480, 60]);
    expect(await split(hourlyLater.id)).toEqual([480, 60]);

    // The payroll prices them the same way: a plain day this month, a day plus an hour of overtime next month.
    await calculatePayroll(app, ctx.tokens.owner, thisMonth);
    await calculatePayroll(app, ctx.tokens.owner, nextMonth);
    const thisPayroll = (await get(ctx.tokens.owner, `/payroll-periods/${thisMonth}`).expect(200)).body;
    const nextPayroll = (await get(ctx.tokens.owner, `/payroll-periods/${nextMonth}`).expect(200)).body;
    const line = (payroll: { workers: { fullLegalName: string }[] }, name: string) => payroll.workers.find((worker) => worker.fullLegalName === name) as unknown as Record<string, number>;
    expect(line(thisPayroll, "Eli Worker")).toMatchObject({ regularMinutes: 540, overtimeMinutes: 0, grossBaseAgorot: 48_000, overtimeAgorot: 0, netPayableAgorot: 48_000 });
    expect(line(nextPayroll, "Eli Worker")).toMatchObject({ regularMinutes: 480, overtimeMinutes: 60, grossBaseAgorot: 48_000, overtimeAgorot: 6_000, netPayableAgorot: 54_000 });
    // 8 h at 60.00 + 1 h at 90.00.
    expect(line(nextPayroll, "Rami Worker")).toMatchObject({ regularMinutes: 480, overtimeMinutes: 60, grossBaseAgorot: 48_000, overtimeAgorot: 9_000, netPayableAgorot: 57_000 });
    // The calculation stored the versions it priced with.
    const snapshot = await prisma.payrollCalculationSnapshot.findFirstOrThrow({ where: { payrollPeriod: { yearMonth: nextMonth } } });
    expect((snapshot.inputsJson as { workRules?: { version: number }[] }).workRules?.map((version) => version.version)).toEqual([1, 2]);

    // Finalize this month; then add more rules (a penalty, a still shorter day): the finalized version is exactly as it was.
    await post(ctx.tokens.owner, `/payroll-periods/${thisMonth}/finalize`).expect(201);
    const finalizedBefore = (await get(ctx.tokens.owner, `/payroll-periods/${thisMonth}/versions/1`).expect(200)).body;
    const snapshotBefore = await prisma.payrollCalculationSnapshot.findFirstOrThrow({ where: { payrollPeriod: { yearMonth: thisMonth } } });
    await newRules(ctx, addDays(nextMonthFirst, 40), { standardDayMinutes: 420, overtimeThresholdMinutes: 420, forgottenStampPenaltyAgorot: 3_000 }, "Later still").expect(201);
    expect((await get(ctx.tokens.owner, `/payroll-periods/${thisMonth}/versions/1`).expect(200)).body).toEqual(finalizedBefore);
    expect((await get(ctx.tokens.owner, `/payroll-periods/${thisMonth}`).expect(200)).body.changedSinceCalculation).toBe(false);
    const snapshotAfter = await prisma.payrollCalculationSnapshot.findFirstOrThrow({ where: { payrollPeriod: { yearMonth: thisMonth } } });
    expect({ inputs: snapshotAfter.inputsJson, result: snapshotAfter.resultJson, totals: snapshotAfter.totalsJson, hash: snapshotAfter.inputsHash }).toEqual({
      inputs: snapshotBefore.inputsJson,
      result: snapshotBefore.resultJson,
      totals: snapshotBefore.totalsJson,
      hash: snapshotBefore.inputsHash,
    });
    // The still-open next month is told it changed (a new rule version exists since its calculation); recalculating prices with all versions.
    expect((await get(ctx.tokens.owner, `/payroll-periods/${nextMonth}`).expect(200)).body.changedSinceCalculation).toBe(true);
    await calculatePayroll(app, ctx.tokens.owner, nextMonth);
    expect((await get(ctx.tokens.owner, `/payroll-periods/${nextMonth}`).expect(200)).body.changedSinceCalculation).toBe(false);
    expect(line((await get(ctx.tokens.owner, `/payroll-periods/${nextMonth}`).expect(200)).body, "Eli Worker")).toMatchObject({ netPayableAgorot: 54_000 });
  });

  it("a penalty change never touches the adjustments already recorded, and applies to infractions from its date on", async () => {
    const ctx = await setup();
    const thisMonth = ctx.today.slice(0, 7);
    const entry = await waitingEntry(ctx, ctx.worker.workerProfile.id, ctx.today, 540);
    const earlier = new Date(Date.now() - 12 * 3_600_000).toISOString();
    // Three forgotten stamps this month: the third one deducts 10.00.
    for (let i = 0; i < 3; i++) {
      await post(ctx.tokens.manager, "/manual-corrections", { timeEntryId: entry.id, field: "CLOCK_IN", newValue: earlier, reason: CorrectionReason.FORGOTTEN_CLOCK_IN }).expect(201);
    }
    const adjustments = () => prisma.payrollAdjustment.findMany({ where: { workerProfileId: ctx.worker.workerProfile.id }, orderBy: { createdAt: "asc" } });
    expect((await adjustments()).map((adjustment) => adjustment.amountAgorot)).toEqual([-1_000]);

    // From tomorrow: no free stamps, and 25.00 for each.
    await newRules(ctx, ctx.tomorrow, { freeForgottenStampsPerMonth: 0, forgottenStampPenaltyAgorot: 2_500 }, "Stricter").expect(201);
    expect((await adjustments()).map((adjustment) => adjustment.amountAgorot)).toEqual([-1_000]);
    // A correction today is still counted by today's rules: the fourth, 10.00.
    await post(ctx.tokens.manager, "/manual-corrections", { timeEntryId: entry.id, field: "CLOCK_IN", newValue: earlier, reason: CorrectionReason.FORGOTTEN_CLOCK_IN }).expect(201);
    expect((await adjustments()).map((adjustment) => adjustment.amountAgorot)).toEqual([-1_000, -1_000]);
    // A missing clock-in added for tomorrow is an infraction of tomorrow: the new rules (no free stamps, 25.00).
    const infraction = await post(ctx.tokens.manager, "/manual-corrections", {
      shiftId: ctx.shift.id,
      workerProfileId: ctx.other.workerProfile.id,
      field: "CLOCK_IN",
      newValue: `${ctx.tomorrow}T06:00:00.000Z`,
      reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
    }).expect(201);
    expect(infraction.body.timeEntry.businessDate).toBe(ctx.tomorrow);
    const penalty = await prisma.payrollAdjustment.findFirstOrThrow({ where: { workerProfileId: ctx.other.workerProfile.id } });
    expect(penalty.amountAgorot).toBe(-2_500);

    // The payroll of this month keeps the amounts as recorded.
    await post(ctx.tokens.manager, `/time-entries/${entry.id}/approve`).expect(201);
    await calculatePayroll(app, ctx.tokens.owner, thisMonth);
    const payroll = (await get(ctx.tokens.owner, `/payroll-periods/${thisMonth}`).expect(200)).body as { workers: { fullLegalName: string; forgottenStampPenaltiesAgorot: number }[] };
    expect(payroll.workers.find((worker) => worker.fullLegalName === "Eli Worker")?.forgottenStampPenaltiesAgorot).toBe(2_000);
  });

  it("clock-in opens the configured number of minutes before the shift starts and not earlier; the early attempt is kept as evidence", async () => {
    const ctx = await setup();
    const future = await createStandardShift(
      prisma,
      ctx.organizationId,
      ctx.shift.projectId!,
      ctx.site.id,
      ctx.shift.geofenceId!,
      ctx.manager.user.id,
      new Date(Date.now() + 3 * 3_600_000),
      new Date(Date.now() + 11 * 3_600_000),
    );
    await assignWorkerToShift(prisma, future.id, ctx.worker.workerProfile.id, ctx.manager.user.id);
    // The worker's open shift ended up closed so only the future one is clockable.
    await post(ctx.tokens.owner, `/shifts/${ctx.shift.id}/close`).expect(201);
    const clockIn = () =>
      post(ctx.tokens.worker, "/clock-events/clock-in", { shiftId: future.id, deviceId: "d1", clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), latitude: SITE.lat, longitude: SITE.lng, accuracyMeters: 10 }).set("Idempotency-Key", uuidv7());

    // Three hours before the start: refused with the time it opens (the default window is an hour).
    const refused = await clockIn().expect(409);
    expect(refused.body).toMatchObject({ code: "CLOCK_IN_TOO_EARLY", details: { windowMinutes: 60 } });
    expect(new Date(refused.body.details.opensAt).getTime()).toBe(future.scheduledStart.getTime() - 60 * 60_000);
    expect(await prisma.rejectedClockAttempt.count({ where: { code: "CLOCK_IN_TOO_EARLY", shiftId: future.id } })).toBe(1);

    // A window of four hours (a version in force today) lets the same clock-in through.
    await prisma.workRuleVersion.create({
      data: { id: uuidv7(), organizationId: ctx.organizationId, version: 1, effectiveFrom: ctx.today, reason: "Test", createdBy: null, ...DEFAULT_WORK_RULES, clockInEarlyWindowMinutes: 240 },
    });
    await clockIn().expect(201);
  });

  it("an emergency call-out is paid from the minutes before and after the rules in force say", async () => {
    const ctx = await setup();
    await prisma.workRuleVersion.create({
      data: { id: uuidv7(), organizationId: ctx.organizationId, version: 1, effectiveFrom: ctx.today, reason: "Test", createdBy: null, ...DEFAULT_WORK_RULES, emergencyMinutesBefore: 30, emergencyMinutesAfter: 5 },
    });
    const callout = { deviceId: "d1", clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), latitude: SITE.lat, longitude: SITE.lng, accuracyMeters: 10 };
    const started = await post(ctx.tokens.manager, "/emergency-callouts/start", { ...callout, workerProfileId: ctx.worker.workerProfile.id }).set("Idempotency-Key", uuidv7()).expect(201);
    expect(started.body.retroactiveMinutes).toBe(30);
    expect(new Date(started.body.actualStartClick).getTime() - new Date(started.body.compensatedStart).getTime()).toBe(30 * 60_000);
    const ended = await post(ctx.tokens.worker, "/emergency-callouts/end", { ...callout, clientEventId: uuidv7(), summaryText: "Fixed it.", taskCategory: "EMERGENCY_REPAIR" }).set("Idempotency-Key", uuidv7()).expect(201);
    expect(ended.body).toMatchObject({ retroactiveMinutes: 30, returnBufferMinutes: 5 });
    expect(new Date(ended.body.compensatedEnd).getTime() - new Date(ended.body.actualEndClick).getTime()).toBe(5 * 60_000);
    const stored = await prisma.emergencyCallout.findFirstOrThrow({ where: { workerProfileId: ctx.worker.workerProfile.id } });
    expect(stored).toMatchObject({ retroactiveMinutes: 30, returnBufferMinutes: 5 });
  });
});
