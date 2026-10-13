import { CompensationType, PayrollAdjustmentType } from "@fieldmaster/shared-types";
import {
  calculatePayrollMonth,
  calculateWorkerPayroll,
  computeEntryCompensation,
  findOvertimeSpikes,
  groupPayrollEntryCosts,
  pickEffectiveCompensationProfile,
  summarizeAdjustments,
  sumPayrollWorkers,
  type PayrollCompensationProfile,
  type PayrollMonthEntry,
} from "../payroll-month";

// The Step 7 fixtures: daily 45,000 agorot, hourly 5,000, overtime 7,000.
const DAILY: PayrollCompensationProfile = {
  id: "p-daily",
  workerProfileId: "w-daily",
  compensationType: CompensationType.DAILY,
  dailyBaseRateAgorot: 45_000,
  baseHourlyRateAgorot: null,
  overtimeHourlyRateAgorot: 7_000,
  effectiveStartDate: "2020-01-01",
  effectiveEndDate: null,
};
const HOURLY: PayrollCompensationProfile = {
  id: "p-hourly",
  workerProfileId: "w-hourly",
  compensationType: CompensationType.HOURLY,
  dailyBaseRateAgorot: null,
  baseHourlyRateAgorot: 5_000,
  overtimeHourlyRateAgorot: 7_000,
  effectiveStartDate: "2020-01-01",
  effectiveEndDate: null,
};

let nextId = 0;
function entry(workerProfileId: string, businessDate: string, regular: number, overtime = 0, extra: Partial<PayrollMonthEntry> = {}): PayrollMonthEntry {
  nextId += 1;
  return {
    timeEntryId: `e-${nextId}`,
    workerProfileId,
    businessDate,
    approvedRegularMinutes: regular,
    approvedOvertimeMinutes: overtime,
    fullDayCredit: false,
    isEmergency: false,
    emergencyRetroactiveMinutes: 0,
    emergencyReturnMinutes: 0,
    projectId: "project-1",
    siteId: "site-1",
    ...extra,
  };
}

describe("pickEffectiveCompensationProfile", () => {
  const before: PayrollCompensationProfile = { ...DAILY, id: "before", effectiveStartDate: "2026-01-01", effectiveEndDate: "2026-08-14" };
  const after: PayrollCompensationProfile = { ...DAILY, id: "after", dailyBaseRateAgorot: 50_000, effectiveStartDate: "2026-08-15", effectiveEndDate: null };

  it("uses the profile in effect on each business date, both ends inclusive", () => {
    expect(pickEffectiveCompensationProfile([before, after], "w-daily", "2026-08-14")?.id).toBe("before");
    expect(pickEffectiveCompensationProfile([before, after], "w-daily", "2026-08-15")?.id).toBe("after");
    expect(pickEffectiveCompensationProfile([before, after], "w-daily", "2026-01-01")?.id).toBe("before");
  });

  it("finds nothing before the first profile, for another worker, or after an end date", () => {
    expect(pickEffectiveCompensationProfile([before, after], "w-daily", "2025-12-31")).toBeNull();
    expect(pickEffectiveCompensationProfile([before, after], "someone-else", "2026-08-20")).toBeNull();
    expect(pickEffectiveCompensationProfile([before], "w-daily", "2026-08-15")).toBeNull();
  });
});

describe("computeEntryCompensation (Step 7 fixture numbers)", () => {
  it.each([
    ["9 h", 540, 0, false, 45_000, 0],
    ["6 h without credit", 360, 0, false, 30_000, 0],
    ["6 h with full-day credit (approval lifts it to 540 regular)", 540, 0, true, 45_000, 0],
    ["10 h 30 m", 540, 90, false, 45_000, 10_500],
  ])("daily, %s", (_label, regular, overtime, fullDayCredit, base, overtimePay) => {
    const pay = computeEntryCompensation({ approvedRegularMinutes: regular, approvedOvertimeMinutes: overtime, fullDayCredit }, DAILY);
    expect(pay.baseAgorot).toBe(base);
    expect(pay.overtimeAgorot).toBe(overtimePay);
  });

  it("daily 6 h with the credit flag but only 360 approved minutes still pays the full day", () => {
    const pay = computeEntryCompensation({ approvedRegularMinutes: 360, approvedOvertimeMinutes: 0, fullDayCredit: true }, DAILY);
    expect(pay).toMatchObject({ standardDayCredited: true, baseAgorot: 45_000, overtimeAgorot: 0 });
  });

  it("hourly 6 h, and a Night Turan emergency 02:00-03:00 paid as 135 compensated minutes", () => {
    expect(computeEntryCompensation({ approvedRegularMinutes: 360, approvedOvertimeMinutes: 0, fullDayCredit: false }, HOURLY).baseAgorot).toBe(30_000);
    const emergency = computeEntryCompensation({ approvedRegularMinutes: 135, approvedOvertimeMinutes: 0, fullDayCredit: false }, HOURLY);
    expect(emergency).toMatchObject({ regularMinutes: 135, overtimeMinutes: 0, baseAgorot: 11_250, overtimeAgorot: 0 });
  });
});

