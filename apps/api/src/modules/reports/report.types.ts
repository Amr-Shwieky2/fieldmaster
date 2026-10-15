import type { ReportStatus, ReportType } from "@fieldmaster/shared-types";
import type { PrismaService } from "../../common/prisma/prisma.service";
import type { PayrollCalculationService } from "../payroll/payroll-calculation.service";
import type { AttendanceCostService } from "../payroll/attendance-cost.service";
import type { PayrollVersionsService } from "../payroll/payroll-versions.service";
import type { AttendanceRecordsService } from "../attendance/attendance-records.service";
import type { WorkRulesService } from "../../common/settings/work-rules.service";
import type { PageOrientation, SafeHtml } from "./render/html";

/**
 * Response shapes of the report routes (Step 8). They mirror the "Reports
 * (Step 8)" section of `packages/api-client/src/types.ts`. No key holds
 * money: the money of a financial report is only inside its files.
 */

/** A report's filters as stored (`filters_json`) and echoed back: only the ones that apply to its type. Dates are business dates, inclusive. */
export interface ReportFilters {
  fromDate?: string;
  toDate?: string;
  workerProfileId?: string;
  projectId?: string;
  siteId?: string;
  yearMonth?: string;
  version?: number;
  /**
   * Set by the service for a requester restricted to some projects (never
   * taken from a request): the report only covers those projects' shifts.
   * Stored with the report so the background job applies it.
   */
  scope?: { projectIds: string[]; siteIds: string[] };
}

export interface GeneratedReportDto {
  id: string;
  reportType: ReportType;
  status: ReportStatus;
  progress: number;
  filters: ReportFilters;
  includesFinancials: boolean;
  templateVersion: string;
  requestedByUserId: string;
  requestedByName: string | null;
  subjectWorkerProfileId: string | null;
  subjectWorkerName: string | null;
  sha256Hash: string | null;
  pdfSha256: string | null;
  csvSha256: string | null;
  pageCount: number | null;
  errorCode: string | null;
  generatedAt: Date;
  finishedAt: Date | null;
}

export type ReportFileFormat = "pdf" | "csv";

export interface ReportDownloadDto {
  downloadUrl: string;
  expiresInSeconds: number;
  fileName: string;
  sha256: string | null;
}

export interface ReportVerificationDto {
  reportId: string;
  valid: boolean;
  checkedAt: Date;
  dataSha256: string | null;
  files: { format: "PDF" | "CSV"; expectedSha256: string | null; actualSha256: string | null; matches: boolean }[];
}

// ── Generating a report ──────────────────────────────────────────────────

/** What the data loaders read through: the services that already define the attendance evidence, the pay of an entry and a payroll version. */
export interface ReportDataDeps {
  prisma: PrismaService;
  payrollCalculation: PayrollCalculationService;
  attendanceCost: AttendanceCostService;
  attendanceRecords: AttendanceRecordsService;
  payrollVersions: PayrollVersionsService;
  /** The organization's work-rule versions (each entry is priced with the rules of its business date). */
  workRules: WorkRulesService;
}

export interface ReportLoadContext {
  organizationId: string;
  filters: ReportFilters;
}

/** Names shown in the header: the organization and the entities the filters name. */
export interface ReportNames {
  organizationName: string;
  workerName: string | null;
  projectName: string | null;
  siteName: string | null;
}

/** Everything about a report a template needs besides its data. */
export interface ReportDocumentMeta {
  reportId: string;
  reportType: ReportType;
  title: string;
  financial: boolean;
  filters: ReportFilters;
  names: ReportNames;
  generatedAt: Date;
  generatedByName: string | null;
  /** SHA-256 of the report's source data (printed in the header and every footer). */
  dataHash: string;
}

/**
 * One report type in one version (financial or operational). The two
 * versions of a type are separate definitions: the operational one loads a
 * data type without any money field and renders it with its own template.
 */
export interface ReportDefinition<D> {
  orientation: PageOrientation;
  load(deps: ReportDataDeps, context: ReportLoadContext): Promise<D>;
  /** The PDF's body (header included). */
  body(data: D, meta: ReportDocumentMeta): SafeHtml;
  csv(data: D, meta: ReportDocumentMeta): string;
}
