import type { WorkRules } from "@fieldmaster/shared-types";

/** The rules the day split and the pay formulas need. */
export type DayRules = Pick<WorkRules, "standardDayMinutes" | "overtimeThresholdMinutes">;

/** Whole minutes from clock-in to clock-out, rounded to the nearest minute and never negative. */
export function rawDurationMinutes(clockInAt: Date, clockOutAt: Date): number {
  return Math.max(0, Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60_000));
}

export interface WorkedMinutesInput {
  rawDurationMinutes: number;
  unpaidBreakMinutes: number;
  fullDayCredit: boolean;
}

export interface WorkedMinutesSplit {
  /** Raw duration minus unpaid breaks. */
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  /** True when full-day credit lifted a shorter day to a standard day of regular minutes. */
  fullDayCreditApplied: boolean;
}

/**
 * How approving a time entry splits it into regular and overtime minutes
 * (spec sections 9 and 12): worked minutes are the raw duration minus unpaid
 * breaks; the first 540 (the overtime threshold of the work rules in force on
 * the entry's business date) are regular and the rest overtime. Full-day
 * credit turns a day shorter than the standard day (540 by default) into a
 * standard day of regular minutes.
 *
 * The approval endpoint stores exactly this split, and the admin web's
 * correction preview shows it before a correction is saved.
 */
export function splitWorkedMinutes(input: WorkedMinutesInput, rules: DayRules): WorkedMinutesSplit {
  const workedMinutes = Math.max(0, input.rawDurationMinutes - input.unpaidBreakMinutes);
  if (input.fullDayCredit && workedMinutes < rules.standardDayMinutes) {
    return { workedMinutes, regularMinutes: rules.standardDayMinutes, overtimeMinutes: 0, fullDayCreditApplied: true };
  }
  return {
    workedMinutes,
    regularMinutes: Math.min(workedMinutes, rules.overtimeThresholdMinutes),
    overtimeMinutes: Math.max(0, workedMinutes - rules.overtimeThresholdMinutes),
    fullDayCreditApplied: false,
  };
}
