import { FORGOTTEN_STAMP_FREE_INFRACTIONS, FORGOTTEN_STAMP_PENALTY_AGOROT } from "@fieldmaster/shared-types";
import { toBusinessYearMonth } from "./business-date";

export interface ForgottenStampEvaluation {
  monthlySequenceNumber: number;
  deductionAgorot: number;
}

/**
 * Two-strike rule (spec section 14): the first two forgotten clock-stamp
 * infractions in a calendar month (Asia/Jerusalem) are free; every
 * infraction from the third onward deducts a fixed 10.00 ILS (1000 agorot).
 * `monthlySequenceNumber` is the 1-indexed count of this infraction among
 * all forgotten-clock-in/forgotten-clock-out infractions for the worker in
 * that month, including this one.
 */
export function evaluateForgottenStampInfraction(monthlySequenceNumber: number): ForgottenStampEvaluation {
  if (monthlySequenceNumber < 1) {
    throw new Error("monthlySequenceNumber must be >= 1");
  }
  const deductionAgorot =
    monthlySequenceNumber > FORGOTTEN_STAMP_FREE_INFRACTIONS ? FORGOTTEN_STAMP_PENALTY_AGOROT : 0;
  return { monthlySequenceNumber, deductionAgorot };
}

/**
 * The business month (YYYY-MM, Asia/Jerusalem) a forgotten-stamp infraction
 * is counted in. A correction that creates the missing time entry (a
 * forgotten clock-in with no entry at all) counts in the month of the
 * clock-in it adds; a correction to an existing entry counts in the month the
 * correction is made.
 *
 * The API records infractions with this month, and the admin web uses it to
 * tell the manager "this is infraction number N this month" before saving.
 */
export function forgottenStampInfractionMonth(correction: { createsTimeEntry: boolean; clockInAt?: Date }, now: Date = new Date()): string {
  if (correction.createsTimeEntry) {
    if (!correction.clockInAt) throw new Error("clockInAt is required when the correction creates the time entry");
    return toBusinessYearMonth(correction.clockInAt);
  }
  return toBusinessYearMonth(now);
}
