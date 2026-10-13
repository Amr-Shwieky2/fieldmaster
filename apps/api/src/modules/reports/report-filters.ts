import { ReportType } from "@fieldmaster/shared-types";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { BUSINESS_DATE_PATTERN, UUID_PATTERN, YEAR_MONTH_PATTERN } from "../../common/validation/patterns";
import type { ReportFilters } from "./report.types";

/** The longest period one report covers (a leap year). */
export const MAX_REPORT_DAYS = 366;

type Presence = "required" | "optional" | "forbidden";

interface FilterRule {
  /** fromDate + toDate. "monthOrDates": either both dates or `yearMonth` (the forgotten-stamp report). */
  dates: Presence | "monthOrDates";
  workerProfileId: Presence;
  projectId: Presence;
  siteId: Presence;
  yearMonth: Presence;
  version: Presence;
}

const PERIOD_ONLY = { workerProfileId: "optional", projectId: "forbidden", siteId: "forbidden", yearMonth: "forbidden", version: "forbidden" } as const;
const PLACE_FILTERS = { workerProfileId: "optional", projectId: "optional", siteId: "optional", yearMonth: "forbidden", version: "forbidden" } as const;

/** Which filters each report type takes (the contract's `ReportFilters`). */
export const REPORT_FILTER_RULES: Record<ReportType, FilterRule> = {
  [ReportType.WORKER_ATTENDANCE_LEDGER]: { dates: "required", ...PERIOD_ONLY, workerProfileId: "required" },
  [ReportType.OPERATIONAL_ATTENDANCE]: { dates: "required", ...PLACE_FILTERS },
  [ReportType.OVERTIME]: { dates: "required", ...PLACE_FILTERS },
  [ReportType.EMERGENCY_CALLOUTS]: { dates: "required", ...PERIOD_ONLY },
  [ReportType.SITE_VIOLATIONS]: { dates: "required", ...PLACE_FILTERS },
  [ReportType.FORGOTTEN_STAMPS]: { dates: "monthOrDates", ...PERIOD_ONLY },
  [ReportType.PAYROLL]: {
    dates: "forbidden",
    workerProfileId: "forbidden",
    projectId: "forbidden",
    siteId: "forbidden",
    yearMonth: "required",
    version: "optional",
  },
};

function invalid(message: string): AppException {
  return new AppException(400, ErrorCodes.VALIDATION_FAILED, message);
}

/** Days since 1970-01-01 of a real calendar date, or null ("2026-02-30" is not one). */
function dayNumber(date: string): number | null {
  if (!BUSINESS_DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return time / 86_400_000;
}

/**
 * Checks a request's filters against its type and returns only the ones
 * that apply (a 400 for anything missing, malformed or not applicable).
 * Whether the ids exist in the caller's organization is checked by the
 * service (404).
 */
export function normalizeReportFilters(type: ReportType, input: ReportFilters): ReportFilters {
  const rule = REPORT_FILTER_RULES[type];
  const has = (value: unknown) => value !== undefined && value !== null && value !== "";

  for (const name of ["workerProfileId", "projectId", "siteId", "yearMonth", "version"] as const) {
    const presence = name === "yearMonth" && rule.dates === "monthOrDates" ? "optional" : rule[name];
    if (presence === "forbidden" && has(input[name])) throw invalid(`${name} does not apply to ${type} reports.`);
    if (presence === "required" && !has(input[name])) throw invalid(`${name} is required for ${type} reports.`);
  }
  for (const name of ["workerProfileId", "projectId", "siteId"] as const) {
    if (has(input[name]) && !UUID_PATTERN.test(String(input[name]))) throw invalid(`${name} must be a UUID.`);
  }
  if (has(input.yearMonth) && !YEAR_MONTH_PATTERN.test(String(input.yearMonth))) throw invalid("yearMonth must be a month in the form YYYY-MM.");
  if (has(input.version) && !(Number.isInteger(input.version) && (input.version as number) >= 1))
    throw invalid("version must be a payroll version number (1, 2, ...).");

  const hasDates = has(input.fromDate) || has(input.toDate);
  if (rule.dates === "forbidden" && hasDates) throw invalid(`fromDate and toDate do not apply to ${type} reports.`);
  if (rule.dates === "monthOrDates") {
    if (hasDates === has(input.yearMonth)) throw invalid(`${type} reports take either fromDate and toDate, or yearMonth.`);
  } else if (rule.dates === "required" && !hasDates) {
    throw invalid(`fromDate and toDate are required for ${type} reports.`);
  }
  if (hasDates) {
    if (!has(input.fromDate) || !has(input.toDate)) throw invalid("fromDate and toDate go together.");
    const from = dayNumber(String(input.fromDate));
    const to = dayNumber(String(input.toDate));
    if (from === null || to === null) throw invalid("fromDate and toDate must be dates in the form YYYY-MM-DD.");
    if (to < from) throw invalid("toDate must not be before fromDate.");
    if (to - from + 1 > MAX_REPORT_DAYS) throw invalid(`A report covers at most ${MAX_REPORT_DAYS} days.`);
  }

  const filters: ReportFilters = {};
  if (hasDates) {
    filters.fromDate = input.fromDate;
    filters.toDate = input.toDate;
  }
  if (has(input.yearMonth)) filters.yearMonth = input.yearMonth;
  if (has(input.version)) filters.version = input.version;
  if (has(input.workerProfileId)) filters.workerProfileId = String(input.workerProfileId).toLowerCase();
  if (has(input.projectId)) filters.projectId = String(input.projectId).toLowerCase();
  if (has(input.siteId)) filters.siteId = String(input.siteId).toLowerCase();
  return filters;
}
