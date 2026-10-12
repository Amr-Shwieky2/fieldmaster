import { STANDARD_DAY_MINUTES } from "@fieldmaster/shared-types";

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
 * breaks; the first 540 are regular and the rest overtime. Full-day credit
 * turns a day shorter than 540 worked minutes into 540 regular minutes.
 *
 * The approval endpoint stores exactly this split, and the admin web's
 * correction preview shows it before a correction is saved.
 */
export function splitWorkedMinutes(input: WorkedMinutesInput): WorkedMinutesSplit {
  const workedMinutes = Math.max(0, input.rawDurationMinutes - input.unpaidBreakMinutes);
  if (input.fullDayCredit && workedMinutes < STANDARD_DAY_MINUTES) {
    return { workedMinutes, regularMinutes: STANDARD_DAY_MINUTES, overtimeMinutes: 0, fullDayCreditApplied: true };
  }
  return {
    workedMinutes,
    regularMinutes: Math.min(workedMinutes, STANDARD_DAY_MINUTES),
    overtimeMinutes: Math.max(0, workedMinutes - STANDARD_DAY_MINUTES),
    fullDayCreditApplied: false,
  };
}
