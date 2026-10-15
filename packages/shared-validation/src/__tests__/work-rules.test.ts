import { CompensationType, DEFAULT_WORK_RULES, pickWorkRules, checkWorkRules, type WorkRules, type WorkRuleVersion } from "@fieldmaster/shared-types";
import { splitWorkedMinutes } from "../attendance";
import { computeEmergencyCompensation } from "../emergency";
import { evaluateForgottenStampInfraction } from "../forgotten-stamp";
import { calculateDailyCompensation, calculateHourlyCompensation, calculateShiftCompensation } from "../payroll";
import { calculatePayrollMonth, computeEntryCompensation, type PayrollCompensationProfile, type PayrollMonthEntry } from "../payroll-month";

/** Work rules (flexible organization model): every calculation takes the rules in force as a required argument -- there is no default. */

const EIGHT_HOUR_DAY: Pick<WorkRules, "standardDayMinutes" | "overtimeThresholdMinutes"> = { standardDayMinutes: 480, overtimeThresholdMinutes: 480 };

describe("with the first version's rules (what every organization starts with) the calculations are exactly what they were", () => {
  it("splits, prices, penalizes and compensates with a 9-hour day, 2 free stamps, 1000 agorot, -60 / +15", () => {
    const first: WorkRules = { ...DEFAULT_WORK_RULES };
    expect(splitWorkedMinutes({ rawDurationMinutes: 600, unpaidBreakMinutes: 30, fullDayCredit: false }, first)).toEqual({
      workedMinutes: 570,
      regularMinutes: 540,
      overtimeMinutes: 30,
      fullDayCreditApplied: false,
    });
    expect(calculateDailyCompensation({ dailyBaseRateAgorot: 45_000, overtimeHourlyRateAgorot: 7_000, approvedMinutes: 360, fullDayCredit: false }, first).totalCompensationAgorot).toBe(30_000);
    expect(evaluateForgottenStampInfraction(2, first).deductionAgorot).toBe(0);
    expect(evaluateForgottenStampInfraction(3, first).deductionAgorot).toBe(1_000);
    const callout = computeEmergencyCompensation(new Date("2026-10-14T00:00:00Z"), new Date("2026-10-14T03:00:00Z"), first);
    expect(callout).toMatchObject({ retroactiveMinutes: 60, returnBufferMinutes: 15, compensatedDurationMinutes: 255 });
    expect(DEFAULT_WORK_RULES).toMatchObject({ standardDayMinutes: 540, overtimeThresholdMinutes: 540, freeForgottenStampsPerMonth: 2, forgottenStampPenaltyAgorot: 1_000 });
  });
});

