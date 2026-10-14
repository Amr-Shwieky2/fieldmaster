import type { CreateReportInput, GeneratedReport, PayrollPeriodSummary, PayrollVersionSummary, ReportFilters } from "@fieldmaster/api-client";
import { ReportStatus, ReportType } from "@fieldmaster/shared-types";
import { BUSINESS_DATE_PATTERN, YEAR_MONTH_PATTERN } from "@/lib/jerusalem-time";

/**
 * The report form without React: which filters each report type takes, the
 * checks before a report is requested, and the request body. Dates are
 * business dates (YYYY-MM-DD, Asia/Jerusalem), inclusive.
 */

/** Every report type, in the order the form offers them (the payroll report, which is money, last). */
export const REPORT_TYPES: readonly ReportType[] = [
  ReportType.WORKER_ATTENDANCE_LEDGER,
  ReportType.OPERATIONAL_ATTENDANCE,
  ReportType.OVERTIME,
  ReportType.EMERGENCY_CALLOUTS,
  ReportType.SITE_VIOLATIONS,
  ReportType.FORGOTTEN_STAMPS,
  ReportType.PAYROLL,
];

/** The types a caller may request: the payroll report only for one who may request it (financial reports and the payroll, see `canRequestPayrollReport`). */
export function reportTypesFor(canRequestPayroll: boolean): ReportType[] {
  return REPORT_TYPES.filter((type) => canRequestPayroll || type !== ReportType.PAYROLL);
}

export interface ReportTypeFilters {
  /** A from/to date range (every type except the payroll report). */
  dateRange: boolean;
  /** The worker filter: required for the ledger, optional for some types, absent for the others. */
  worker: "required" | "optional" | null;
  /** Optional project and site (a site of the chosen project). */
  projectAndSite: boolean;
  /** A month and one of its payroll versions. */
  payroll: boolean;
}

export function filtersFor(type: ReportType): ReportTypeFilters {
  switch (type) {
    case ReportType.WORKER_ATTENDANCE_LEDGER:
      return { dateRange: true, worker: "required", projectAndSite: false, payroll: false };
    case ReportType.OPERATIONAL_ATTENDANCE:
    case ReportType.OVERTIME:
    case ReportType.SITE_VIOLATIONS:
      return { dateRange: true, worker: "optional", projectAndSite: true, payroll: false };
    case ReportType.EMERGENCY_CALLOUTS:
    case ReportType.FORGOTTEN_STAMPS:
      return { dateRange: true, worker: "optional", projectAndSite: false, payroll: false };
    case ReportType.PAYROLL:
      return { dateRange: false, worker: null, projectAndSite: false, payroll: true };
  }
}

/** What the form holds (empty strings for "not chosen"). */
export interface ReportFormValues {
  reportType: ReportType;
  fromDate: string;
  toDate: string;
  workerProfileId: string;
  projectId: string;
  siteId: string;
  yearMonth: string;
  version: string;
}

export type ReportFormField = "workerProfileId" | "fromDate" | "toDate" | "yearMonth" | "version";
export type ReportFormError = "workerRequired" | "fromDateRequired" | "toDateRequired" | "rangeOrder" | "monthRequired" | "versionRequired";

/** The fields in the order they appear (the first invalid one gets the focus). */
export const REPORT_FORM_FIELDS: readonly ReportFormField[] = ["yearMonth", "version", "workerProfileId", "fromDate", "toDate"];

/** The problems of the form for its report type (empty when it may be sent). */
export function validateReportForm(values: ReportFormValues): Partial<Record<ReportFormField, ReportFormError>> {
  const fields = filtersFor(values.reportType);
  const problems: Partial<Record<ReportFormField, ReportFormError>> = {};
  if (fields.dateRange) {
    const from = BUSINESS_DATE_PATTERN.test(values.fromDate) ? values.fromDate : null;
    const to = BUSINESS_DATE_PATTERN.test(values.toDate) ? values.toDate : null;
    if (!from) problems.fromDate = "fromDateRequired";
    if (!to) problems.toDate = "toDateRequired";
    // ISO dates compare as text.
    if (from && to && from > to) problems.toDate = "rangeOrder";
  }
  if (fields.worker === "required" && values.workerProfileId === "") problems.workerProfileId = "workerRequired";
  if (fields.payroll) {
    if (!YEAR_MONTH_PATTERN.test(values.yearMonth)) problems.yearMonth = "monthRequired";
    if (!/^[1-9]\d*$/.test(values.version)) problems.version = "versionRequired";
  }
  return problems;
}

/** The request for a valid form: only the filters its type takes, without the empty optional ones. */
export function buildReportInput(values: ReportFormValues): CreateReportInput {
  const fields = filtersFor(values.reportType);
  const filters: ReportFilters = {};
  if (fields.payroll) {
    filters.yearMonth = values.yearMonth;
    filters.version = Number(values.version);
  }
  if (fields.dateRange) {
    filters.fromDate = values.fromDate;
    filters.toDate = values.toDate;
  }
  if (fields.worker !== null && values.workerProfileId !== "") filters.workerProfileId = values.workerProfileId;
  if (fields.projectAndSite && values.projectId !== "") {
    filters.projectId = values.projectId;
    if (values.siteId !== "") filters.siteId = values.siteId;
  }
  return { reportType: values.reportType, filters };
}

/** Still being generated (the page polls it). */
export function isReportRunning(report: Pick<GeneratedReport, "status"> | null | undefined): boolean {
  return report?.status === ReportStatus.QUEUED || report?.status === ReportStatus.RUNNING;
}

/** A whole percentage between 0 and 100. */
export function clampProgress(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function reportStatusTone(status: ReportStatus): "neutral" | "info" | "success" | "danger" {
  switch (status) {
    case ReportStatus.READY:
      return "success";
    case ReportStatus.FAILED:
      return "danger";
    case ReportStatus.RUNNING:
      return "info";
    default:
      return "neutral";
  }
}

/** The month a payroll report starts on: the latest calculated month, else the latest month. */
export function defaultPayrollMonth(periods: PayrollPeriodSummary[] | undefined): string {
  const sorted = [...(periods ?? [])].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  return (sorted.find((period) => period.calculatedAt !== null) ?? sorted[0])?.yearMonth ?? "";
}

/** A version can be reported once it was calculated. */
export function isReportableVersion(version: Pick<PayrollVersionSummary, "calculatedAt">): boolean {
  return version.calculatedAt !== null;
}

/** The version a payroll report starts on: the month's current version, else its latest calculated one. */
export function defaultPayrollVersion(versions: PayrollVersionSummary[] | undefined): string {
  const reportable = (versions ?? []).filter(isReportableVersion).sort((a, b) => b.version - a.version);
  const chosen = reportable.find((version) => version.isCurrent) ?? reportable[0];
  return chosen ? String(chosen.version) : "";
}