describe("summarizeAdjustments", () => {
  const penalty = { type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY, amountAgorot: -1_000 };

  it("four forgotten stamps in a month (sequence 3 and 4 deduct) net -2,000; reversing one nets -1,000 and keeps the penalty", () => {
    const fourStamps = summarizeAdjustments([penalty, penalty]);
    expect(fourStamps).toEqual({
      positiveAdjustmentsAgorot: 0,
      forgottenStampPenaltiesAgorot: 2_000,
      reversalsAgorot: 0,
      otherDeductionsAgorot: 0,
      deductionsAgorot: 2_000,
    });

    const reversed = summarizeAdjustments([penalty, penalty, { type: PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL, amountAgorot: 1_000 }]);
    expect(reversed.forgottenStampPenaltiesAgorot).toBe(2_000);
    expect(reversed.reversalsAgorot).toBe(1_000);
    expect(reversed.reversalsAgorot - reversed.forgottenStampPenaltiesAgorot).toBe(-1_000);
  });

  it("splits manual bonuses and manual deductions", () => {
    expect(
      summarizeAdjustments([
        { type: PayrollAdjustmentType.MANUAL_BONUS, amountAgorot: 2_500 },
        { type: PayrollAdjustmentType.MANUAL_DEDUCTION, amountAgorot: -700 },
      ]),
    ).toEqual({ positiveAdjustmentsAgorot: 2_500, forgottenStampPenaltiesAgorot: 0, reversalsAgorot: 0, otherDeductionsAgorot: 700, deductionsAgorot: 700 });
  });
});

describe("calculateWorkerPayroll / calculatePayrollMonth", () => {
  it("adds a worker's entries and adjustments into the net", () => {
    const entries = [entry("w-daily", "2026-10-04", 540), entry("w-daily", "2026-10-05", 540, 90), entry("w-daily", "2026-10-06", 360)];
    const adjustments = [
      { id: "a1", workerProfileId: "w-daily", type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY, amountAgorot: -1_000 },
      { id: "a2", workerProfileId: "w-daily", type: PayrollAdjustmentType.MANUAL_BONUS, amountAgorot: 500 },
      { id: "a3", workerProfileId: "someone-else", type: PayrollAdjustmentType.MANUAL_BONUS, amountAgorot: 99_999 },
    ];
    const { worker, entries: lines } = calculateWorkerPayroll("w-daily", entries, [DAILY], adjustments);
    expect(worker).toMatchObject({
      approvedShifts: 3,
      standardDaysCredited: 2,
      regularMinutes: 1_440,
      overtimeMinutes: 90,
      grossBaseAgorot: 45_000 + 45_000 + 30_000,
      overtimeAgorot: 10_500,
      positiveAdjustmentsAgorot: 500,
      forgottenStampPenaltiesAgorot: 1_000,
      netPayableAgorot: 120_000 + 10_500 + 500 - 1_000,
      entriesWithoutCompensation: 0,
    });
    expect(lines.map((line) => line.totalAgorot)).toEqual([45_000, 55_500, 30_000]);
  });

  it("counts an emergency's -60 / +15 minutes and pays its compensated minutes", () => {
    const emergency = entry("w-hourly", "2026-10-07", 135, 0, {
      isEmergency: true,
      emergencyRetroactiveMinutes: 60,
      emergencyReturnMinutes: 15,
      projectId: null,
      siteId: null,
    });
    const { worker } = calculateWorkerPayroll("w-hourly", [emergency], [HOURLY], []);
    expect(worker).toMatchObject({
      approvedShifts: 1,
      emergencyRetroactiveMinutes: 60,
      emergencyReturnMinutes: 15,
      grossBaseAgorot: 11_250,
      netPayableAgorot: 11_250,
    });
  });

  it("does not pay an approved entry without a compensation profile and counts it for the warning", () => {
    const { worker, entries: lines } = calculateWorkerPayroll("w-new", [entry("w-new", "2026-10-04", 540)], [DAILY], []);
    expect(worker).toMatchObject({ approvedShifts: 0, entriesWithoutCompensation: 1, grossBaseAgorot: 0, netPayableAgorot: 0 });
    expect(lines[0]).toMatchObject({ compensationProfileId: null, compensationType: null, totalAgorot: 0 });
  });

  it("uses each shift date's rate when the rate changes mid-month", () => {
    const old: PayrollCompensationProfile = { ...DAILY, id: "old", effectiveEndDate: "2026-10-14" };
    const raised: PayrollCompensationProfile = { ...DAILY, id: "raised", dailyBaseRateAgorot: 50_000, effectiveStartDate: "2026-10-15" };
    const { worker } = calculateWorkerPayroll("w-daily", [entry("w-daily", "2026-10-14", 540), entry("w-daily", "2026-10-15", 540)], [old, raised], []);
    expect(worker.grossBaseAgorot).toBe(95_000);
  });

  it("includes a worker who only has adjustments", () => {
    const month = calculatePayrollMonth({
      entries: [entry("w-daily", "2026-10-04", 540)],
      profiles: [DAILY],
      adjustments: [{ id: "a1", workerProfileId: "w-bonus-only", type: PayrollAdjustmentType.MANUAL_BONUS, amountAgorot: 1_000 }],
    });
    expect(month.workers.map((worker) => [worker.workerProfileId, worker.netPayableAgorot])).toEqual([
      ["w-daily", 45_000],
      ["w-bonus-only", 1_000],
    ]);
    expect(sumPayrollWorkers(month.workers)).toMatchObject({ workers: 2, approvedShifts: 1, netPayableAgorot: 46_000 });
  });
});

