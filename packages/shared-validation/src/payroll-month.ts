import { CompensationType, OVERTIME_SPIKE_FACTOR, OVERTIME_SPIKE_MIN_MINUTES, PayrollAdjustmentType } from "@fieldmaster/shared-types";
import type { DayRules } from "./attendance";
import { calculateDailyCompensation, calculateHourlyCompensation } from "./payroll";

/**
 * The work rules in force on a business date (YYYY-MM-DD), from the
 * organization's rule versions (or, for a calculation stored before the
 * rules were settings, the fixed rules of that time). Always given.
 */
export type DayRulesFor = (businessDate: string) => DayRules;

/**
 * A month of payroll from plain data (Step 7): which compensation profile
 * applies to each approved entry, what each entry pays (the calculators in
 * payroll.ts), and each worker's totals with the month's adjustments.
 *
 * The API's background calculation, the Owner dashboard's live figures, the
 * worker's estimate and the seed all call these functions, so their numbers
 * cannot drift apart. Integer agorot only: every amount comes from the
 * calculators' single rounding step and is only ever added up here.
 */

export interface PayrollCompensationProfile {
  id: string;
  workerProfileId: string;
  compensationType: CompensationType;
  dailyBaseRateAgorot: number | null;
  baseHourlyRateAgorot: number | null;
  overtimeHourlyRateAgorot: number;
  /** YYYY-MM-DD, inclusive. */
  effectiveStartDate: string;
  /** YYYY-MM-DD, inclusive; null = open-ended. */
  effectiveEndDate: string | null;
}

/**
 * The profile in effect on a business date: started on or before it and not
 * ended before it, the latest start first (the database forbids overlapping
 * profiles, so at most one matches).
 */
export function pickEffectiveCompensationProfile<P extends PayrollCompensationProfile>(
  profiles: readonly P[],
  workerProfileId: string,
  businessDate: string,
): P | null {
  let best: P | null = null;
  for (const profile of profiles) {
    if (profile.workerProfileId !== workerProfileId) continue;
    if (profile.effectiveStartDate > businessDate) continue;
    if (profile.effectiveEndDate !== null && profile.effectiveEndDate < businessDate) continue;
    if (!best || profile.effectiveStartDate > best.effectiveStartDate) best = profile;
  }
  return best;
}

export interface EntryCompensation {
  standardDayCredited: boolean;
  regularMinutes: number;
  overtimeMinutes: number;
  baseAgorot: number;
  overtimeAgorot: number;
}

/**
 * What one approved entry pays under a profile: approved regular + overtime
 * minutes and the full-day credit go through `calculateDailyCompensation` or
 * `calculateHourlyCompensation`.
 */
export function computeEntryCompensation(
  entry: { approvedRegularMinutes: number | null; approvedOvertimeMinutes: number | null; fullDayCredit: boolean },
  profile: Pick<PayrollCompensationProfile, "compensationType" | "dailyBaseRateAgorot" | "baseHourlyRateAgorot" | "overtimeHourlyRateAgorot">,
  rules: DayRules,
): EntryCompensation {
  const approvedMinutes = (entry.approvedRegularMinutes ?? 0) + (entry.approvedOvertimeMinutes ?? 0);

  if (profile.compensationType === CompensationType.DAILY) {
    const result = calculateDailyCompensation(
      {
        dailyBaseRateAgorot: profile.dailyBaseRateAgorot ?? 0,
        overtimeHourlyRateAgorot: profile.overtimeHourlyRateAgorot,
        approvedMinutes,
        fullDayCredit: entry.fullDayCredit,
      },
      rules,
    );
    return {
      standardDayCredited: result.standardDaysCredited === 1,
      regularMinutes: entry.approvedRegularMinutes ?? 0,
      overtimeMinutes: result.overtimeMinutes,
      baseAgorot: result.baseCompensationAgorot,
      overtimeAgorot: result.overtimeCompensationAgorot,
    };
  }

  const result = calculateHourlyCompensation(
    {
      baseHourlyRateAgorot: profile.baseHourlyRateAgorot ?? 0,
      overtimeHourlyRateAgorot: profile.overtimeHourlyRateAgorot,
      approvedMinutes,
      fullDayCredit: entry.fullDayCredit,
    },
    rules,
  );
  return {
    standardDayCredited: false,
    regularMinutes: result.regularMinutes,
    overtimeMinutes: result.overtimeMinutes,
    baseAgorot: result.regularCompensationAgorot,
    overtimeAgorot: result.overtimeCompensationAgorot,
  };
}

