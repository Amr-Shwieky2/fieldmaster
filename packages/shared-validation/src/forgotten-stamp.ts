import { FORGOTTEN_STAMP_FREE_INFRACTIONS, FORGOTTEN_STAMP_PENALTY_AGOROT } from "@fieldmaster/shared-types";

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