describe("groupPayrollEntryCosts", () => {
  it("groups paid entries by project or site, highest first, null for none", () => {
    const entries = [
      entry("w-daily", "2026-10-04", 540, 0, { projectId: "p1", siteId: "s1" }),
      entry("w-hourly", "2026-10-04", 360, 0, { projectId: "p1", siteId: "s2" }),
      entry("w-hourly", "2026-10-05", 135, 0, { projectId: null, siteId: null, isEmergency: true }),
      entry("w-nobody", "2026-10-05", 540, 0, { projectId: "p2", siteId: "s3" }),
    ];
    const { entries: results } = calculatePayrollMonth({ entries, profiles: [DAILY, HOURLY], adjustments: [] });
    expect(groupPayrollEntryCosts(entries, results, "projectId")).toEqual([
      { id: "p1", approvedShifts: 2, workers: 2, regularMinutes: 900, overtimeMinutes: 0, grossBaseAgorot: 75_000, overtimeAgorot: 0, totalAgorot: 75_000 },
      { id: null, approvedShifts: 1, workers: 1, regularMinutes: 135, overtimeMinutes: 0, grossBaseAgorot: 11_250, overtimeAgorot: 0, totalAgorot: 11_250 },
    ]);
    expect(groupPayrollEntryCosts(entries, results, "siteId").map((group) => [group.id, group.totalAgorot])).toEqual([
      ["s1", 45_000],
      ["s2", 30_000],
      [null, 11_250],
    ]);
  });
});

describe("findOvertimeSpikes", () => {
  const day = (date: string, overtimeMinutes: number, worked = true) => ({ date, overtimeMinutes, worked });

  it("flags a day with at least twice the average overtime per working day and at least 60 minutes", () => {
    // 10 working days, 330 overtime minutes: average 33, threshold max(60, 66) = 66.
    const days = [
      ...Array.from({ length: 8 }, (_, i) => day(`2026-10-0${i + 1}`, 0)),
      day("2026-10-09", 30),
      day("2026-10-10", 300),
      day("2026-10-11", 0, false),
    ];
    expect(findOvertimeSpikes(days)).toEqual({ averageDailyMinutes: 33, thresholdMinutes: 66, spikeDates: ["2026-10-10"] });
  });

  it("needs at least 60 minutes even when the average is tiny", () => {
    const days = [day("2026-10-01", 40), ...Array.from({ length: 9 }, (_, i) => day(`2026-10-1${i}`, 0))];
    expect(findOvertimeSpikes(days).spikeDates).toEqual([]);
  });

  it("a single working day is never twice its own average; no overtime means no spikes", () => {
    expect(findOvertimeSpikes([day("2026-10-01", 240)]).spikeDates).toEqual([]);
    expect(findOvertimeSpikes([day("2026-10-01", 0), day("2026-10-02", 0)])).toEqual({ averageDailyMinutes: 0, thresholdMinutes: 60, spikeDates: [] });
  });
});