export interface PayrollMonthEntry {
  timeEntryId: string;
  workerProfileId: string;
  /** YYYY-MM-DD (Asia/Jerusalem). */
  businessDate: string;
  approvedRegularMinutes: number | null;
  approvedOvertimeMinutes: number | null;
  fullDayCredit: boolean;
  isEmergency: boolean;
  /** An emergency call-out's -60 / +15 minutes (already inside its approved minutes); 0 otherwise. */
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  projectId: string | null;
  siteId: string | null;
}

export interface PayrollMonthAdjustment {
  id: string;
  workerProfileId: string;
  type: PayrollAdjustmentType | string;
  /** Signed: positive adds, negative deducts. */
  amountAgorot: number;
}

export interface PayrollEntryResult {
  timeEntryId: string;
  workerProfileId: string;
  /** Null: no compensation profile on the entry's date, so it pays nothing. */
  compensationProfileId: string | null;
  compensationType: CompensationType | null;
  standardDayCredited: boolean;
  regularMinutes: number;
  overtimeMinutes: number;
  baseAgorot: number;
  overtimeAgorot: number;
  totalAgorot: number;
}

export interface AdjustmentBreakdown {
  /** Manual bonuses. */
  positiveAdjustmentsAgorot: number;
  /** Forgotten-stamp penalties, as a positive amount to deduct. */
  forgottenStampPenaltiesAgorot: number;
  /** Reversals of forgotten-stamp penalties, as a positive amount to add back. */
  reversalsAgorot: number;
  /** Manual (and any other) deductions, as a positive amount to deduct. */
  otherDeductionsAgorot: number;
  /** Penalties + other deductions. */
  deductionsAgorot: number;
}

/** Splits a worker's adjustments by kind. A reversal never removes the penalty: both stay and offset each other. */
export function summarizeAdjustments(adjustments: readonly Pick<PayrollMonthAdjustment, "type" | "amountAgorot">[]): AdjustmentBreakdown {
  let positiveAdjustmentsAgorot = 0;
  let forgottenStampPenaltiesAgorot = 0;
  let reversalsAgorot = 0;
  let otherDeductionsAgorot = 0;
  for (const { type, amountAgorot } of adjustments) {
    if (type === PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY && amountAgorot < 0) forgottenStampPenaltiesAgorot -= amountAgorot;
    else if (type === PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL && amountAgorot > 0) reversalsAgorot += amountAgorot;
    else if (amountAgorot > 0) positiveAdjustmentsAgorot += amountAgorot;
    else otherDeductionsAgorot -= amountAgorot;
  }
  return {
    positiveAdjustmentsAgorot,
    forgottenStampPenaltiesAgorot,
    reversalsAgorot,
    otherDeductionsAgorot,
    deductionsAgorot: forgottenStampPenaltiesAgorot + otherDeductionsAgorot,
  };
}

export interface PayrollWorkerResult extends AdjustmentBreakdown {
  workerProfileId: string;
  /** Approved entries that were paid (had a compensation profile). */
  approvedShifts: number;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  netPayableAgorot: number;
  /** Approved entries without a compensation profile on their date: not paid (the calculation warns about them). */
  entriesWithoutCompensation: number;
}

/**
 * One worker's month: the worker's approved entries and adjustments (others
 * in the lists are ignored). Each entry is priced with the rules in force on
 * its own business date (`rulesFor`).
 */
