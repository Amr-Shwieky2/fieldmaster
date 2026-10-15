/**
 * The organization's work rules (flexible organization model).
 *
 * The numbers the payroll and attendance calculations used to hard-code are
 * organization settings now, kept as effective-dated VERSIONS: a change is a
 * new version with an effective date, never an edit of an old one, and every
 * calculation uses the version in force on the business date it is about
 * (the shift's business date, or the month of a forgotten-stamp infraction).
 * A month whose payroll was finalized keeps its own snapshot whatever
 * versions are added later.
 */
export interface WorkRules {
  /** One standard working day, in minutes: the length of a full-day credit and the divisor of a daily worker's proration. */
  standardDayMinutes: number;
  /** Worked minutes beyond this are overtime (not less than the standard day). */
  overtimeThresholdMinutes: number;
  /** Forgotten-stamp infractions per month (per worker) that cost nothing. */
  freeForgottenStampsPerMonth: number;
  /** What each infraction beyond the free ones deducts, in agorot. Money: only for those who may see money. */
  forgottenStampPenaltyAgorot: number;
  /** An emergency call-out is paid from this many minutes before the worker's click. */
  emergencyMinutesBefore: number;
  /** ... until this many minutes after the end click (the way back). */
  emergencyMinutesAfter: number;
  /** A worker may clock in this many minutes before the shift starts (not earlier). */
  clockInEarlyWindowMinutes: number;
}

export type WorkRuleKey = keyof WorkRules;

/** The values the system used before they became settings. An organization that never changes them keeps exactly these. */
export const DEFAULT_WORK_RULES: Readonly<WorkRules> = {
  standardDayMinutes: 540,
  overtimeThresholdMinutes: 540,
  freeForgottenStampsPerMonth: 2,
  forgottenStampPenaltyAgorot: 1000,
  emergencyMinutesBefore: 60,
  emergencyMinutesAfter: 15,
  clockInEarlyWindowMinutes: 60,
};

export const WORK_RULE_KEYS: readonly WorkRuleKey[] = [
  "standardDayMinutes",
  "overtimeThresholdMinutes",
  "freeForgottenStampsPerMonth",
  "forgottenStampPenaltyAgorot",
  "emergencyMinutesBefore",
  "emergencyMinutesAfter",
  "clockInEarlyWindowMinutes",
];

/** The money rule: its value is shown and changed only by someone who may see money. */
export const FINANCIAL_WORK_RULE_KEYS: readonly WorkRuleKey[] = ["forgottenStampPenaltyAgorot"];

/** Allowed range of each rule (inclusive). */
export const WORK_RULE_LIMITS: Readonly<Record<WorkRuleKey, { min: number; max: number }>> = {
  standardDayMinutes: { min: 60, max: 1440 },
  overtimeThresholdMinutes: { min: 60, max: 1440 },
  freeForgottenStampsPerMonth: { min: 0, max: 31 },
  forgottenStampPenaltyAgorot: { min: 0, max: 1_000_000 },
  emergencyMinutesBefore: { min: 0, max: 720 },
  emergencyMinutesAfter: { min: 0, max: 720 },
  clockInEarlyWindowMinutes: { min: 0, max: 1440 },
};

/** The first version of every organization covers all dates up to the first change. */
export const WORK_RULES_FIRST_EFFECTIVE_DATE = "2000-01-01";

export interface WorkRulesProblem {
  field: WorkRuleKey;
  kind: "NOT_AN_INTEGER" | "OUT_OF_RANGE" | "THRESHOLD_BELOW_STANDARD_DAY";
}

/** What is wrong with a complete set of rules (empty: it can be saved). */
export function checkWorkRules(rules: WorkRules): WorkRulesProblem[] {
  const problems: WorkRulesProblem[] = [];
  for (const field of WORK_RULE_KEYS) {
    const value = rules[field];
    if (!Number.isInteger(value)) problems.push({ field, kind: "NOT_AN_INTEGER" });
    else if (value < WORK_RULE_LIMITS[field].min || value > WORK_RULE_LIMITS[field].max) problems.push({ field, kind: "OUT_OF_RANGE" });
  }
  if (Number.isInteger(rules.overtimeThresholdMinutes) && Number.isInteger(rules.standardDayMinutes) && rules.overtimeThresholdMinutes < rules.standardDayMinutes) {
    problems.push({ field: "overtimeThresholdMinutes", kind: "THRESHOLD_BELOW_STANDARD_DAY" });
  }
  return problems;
}

/** One stored version, as the API returns it. */
export interface WorkRuleVersion {
  id: string;
  /** 1, 2, 3 ... per organization, in the order they were created. */
  version: number;
  /** YYYY-MM-DD (Asia/Jerusalem): the first business date the version applies to. */
  effectiveFrom: string;
  rules: WorkRules;
  reason: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

/**
 * The version in force on a business date: the latest effective date on or
 * before it, the later created one when two share a date. Versions may come
 * in any order. With none, the defaults apply.
 */
export function pickWorkRules<V extends { effectiveFrom: string; version: number; rules: WorkRules }>(versions: readonly V[], businessDate: string): WorkRules {
  let best: V | null = null;
  for (const candidate of versions) {
    if (candidate.effectiveFrom > businessDate) continue;
    if (!best || candidate.effectiveFrom > best.effectiveFrom || (candidate.effectiveFrom === best.effectiveFrom && candidate.version > best.version)) best = candidate;
  }
  return best ? best.rules : { ...DEFAULT_WORK_RULES };
}
