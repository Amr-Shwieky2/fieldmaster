import type { WorkRules } from "@fieldmaster/shared-types";

/**
 * The rules these tests price with, given explicitly to every calculation
 * (the rules argument is required: there is no default). They are the values
 * every organization's first rule version has.
 */
export const RULES: WorkRules = {
  standardDayMinutes: 540,
  overtimeThresholdMinutes: 540,
  freeForgottenStampsPerMonth: 2,
  forgottenStampPenaltyAgorot: 1000,
  emergencyMinutesBefore: 60,
  emergencyMinutesAfter: 15,
  clockInEarlyWindowMinutes: 60,
};

/** The same rules on every business date. */
export const RULES_FOR = (): WorkRules => RULES;