export function calculateWorkerPayroll(
  workerProfileId: string,
  entries: readonly PayrollMonthEntry[],
  profiles: readonly PayrollCompensationProfile[],
  adjustments: readonly PayrollMonthAdjustment[],
  rulesFor: DayRulesFor,
): { worker: PayrollWorkerResult; entries: PayrollEntryResult[] } {
  const entryResults: PayrollEntryResult[] = [];
  let approvedShifts = 0;
  let standardDaysCredited = 0;
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let emergencyRetroactiveMinutes = 0;
  let emergencyReturnMinutes = 0;
  let grossBaseAgorot = 0;
  let overtimeAgorot = 0;
  let entriesWithoutCompensation = 0;

  for (const entry of entries) {
    if (entry.workerProfileId !== workerProfileId) continue;
    const profile = pickEffectiveCompensationProfile(profiles, workerProfileId, entry.businessDate);
    if (!profile) {
      // Still an approved operational record, but there is no rate to pay it with.
      entriesWithoutCompensation += 1;
      entryResults.push({
        timeEntryId: entry.timeEntryId,
        workerProfileId,
        compensationProfileId: null,
        compensationType: null,
        standardDayCredited: false,
        regularMinutes: 0,
        overtimeMinutes: 0,
        baseAgorot: 0,
        overtimeAgorot: 0,
        totalAgorot: 0,
      });
      continue;
    }

    const pay = computeEntryCompensation(entry, profile, rulesFor(entry.businessDate));
    approvedShifts += 1;
    if (pay.standardDayCredited) standardDaysCredited += 1;
    regularMinutes += pay.regularMinutes;
    overtimeMinutes += pay.overtimeMinutes;
    grossBaseAgorot += pay.baseAgorot;
    overtimeAgorot += pay.overtimeAgorot;
    if (entry.isEmergency) {
      emergencyRetroactiveMinutes += entry.emergencyRetroactiveMinutes;
      emergencyReturnMinutes += entry.emergencyReturnMinutes;
    }
    entryResults.push({
      timeEntryId: entry.timeEntryId,
      workerProfileId,
      compensationProfileId: profile.id,
      compensationType: profile.compensationType,
      ...pay,
      totalAgorot: pay.baseAgorot + pay.overtimeAgorot,
    });
  }

  const breakdown = summarizeAdjustments(adjustments.filter((adjustment) => adjustment.workerProfileId === workerProfileId));
  const netPayableAgorot =
    grossBaseAgorot +
    overtimeAgorot +
    breakdown.positiveAdjustmentsAgorot +
    breakdown.reversalsAgorot -
    breakdown.forgottenStampPenaltiesAgorot -
    breakdown.otherDeductionsAgorot;

  return {
    worker: {
      workerProfileId,
      approvedShifts,
      standardDaysCredited,
      regularMinutes,
      overtimeMinutes,
      emergencyRetroactiveMinutes,
      emergencyReturnMinutes,
      grossBaseAgorot,
      overtimeAgorot,
      ...breakdown,
      netPayableAgorot,
      entriesWithoutCompensation,
    },
    entries: entryResults,
  };
}

/** Workers in a month's payroll: everyone with an approved entry or an adjustment, in first-seen order. */
export function payrollMonthWorkerIds(entries: readonly PayrollMonthEntry[], adjustments: readonly PayrollMonthAdjustment[]): string[] {
  return [...new Set([...entries.map((entry) => entry.workerProfileId), ...adjustments.map((adjustment) => adjustment.workerProfileId)])];
}

/** Every worker's month (see `calculateWorkerPayroll`). */
export function calculatePayrollMonth(input: {
  entries: readonly PayrollMonthEntry[];
  profiles: readonly PayrollCompensationProfile[];
  adjustments: readonly PayrollMonthAdjustment[];
  rulesFor: DayRulesFor;
}): { workers: PayrollWorkerResult[]; entries: PayrollEntryResult[] } {
  const workers: PayrollWorkerResult[] = [];
  const entries: PayrollEntryResult[] = [];
  // Each worker's own rows, grouped once: a month of hundreds of workers must not scan every entry per worker.
  const entriesOf = groupByWorker(input.entries);
  const profilesOf = groupByWorker(input.profiles);
  const adjustmentsOf = groupByWorker(input.adjustments);
  for (const workerProfileId of payrollMonthWorkerIds(input.entries, input.adjustments)) {
    const result = calculateWorkerPayroll(
      workerProfileId,
      entriesOf.get(workerProfileId) ?? [],
      profilesOf.get(workerProfileId) ?? [],
      adjustmentsOf.get(workerProfileId) ?? [],
      input.rulesFor,
    );
    workers.push(result.worker);
    entries.push(...result.entries);
  }
  return { workers, entries };
}

/** Rows by worker, each group in input order. */
export function groupByWorker<T extends { workerProfileId: string }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.workerProfileId);
    if (group) group.push(row);
    else groups.set(row.workerProfileId, [row]);
  }
  return groups;
}

export interface PayrollTotalsResult extends AdjustmentBreakdown {
  workers: number;
  approvedShifts: number;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  netPayableAgorot: number;
}

