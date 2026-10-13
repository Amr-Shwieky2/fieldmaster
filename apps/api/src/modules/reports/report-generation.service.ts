import { Injectable, Logger } from "@nestjs/common";
import { ReportStatus, type ReportType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { FilesService } from "../../common/files/files.service";
import { ReportDataService } from "./report-data.service";
import { ReportPdfRenderer } from "./render/pdf-renderer";
import { reportDocument } from "./render/html";
import { enumLabel } from "./render/messages";
import { reportDefinition } from "./report-definitions";
import { canonicalJson, sha256Hex } from "./report-hash";
import type { ReportDocumentMeta, ReportFilters } from "./report.types";

/** A QUEUED or RUNNING report with no news for this long is marked FAILED (its job was lost). */
export const STALE_REPORT_MS = 15 * 60_000;

/** The code stored on a failed report: an unexpected error (`errors.INTERNAL_ERROR` in the clients). */
export const REPORT_FAILURE_CODE = "INTERNAL_ERROR";

const ACTIVE_STATES: ReportStatus[] = [ReportStatus.QUEUED, ReportStatus.RUNNING];

/** Where a report's files are stored (private; only reachable through signed URLs or read back by the API). */
export function reportStorageKeys(organizationId: string, reportId: string) {
  return { pdf: `reports/${organizationId}/${reportId}.pdf`, csv: `reports/${organizationId}/${reportId}.csv` };
}

/**
 * The background job of a report (Step 8): QUEUED -> RUNNING -> READY or
 * FAILED, never left RUNNING. Data first, then its SHA-256 (printed in every
 * footer), then the PDF (Chromium) and the CSV, then both files are stored
 * and only then referenced, together with the SHA-256 of their bytes, in
 * one update that marks the report READY. Any error marks it FAILED with a
 * code and removes whatever was uploaded, so a failed report never points
 * at half of its files.
 */
@Injectable()
export class ReportGenerationService {
  private readonly logger = new Logger(ReportGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly files: FilesService,
    private readonly data: ReportDataService,
    private readonly renderer: ReportPdfRenderer,
  ) {}

  async processReport(reportId: string, onProgress?: (progress: number) => Promise<void> | void): Promise<void> {
    const report = await this.prisma.generatedReport.findUnique({ where: { id: reportId } });
    if (!report) return;

    // Only a QUEUED report starts. Meeting a RUNNING one again means its first attempt died
    // (BullMQ delivers a stalled job once more): it is failed rather than rendered twice.
    const startedAt = new Date();
    const started = await this.prisma.generatedReport.updateMany({
      where: { id: reportId, status: ReportStatus.QUEUED },
      data: { status: ReportStatus.RUNNING, startedAt, progress: 5 },
    });
    if (started.count === 0) {
      if (report.status === ReportStatus.RUNNING) await this.failReport(reportId, "The generation stopped without finishing.");
      return;
    }
    await onProgress?.(5);

    const keys = reportStorageKeys(report.organizationId, report.id);
    let uploadStarted = false;
    try {
      const reportType = report.reportType as ReportType;
      const filters = report.filtersJson as ReportFilters;
      const definition = reportDefinition(reportType, report.includesFinancials);
      const [data, names, requester] = await Promise.all([
        this.data.load(definition, { organizationId: report.organizationId, filters }),
        this.data.names(report.organizationId, filters),
        this.prisma.user.findUnique({ where: { id: report.requestedByUserId }, select: { fullLegalName: true } }),
      ]);
      await this.setProgress(reportId, 10, onProgress);

      // The hash covers the source data and what it was selected by, never the rendering.
      const dataHash = sha256Hex(
        canonicalJson({
          reportId,
          reportType,
          templateVersion: report.templateVersion,
          organizationId: report.organizationId,
          includesFinancials: report.includesFinancials,
          filters,
          names,
          data,
        }),
      );
      const meta: ReportDocumentMeta = {
        reportId,
        reportType,
        title: enumLabel("ReportType", reportType),
        financial: report.includesFinancials,
        filters,
        names,
        generatedAt: startedAt,
        generatedByName: requester?.fullLegalName ?? null,
        dataHash,
      };

      const { pdf, pageCount } = await this.renderer.render(
        reportDocument({ title: meta.title, orientation: definition.orientation, reportId, dataHash, body: definition.body(data, meta) }),
      );
      await this.setProgress(reportId, 60, onProgress);
      const csv = Buffer.from(definition.csv(data, meta), "utf8");
      await this.setProgress(reportId, 75, onProgress);

      uploadStarted = true;
      await this.files.putObject(keys.pdf, pdf, "application/pdf");
      await this.files.putObject(keys.csv, csv, "text/csv; charset=utf-8");
      await this.setProgress(reportId, 90, onProgress);

      const pdfSha256 = sha256Hex(pdf);
      const csvSha256 = sha256Hex(csv);
      // READY, the files and their hashes in one update, audited in the same transaction:
      // whoever sees the report READY also finds its REPORT_GENERATED event.
      const finished = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.generatedReport.updateMany({
          where: { id: reportId, status: ReportStatus.RUNNING },
          data: {
            status: ReportStatus.READY,
            progress: 100,
            finishedAt: new Date(),
            storageKey: keys.pdf,
            csvStorageKey: keys.csv,
            sha256Hash: dataHash,
            pdfSha256,
            csvSha256,
            pageCount,
            errorCode: null,
            errorMessage: null,
          },
        });
        if (updated.count === 0) return false;
        await this.auditService.record(
          {
            organizationId: report.organizationId,
            actorUserId: report.requestedByUserId,
            action: "REPORT_GENERATED",
            entityType: "GeneratedReport",
            entityId: reportId,
            newValue: dataHash,
            note: `${reportType} (${report.includesFinancials ? "financial" : "operational"}): PDF ${pdfSha256}, ${pageCount} page(s); CSV ${csvSha256}`,
            correlationId: reportId,
          },
          tx,
        );
        return true;
      });
      if (!finished) {
        // Marked FAILED meanwhile (taken as stale): its row never referenced these files.
        await this.removeFiles(keys);
        return;
      }
      await onProgress?.(100);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Report ${reportId} failed: ${error instanceof Error ? (error.stack ?? message) : message}`);
      if (uploadStarted) await this.removeFiles(keys);
      await this.failReport(reportId, message);
    }
  }

  /** Marks a QUEUED or RUNNING report FAILED, audited in the same transaction. False when it had already finished. */
  async failReport(reportId: string, message: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const failed = await tx.generatedReport.updateMany({
        where: { id: reportId, status: { in: ACTIVE_STATES } },
        data: { status: ReportStatus.FAILED, errorCode: REPORT_FAILURE_CODE, errorMessage: message.slice(0, 500), finishedAt: new Date() },
      });
      if (failed.count === 0) return false;
      const report = await tx.generatedReport.findUniqueOrThrow({
        where: { id: reportId },
        select: { organizationId: true, requestedByUserId: true, reportType: true },
      });
      await this.auditService.record(
        {
          organizationId: report.organizationId,
          actorUserId: report.requestedByUserId,
          action: "REPORT_GENERATION_FAILED",
          entityType: "GeneratedReport",
          entityId: reportId,
          note: `${report.reportType}: ${message.slice(0, 500)}`,
          correlationId: reportId,
        },
        tx,
      );
      return true;
    });
  }

  /** Reports of an organization whose job was lost (no news for 15 minutes) become FAILED, so none stays QUEUED or RUNNING forever. */
  async failStaleReports(organizationId: string): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_REPORT_MS);
    const stale = await this.prisma.generatedReport.findMany({
      where: {
        organizationId,
        OR: [
          { status: ReportStatus.QUEUED, generatedAt: { lt: cutoff } },
          { status: ReportStatus.RUNNING, startedAt: { lt: cutoff } },
        ],
      },
      select: { id: true },
    });
    for (const report of stale) await this.failReport(report.id, "Stopped without finishing.");
  }

  private async setProgress(reportId: string, progress: number, onProgress?: (progress: number) => Promise<void> | void) {
    await this.prisma.generatedReport.updateMany({ where: { id: reportId, status: ReportStatus.RUNNING }, data: { progress } });
    await onProgress?.(progress);
  }

  private async removeFiles(keys: { pdf: string; csv: string }) {
    for (const key of [keys.pdf, keys.csv]) {
      await this.files.deleteObject(key).catch((error: unknown) => {
        this.logger.warn(`Could not remove ${key}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
}
