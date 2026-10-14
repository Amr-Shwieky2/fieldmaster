import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type { GeneratedReport, Prisma } from "@prisma/client";
import { ReportStatus, ReportType } from "@fieldmaster/shared-types";
import { toBusinessDay } from "@fieldmaster/i18n/node";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { FilesService } from "../../common/files/files.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { QUEUE_NAMES } from "../../common/queue/queue.constants";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { projectScopeWhere, siteScopeWhere, workerScopeWhere } from "../../common/scope/scope-filters";
import { canAccessReport, decideReportAccess, reportVisibilityWhere } from "./report-access";
import { normalizeReportFilters } from "./report-filters";
import { templateVersionFor } from "./report-definitions";
import { ReportGenerationService } from "./report-generation.service";
import { sha256Hex } from "./report-hash";
import { enumLabel } from "./render/messages";
import type { CreateReportDto } from "./dto/create-report.dto";
import type { GeneratedReportDto, ReportDownloadDto, ReportFileFormat, ReportFilters, ReportVerificationDto } from "./report.types";

/** Signed download URLs live this long. */
export const REPORT_DOWNLOAD_TTL_SECONDS = 300;

/**
 * Reports (Step 8): requesting one (a background job, see
 * ReportGenerationService), listing, reading, downloading (a short-lived
 * signed URL, audited) and verifying the stored files. Who may generate
 * which report and who may see it is decided in report-access.ts.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly files: FilesService,
    private readonly idempotencyService: IdempotencyService,
    private readonly generation: ReportGenerationService,
    @InjectQueue(QUEUE_NAMES.REPORT_GENERATION) private readonly queue: Queue,
  ) {}

  /**
   * Starts a report: checks the filters (400), the caller's right to this
   * report (403) and that what the filters name exists in the organization
   * (404), then creates the report (QUEUED) and its job. The same
   * Idempotency-Key always answers the same report, in its current state.
   */
  async create(dto: CreateReportDto, actor: AuthenticatedUser, idempotencyKey: string | undefined, correlationId: string): Promise<GeneratedReportDto> {
    const reportType = dto.reportType;
    const filters = normalizeReportFilters(reportType, dto.filters ?? {});
    const { includesFinancials } = decideReportAccess(reportType, actor, filters);
    const resolved = await this.resolveFilters(actor.organizationId, reportType, filters, actor);
    // A requester restricted to some projects gets a report of those projects only: the scope travels with the report to the job.
    if (actor.scope?.restricted) resolved.scope = { projectIds: actor.scope.projectIds, siteIds: actor.scope.siteIds };

    // The request includes who asks: a key reused by someone else is a conflict, never their report.
    const request = { organizationId: actor.organizationId, userId: actor.sub, reportType, filters: dto.filters };
    const { body } = await this.idempotencyService.withIdempotency(idempotencyKey, "report-create", request, async () => {
      const report = await this.prisma.generatedReport.create({
        data: {
          id: generateId(),
          organizationId: actor.organizationId,
          reportType,
          requestedByUserId: actor.sub,
          subjectWorkerProfileId: resolved.workerProfileId ?? null,
          filtersJson: resolved as Prisma.InputJsonValue,
          includesFinancials,
          templateVersion: templateVersionFor(reportType),
          status: ReportStatus.QUEUED,
          progress: 0,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await this.auditService.record({
        organizationId: actor.organizationId,
        actorUserId: actor.sub,
        action: "REPORT_REQUESTED",
        entityType: "GeneratedReport",
        entityId: report.id,
        note: `${reportType} (${includesFinancials ? "financial" : "operational"})`,
        correlationId,
      });
      try {
        await this.queue.add("generate", { reportId: report.id }, { jobId: report.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
      } catch (error) {
        // Redis unreachable: fail the report at once instead of leaving it queued.
        this.logger.error(`Could not queue report ${report.id}: ${error instanceof Error ? error.message : String(error)}`);
        await this.generation.failReport(report.id, "The report could not be queued.");
      }
      return { status: 202, body: { reportId: report.id } };
    });
    return this.get(body.reportId, actor);
  }

  /** 404 for a worker, project, site or payroll version that is not in the caller's organization; a payroll report's version is resolved (the latest when not given). */
  private async resolveFilters(organizationId: string, reportType: ReportType, filters: ReportFilters, actor: AuthenticatedUser): Promise<ReportFilters> {
    const notFound = (what: string) => new AppException(404, ErrorCodes.NOT_FOUND, `${what} not found.`);
    const scope = actor.scope ?? { restricted: false as const };
    // A worker, project or site outside a restricted requester's projects is not found (a worker's own ledger always is theirs).
    const [worker, project, site] = await Promise.all([
      filters.workerProfileId
        ? this.prisma.workerProfile.findFirst({
            where: {
              id: filters.workerProfileId,
              organizationId,
              ...(actor.workerProfileId === filters.workerProfileId ? {} : (workerScopeWhere(scope) ?? {})),
            },
            select: { id: true },
          })
        : null,
      filters.projectId ? this.prisma.project.findFirst({ where: { id: filters.projectId, organizationId, ...(projectScopeWhere(scope) ?? {}) }, select: { id: true } }) : null,
      filters.siteId ? this.prisma.site.findFirst({ where: { id: filters.siteId, organizationId, ...(siteScopeWhere(scope) ?? {}) }, select: { id: true } }) : null,
    ]);
    if (filters.workerProfileId && !worker) throw notFound("Worker");
    if (filters.projectId && !project) throw notFound("Project");
    if (filters.siteId && !site) throw notFound("Site");

    if (reportType !== ReportType.PAYROLL) return { ...filters };
    const yearMonth = filters.yearMonth as string;
    const period =
      filters.version === undefined
        ? await this.prisma.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" }, select: { version: true } })
        : await this.prisma.payrollPeriod.findUnique({
            where: { organizationId_yearMonth_version: { organizationId, yearMonth, version: filters.version } },
            select: { version: true },
          });
    if (!period) throw notFound("Payroll version");
    return { ...filters, version: period.version };
  }

  async list(actor: AuthenticatedUser): Promise<GeneratedReportDto[]> {
    await this.generation.failStaleReports(actor.organizationId);
    const reports = await this.prisma.generatedReport.findMany({
      where: { organizationId: actor.organizationId, ...reportVisibilityWhere(actor) },
      orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return this.toDtos(reports);
  }

  /** The report, if the caller may see it; otherwise (or for a malformed id) 404. */
  async get(reportId: string, actor: AuthenticatedUser): Promise<GeneratedReportDto> {
    await this.generation.failStaleReports(actor.organizationId);
    const report = await this.findInOrganization(reportId, actor.organizationId);
    if (!report || !canAccessReport(report, actor)) throw new AppException(404, ErrorCodes.NOT_FOUND, "Report not found.");
    const [dto] = await this.toDtos([report]);
    return dto;
  }

  /** A short-lived signed URL to the PDF or the CSV of a READY report (audited). */
  async download(reportId: string, format: ReportFileFormat, actor: AuthenticatedUser, correlationId: string): Promise<ReportDownloadDto> {
    const report = await this.findAccessible(reportId, actor);
    if (report.status !== ReportStatus.READY) throw new AppException(409, ErrorCodes.REPORT_NOT_READY, "The report is not ready yet.");
    const key = format === "csv" ? report.csvStorageKey : report.storageKey;
    if (!key) throw new AppException(404, ErrorCodes.NOT_FOUND, `This report has no ${format.toUpperCase()} file.`);

    const fileName = downloadFileName(report.reportType as ReportType, report.generatedAt, format);
    const downloadUrl = await this.files.getSignedDownloadUrl(key, {
      expiresInSeconds: REPORT_DOWNLOAD_TTL_SECONDS,
      downloadFileName: fileName,
      contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
    });
    await this.auditService.record({
      organizationId: actor.organizationId,
      actorUserId: actor.sub,
      action: "REPORT_DOWNLOADED",
      entityType: "GeneratedReport",
      entityId: report.id,
      field: "format",
      newValue: format,
      correlationId,
    });
    return { downloadUrl, expiresInSeconds: REPORT_DOWNLOAD_TTL_SECONDS, fileName, sha256: format === "csv" ? report.csvSha256 : report.pdfSha256 };
  }

  /**
   * Reads the stored files back and hashes them again: valid only when every
   * file matches the hash recorded when it was generated. A missing object,
   * or a report from before Step 8 (no file hash was recorded), is not valid
   * -- never an error.
   */
  async verify(reportId: string, actor: AuthenticatedUser, correlationId: string): Promise<ReportVerificationDto> {
    const report = await this.findAccessible(reportId, actor);
    if (report.status !== ReportStatus.READY) throw new AppException(409, ErrorCodes.REPORT_NOT_READY, "The report is not ready yet.");

    const checks: { format: "PDF" | "CSV"; key: string | null; expected: string | null }[] = [
      { format: "PDF", key: report.storageKey, expected: report.pdfSha256 },
      { format: "CSV", key: report.csvStorageKey, expected: report.csvSha256 },
    ];
    const files: ReportVerificationDto["files"] = [];
    for (const check of checks) {
      if (check.key === null && check.expected === null) continue;
      let actual: string | null = null;
      if (check.key !== null) {
        try {
          const bytes = await this.files.getObject(check.key);
          actual = bytes ? sha256Hex(bytes) : null;
        } catch (error) {
          this.logger.warn(`Could not read ${check.key} to verify report ${report.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      files.push({ format: check.format, expectedSha256: check.expected, actualSha256: actual, matches: check.expected !== null && actual === check.expected });
    }
    const valid = files.length > 0 && files.every((file) => file.matches);

    await this.auditService.record({
      organizationId: actor.organizationId,
      actorUserId: actor.sub,
      action: "REPORT_VERIFIED",
      entityType: "GeneratedReport",
      entityId: report.id,
      newValue: valid ? "valid" : "invalid",
      note: files.map((file) => `${file.format}: ${file.matches ? "matches" : "does not match"}`).join("; ") || "No file to check",
      correlationId,
    });
    return { reportId: report.id, valid, checkedAt: new Date(), dataSha256: report.sha256Hash, files };
  }

  private findInOrganization(reportId: string, organizationId: string): Promise<GeneratedReport | null> {
    if (!UUID_PATTERN.test(reportId)) return Promise.resolve(null);
    return this.prisma.generatedReport.findFirst({ where: { id: reportId, organizationId } });
  }

  /**
   * Download and verify: 404 when the report is not in the organization or the caller may not see it, like the
   * details -- a different answer would tell someone who may not see a report that it exists.
   */
  private async findAccessible(reportId: string, actor: AuthenticatedUser): Promise<GeneratedReport> {
    const report = await this.findInOrganization(reportId, actor.organizationId);
    if (!report || !canAccessReport(report, actor)) throw new AppException(404, ErrorCodes.NOT_FOUND, "Report not found.");
    return report;
  }

  /** DTOs with the requester's and the subject worker's names, from one users query. */
  private async toDtos(reports: readonly GeneratedReport[]): Promise<GeneratedReportDto[]> {
    const requesterIds = [...new Set(reports.map((report) => report.requestedByUserId))];
    const subjectIds = [...new Set(reports.map((report) => report.subjectWorkerProfileId).filter((id): id is string => id !== null))];
    const users =
      reports.length > 0
        ? await this.prisma.user.findMany({
            where: {
              OR: [{ id: { in: requesterIds } }, ...(subjectIds.length > 0 ? [{ memberships: { some: { workerProfile: { id: { in: subjectIds } } } } }] : [])],
            },
            select: { id: true, fullLegalName: true, memberships: { select: { workerProfile: { select: { id: true } } } } },
          })
        : [];
    const nameOfUser = new Map(users.map((user) => [user.id, user.fullLegalName]));
    const nameOfWorker = new Map(
      users.flatMap((user) =>
        user.memberships.flatMap((membership) => (membership.workerProfile ? [[membership.workerProfile.id, user.fullLegalName] as const] : [])),
      ),
    );

    return reports.map((report) => ({
      id: report.id,
      reportType: report.reportType as ReportType,
      status: report.status as ReportStatus,
      progress: report.progress,
      filters: publicFilters((report.filtersJson ?? {}) as unknown as ReportFilters),
      includesFinancials: report.includesFinancials,
      templateVersion: report.templateVersion,
      requestedByUserId: report.requestedByUserId,
      requestedByName: nameOfUser.get(report.requestedByUserId) ?? null,
      subjectWorkerProfileId: report.subjectWorkerProfileId,
      subjectWorkerName: report.subjectWorkerProfileId ? (nameOfWorker.get(report.subjectWorkerProfileId) ?? null) : null,
      sha256Hash: report.sha256Hash,
      pdfSha256: report.pdfSha256,
      csvSha256: report.csvSha256,
      pageCount: report.pageCount,
      errorCode: report.errorCode,
      generatedAt: report.generatedAt,
      finishedAt: report.finishedAt,
    }));
  }
}

/** "سجل-حضور-العامل-2026-10-13.pdf": the report's Arabic name and the (Asia/Jerusalem) day it was requested. */
export function downloadFileName(reportType: ReportType, generatedAt: Date, format: ReportFileFormat): string {
  const name = enumLabel("ReportType", reportType)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-");
  return `${name}-${toBusinessDay(generatedAt) ?? generatedAt.toISOString().slice(0, 10)}.${format}`;
}

/** The filters as echoed to clients: the internal scope a restricted requester's report carries is not one of them. */
function publicFilters(filters: ReportFilters): ReportFilters {
  const { scope: _scope, ...shown } = filters;
  return shown;
}
