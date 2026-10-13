export const QUEUE_NAMES = {
  EXPIRE_TEMPORARY_CHECK_IN_POINTS: "expire-temporary-check-in-points",
  EXPIRE_ONBOARDING_INVITATIONS: "expire-onboarding-invitations",
  LONG_OPEN_ENTRIES: "long-open-entries",
  /** Step 7: one job per payroll calculation run (processor in PayrollModule). */
  PAYROLL_CALCULATION: "payroll-calculation",
  /** Step 8: one job per generated report, PDF + CSV (processor in ReportsModule). */
  REPORT_GENERATION: "report-generation",
} as const;

/**
 * Redis key prefix of every queue: `QUEUE_PREFIX`, or one per database
 * (`fm:<database name>`). Jobs carry row ids (a payroll calculation run), so
 * two APIs sharing one Redis but not one database -- the dev server and the
 * e2e tests -- must never take each other's jobs.
 */
export function queuePrefix(env: NodeJS.ProcessEnv = process.env): string {
  if (env.QUEUE_PREFIX) return env.QUEUE_PREFIX;
  try {
    const database = new URL(env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
    return `fm:${database || "fieldmaster"}`;
  } catch {
    return "fm:fieldmaster";
  }
}