describe("with rules", () => {
  it("a shorter standard day (480): the split, a daily worker's proration and base day, an hourly worker's regular minutes and a full-day credit all follow it", () => {
    expect(splitWorkedMinutes({ rawDurationMinutes: 540, unpaidBreakMinutes: 0, fullDayCredit: false }, EIGHT_HOUR_DAY)).toMatchObject({ regularMinutes: 480, overtimeMinutes: 60 });
    expect(splitWorkedMinutes({ rawDurationMinutes: 300, unpaidBreakMinutes: 0, fullDayCredit: true }, EIGHT_HOUR_DAY)).toMatchObject({ regularMinutes: 480, overtimeMinutes: 0, fullDayCreditApplied: true });

    const daily = { dailyBaseRateAgorot: 48_000, overtimeHourlyRateAgorot: 6_000, fullDayCredit: false };
    // 8 h is now a full day with no overtime (it was 480/540 of a day).
    expect(calculateDailyCompensation({ ...daily, approvedMinutes: 480 }, EIGHT_HOUR_DAY)).toMatchObject({ standardDaysCredited: 1, baseCompensationAgorot: 48_000, overtimeMinutes: 0 });
    // 9 h: the base day plus an hour of overtime at 60.00.
    expect(calculateDailyCompensation({ ...daily, approvedMinutes: 540 }, EIGHT_HOUR_DAY)).toMatchObject({ overtimeMinutes: 60, overtimeCompensationAgorot: 6_000, totalCompensationAgorot: 54_000 });
    // 4 h of an 8 h day is half the day (it was 4/9).
    expect(calculateDailyCompensation({ ...daily, approvedMinutes: 240 }, EIGHT_HOUR_DAY).totalCompensationAgorot).toBe(24_000);

    const hourly = { baseHourlyRateAgorot: 6_000, overtimeHourlyRateAgorot: 9_000, fullDayCredit: false };
    expect(calculateHourlyCompensation({ ...hourly, approvedMinutes: 540 }, EIGHT_HOUR_DAY)).toMatchObject({ regularMinutes: 480, overtimeMinutes: 60, totalCompensationAgorot: 48_000 + 9_000 });
    expect(calculateHourlyCompensation({ ...hourly, approvedMinutes: 300, fullDayCredit: true }, EIGHT_HOUR_DAY)).toMatchObject({ regularMinutes: 480, totalCompensationAgorot: 48_000 });
    expect(calculateShiftCompensation({ compensationType: CompensationType.HOURLY, approvedMinutes: 540, fullDayCredit: false, baseHourlyRateAgorot: 6_000, overtimeHourlyRateAgorot: 9_000 }, EIGHT_HOUR_DAY)).toMatchObject({ regularMinutes: 480, overtimeMinutes: 60 });
  });

  it("an overtime threshold above the standard day: the base day is earned at the standard day, overtime starts only at the threshold", () => {
    const rules = { standardDayMinutes: 480, overtimeThresholdMinutes: 540 };
    expect(splitWorkedMinutes({ rawDurationMinutes: 520, unpaidBreakMinutes: 0, fullDayCredit: false }, rules)).toMatchObject({ regularMinutes: 520, overtimeMinutes: 0 });
    expect(calculateDailyCompensation({ dailyBaseRateAgorot: 48_000, overtimeHourlyRateAgorot: 6_000, approvedMinutes: 520, fullDayCredit: false }, rules)).toMatchObject({
      standardDaysCredited: 1,
      overtimeMinutes: 0,
      totalCompensationAgorot: 48_000,
    });
    expect(calculateDailyCompensation({ dailyBaseRateAgorot: 48_000, overtimeHourlyRateAgorot: 6_000, approvedMinutes: 600, fullDayCredit: false }, rules).overtimeMinutes).toBe(60);
  });

  it("the forgotten-stamp rule: free stamps and the penalty come from the rules", () => {
    const rules = { freeForgottenStampsPerMonth: 0, forgottenStampPenaltyAgorot: 2_500 };
    expect(evaluateForgottenStampInfraction(1, rules).deductionAgorot).toBe(2_500);
    expect(evaluateForgottenStampInfraction(5, { freeForgottenStampsPerMonth: 5, forgottenStampPenaltyAgorot: 2_500 }).deductionAgorot).toBe(0);
    expect(evaluateForgottenStampInfraction(6, { freeForgottenStampsPerMonth: 5, forgottenStampPenaltyAgorot: 2_500 }).deductionAgorot).toBe(2_500);
  });

  it("an emergency call-out is paid from the minutes before and after the rules say", () => {
    const callout = computeEmergencyCompensation(new Date("2026-10-14T00:00:00Z"), new Date("2026-10-14T03:00:00Z"), { emergencyMinutesBefore: 30, emergencyMinutesAfter: 45 });
    expect(callout).toMatchObject({ retroactiveMinutes: 30, returnBufferMinutes: 45, compensatedDurationMinutes: 30 + 180 + 45 });
    expect(callout.compensatedStart.toISOString()).toBe("2026-10-13T23:30:00.000Z");
    expect(callout.compensatedEnd.toISOString()).toBe("2026-10-14T03:45:00.000Z");
  });
});