export function sumPayrollWorkers(workers: readonly PayrollWorkerResult[]): PayrollTotalsResult {
  const totals: PayrollTotalsResult = {
    workers: workers.length,
    approvedShifts: 0,
    standardDaysCredited: 0,
    regularMinutes: 0,
    overtimeMinutes: 0,
    emergencyRetroactiveMinutes: 0,
    emergencyReturnMinutes: 0,
    grossBaseAgorot: 0,
    overtimeAgorot: 0,
    positiveAdjustmentsAgorot: 0,
    forgottenStampPenaltiesAgorot: 0,
    reversalsAgorot: 0,
    otherDeductionsAgorot: 0,
    deductionsAgorot: 0,
    netPayableAgorot: 0,
  };
  for (const worker of workers) {
    totals.approvedShifts += worker.approvedShifts;
    totals.standardDaysCredited += worker.standardDaysCredited;
    totals.regularMinutes += worker.regularMinutes;
    totals.overtimeMinutes += worker.overtimeMinutes;
    totals.emergencyRetroactiveMinutes += worker.emergencyRetroactiveMinutes;
    totals.emergencyReturnMinutes += worker.emergencyReturnMinutes;
    totals.grossBaseAgorot += worker.grossBaseAgorot;
    totals.overtimeAgorot += worker.overtimeAgorot;
    totals.positiveAdjustmentsAgorot += worker.positiveAdjustmentsAgorot;
    totals.forgottenStampPenaltiesAgorot += worker.forgottenStampPenaltiesAgorot;
    totals.reversalsAgorot += worker.reversalsAgorot;
    totals.otherDeductionsAgorot += worker.otherDeductionsAgorot;
    totals.deductionsAgorot += worker.deductionsAgorot;
    totals.netPayableAgorot += worker.netPayableAgorot;
  }
  return totals;
}

export interface PayrollCostGroupResult {
  /** The project or site id; null = entries without one (emergency call-outs). */
  id: string | null;
  approvedShifts: number;
  workers: number;
  regularMinutes: number;
  overtimeMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  totalAgorot: number;
}

/**
 * Labor cost (base + overtime of the paid entries) grouped by project or
 * site, highest first. Adjustments belong to a worker, not to a place, so
 * they are not part of it.
 */
export function groupPayrollEntryCosts(
  entries: readonly PayrollMonthEntry[],
  results: readonly PayrollEntryResult[],
  groupBy: "projectId" | "siteId",
): PayrollCostGroupResult[] {
  const entryById = new Map(entries.map((entry) => [entry.timeEntryId, entry]));
  const groups = new Map<string | null, PayrollCostGroupResult & { workerIds: Set<string> }>();
  for (const result of results) {
    if (result.compensationProfileId === null) continue;
    const entry = entryById.get(result.timeEntryId);
    if (!entry) continue;
    const id = entry[groupBy];
    const group = groups.get(id) ?? {
      id,
      approvedShifts: 0,
      workers: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      grossBaseAgorot: 0,
      overtimeAgorot: 0,
      totalAgorot: 0,
      workerIds: new Set<string>(),
    };
    group.approvedShifts += 1;
    group.workerIds.add(result.workerProfileId);
    group.regularMinutes += result.regularMinutes;
    group.overtimeMinutes += result.overtimeMinutes;
    group.grossBaseAgorot += result.baseAgorot;
    group.overtimeAgorot += result.overtimeAgorot;
    group.totalAgorot += result.totalAgorot;
    groups.set(id, group);
  }
  return [...groups.values()].map(({ workerIds, ...group }) => ({ ...group, workers: workerIds.size })).sort((a, b) => b.totalAgorot - a.totalAgorot);
}

export interface OvertimeDay {
  /** YYYY-MM-DD. */
  date: string;
  overtimeMinutes: number;
  /** At least one approved, paid shift that day. */
  worked: boolean;
}

/**
 * The Owner dashboard's overtime spikes (a reporting rule only, no pay
 * depends on it): a day is a spike when its overtime minutes are at least
 * OVERTIME_SPIKE_FACTOR times the month's average overtime per working day
 * and at least OVERTIME_SPIKE_MIN_MINUTES. Compared in integers
 * (day x workingDays >= factor x total), so there is no rounding.
 */
export function findOvertimeSpikes(days: readonly OvertimeDay[]): {
  averageDailyMinutes: number;
  thresholdMinutes: number;
  spikeDates: string[];
} {
  const workingDays = days.filter((day) => day.worked).length;
  const totalMinutes = days.reduce((sum, day) => sum + day.overtimeMinutes, 0);
  if (workingDays === 0 || totalMinutes === 0) {
    return { averageDailyMinutes: 0, thresholdMinutes: OVERTIME_SPIKE_MIN_MINUTES, spikeDates: [] };
  }
  const spikeDates = days
    .filter((day) => day.overtimeMinutes >= OVERTIME_SPIKE_MIN_MINUTES && day.overtimeMinutes * workingDays >= OVERTIME_SPIKE_FACTOR * totalMinutes)
    .map((day) => day.date);
  return {
    averageDailyMinutes: Math.round(totalMinutes / workingDays),
    thresholdMinutes: Math.max(OVERTIME_SPIKE_MIN_MINUTES, Math.ceil((OVERTIME_SPIKE_FACTOR * totalMinutes) / workingDays)),
    spikeDates,
  };
}