describe("a month is priced entry by entry with the rules of each entry's own business date", () => {
  const profile: PayrollCompensationProfile = {
    id: "p1",
    workerProfileId: "w1",
    compensationType: CompensationType.DAILY,
    dailyBaseRateAgorot: 48_000,
    baseHourlyRateAgorot: null,
    overtimeHourlyRateAgorot: 6_000,
    effectiveStartDate: "2020-01-01",
    effectiveEndDate: null,
  };
  const entry = (timeEntryId: string, businessDate: string): PayrollMonthEntry => ({
    timeEntryId,
    workerProfileId: "w1",
    businessDate,
    approvedRegularMinutes: 540,
    approvedOvertimeMinutes: 0,
    fullDayCredit: false,
    isEmergency: false,
    emergencyRetroactiveMinutes: 0,
    emergencyReturnMinutes: 0,
    projectId: null,
    siteId: null,
  });
  /** 540 -> 480 from the 16th. */
  const versions: (WorkRuleVersion & { rules: WorkRules })[] = [
    { id: "a", version: 1, effectiveFrom: "2000-01-01", rules: { ...DEFAULT_WORK_RULES }, reason: null, createdByUserId: null, createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", version: 2, effectiveFrom: "2026-10-16", rules: { ...DEFAULT_WORK_RULES, standardDayMinutes: 480, overtimeThresholdMinutes: 480 }, reason: "x", createdByUserId: null, createdAt: "2026-10-01T00:00:00Z" },
  ];

  it("a 9-hour entry before the change is a plain day; the same entry after it carries an hour of overtime", () => {
    const month = calculatePayrollMonth({
      entries: [entry("early", "2026-10-15"), entry("late", "2026-10-16")],
      profiles: [profile],
      adjustments: [],
      rulesFor: (date) => pickWorkRules(versions, date),
    });
    const byId = new Map(month.entries.map((line) => [line.timeEntryId, line]));
    expect(byId.get("early")).toMatchObject({ overtimeMinutes: 0, overtimeAgorot: 0, totalAgorot: 48_000 });
    expect(byId.get("late")).toMatchObject({ overtimeMinutes: 60, overtimeAgorot: 6_000, totalAgorot: 54_000 });
    expect(month.workers[0]).toMatchObject({ overtimeMinutes: 60, netPayableAgorot: 48_000 + 54_000 });
  });

  it("with only the first version every entry is priced as before (nothing changes for an organization that never changed a rule)", () => {
    const month = calculatePayrollMonth({ entries: [entry("a", "2026-10-16")], profiles: [profile], adjustments: [], rulesFor: (date) => pickWorkRules(versions.slice(0, 1), date) });
    expect(month.entries[0]).toMatchObject({ overtimeMinutes: 0, totalAgorot: 48_000 });
    expect(computeEntryCompensation(entry("a", "2026-10-16"), profile, pickWorkRules(versions.slice(0, 1), "2026-10-16"))).toMatchObject({ overtimeMinutes: 0 });
  });
});

describe("pickWorkRules and checkWorkRules", () => {
  const version = (id: string, effectiveFrom: string, versionNumber: number, standardDayMinutes: number): WorkRuleVersion => ({
    id,
    version: versionNumber,
    effectiveFrom,
    rules: { ...DEFAULT_WORK_RULES, standardDayMinutes, overtimeThresholdMinutes: Math.max(standardDayMinutes, DEFAULT_WORK_RULES.overtimeThresholdMinutes) },
    reason: null,
    createdByUserId: null,
    createdAt: "2026-01-01T00:00:00Z",
  });

  it("picks the latest version starting on or before the date, the later created one when two share a date, in any input order", () => {
    const versions = [version("c", "2026-12-01", 3, 420), version("a", "2000-01-01", 1, 540), version("b", "2026-11-01", 2, 480), version("b2", "2026-11-01", 4, 450)];
    expect(pickWorkRules(versions, "2026-10-31").standardDayMinutes).toBe(540);
    expect(pickWorkRules(versions, "2026-11-01").standardDayMinutes).toBe(450);
    expect(pickWorkRules(versions, "2026-11-30").standardDayMinutes).toBe(450);
    expect(pickWorkRules(versions, "2027-01-01").standardDayMinutes).toBe(420);
    // No fallback to default values: an organization always has its first version; none at all is an error,
    // and a date before every version gets the first one.
    expect(() => pickWorkRules([], "2026-11-01")).toThrow();
    expect(pickWorkRules([version("late", "2030-01-01", 1, 400)], "2026-11-01").standardDayMinutes).toBe(400);
  });

  it("refuses values out of range, fractions, and an overtime threshold below the standard day", () => {
    expect(checkWorkRules({ ...DEFAULT_WORK_RULES })).toEqual([]);
    expect(checkWorkRules({ ...DEFAULT_WORK_RULES, standardDayMinutes: 30 })).toEqual([{ field: "standardDayMinutes", kind: "OUT_OF_RANGE" }]);
    expect(checkWorkRules({ ...DEFAULT_WORK_RULES, freeForgottenStampsPerMonth: 1.5 })).toEqual([{ field: "freeForgottenStampsPerMonth", kind: "NOT_AN_INTEGER" }]);
    expect(checkWorkRules({ ...DEFAULT_WORK_RULES, standardDayMinutes: 600, overtimeThresholdMinutes: 540 })).toEqual([{ field: "overtimeThresholdMinutes", kind: "THRESHOLD_BELOW_STANDARD_DAY" }]);
  });
});
