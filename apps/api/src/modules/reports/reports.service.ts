import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { FilesService } from "../../common/files/files.service";
import { PayrollCalculationService } from "../payroll/payroll-calculation.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { renderWorkerAttendanceLedgerHtml, type ReportData, type ReportShiftRow } from "./report-template";
import type { GenerateWorkerLedgerDto } from "./dto/generate-report.dto";

const TEMPLATE_VERSION = "worker-attendance-ledger-v1";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly filesService: FilesService,
    private readonly payrollCalculation: PayrollCalculationService,
  ) {}

  async generateWorkerAttendanceLedger(
    organizationId: string,
    dto: GenerateWorkerLedgerDto,
    actor: AuthenticatedUser,
    correlationId: string,
  ) {
    const isOwner = actor.role === OrgRole.OWNER;
    const isSelf = actor.workerProfileId === dto.workerProfileId;
    const isManager = actor.role === OrgRole.FIELD_MANAGER;

    if (!isOwner && !isSelf && !isManager) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You cannot generate a report for another worker.");
    }
    const includesFinancials = isOwner || isSelf;

    const worker = await this.prisma.workerProfile.findFirst({
      where: { id: dto.workerProfileId, organizationId },
      include: { membership: { include: { user: true } } },
    });
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

    const entries = await this.prisma.timeEntry.findMany({
      where: { organizationId, workerProfileId: dto.workerProfileId, businessDate: { gte: dto.fromDate, lte: dto.toDate } },
      include: {
        shift: { include: { project: true, site: true } },
        clockEvents: true,
        dailySummary: true,
        corrections: true,
        approvals: true,
        forgottenStampInfractions: true,
        emergencyCallout: true,
      },
      orderBy: { businessDate: "asc" },
    });

    const actorIds = new Set<string>([actor.sub]);
    for (const e of entries) {
      for (const a of e.approvals) actorIds.add(a.actedBy);
      for (const c of e.corrections) actorIds.add(c.editedBy);
    }
    const actorUsers = await this.prisma.user.findMany({ where: { id: { in: Array.from(actorIds) } } });
    const actorNameById = new Map(actorUsers.map((u) => [u.id, u.fullLegalName]));

    let totalNetAgorot = 0;
    const rows: ReportShiftRow[] = [];

    for (const entry of entries) {
      const clockIn = entry.clockEvents.find((e) => e.eventType === "CLOCK_IN");
      const clockOut = entry.clockEvents.find((e) => e.eventType === "CLOCK_OUT");

      let financials: ReportShiftRow["financials"] = null;
      if (includesFinancials && entry.approvedRegularMinutes !== null) {
        const profile = await this.payrollCalculation.findEffectiveCompensationProfile(dto.workerProfileId, entry.businessDate);
        if (profile) {
          const comp = this.payrollCalculation.computeEntryCompensation(entry, profile);
          financials = { regularMinutes: comp.regularMinutes, overtimeMinutes: comp.overtimeMinutes, totalAgorot: comp.baseAgorot + comp.overtimeAgorot };
          totalNetAgorot += financials.totalAgorot;
        }
      }

      const forgottenStamp = entry.forgottenStampInfractions[0]
        ? { sequence: entry.forgottenStampInfractions[0].monthlySequenceNumber, deductionAgorot: entry.forgottenStampInfractions[0].deductionAgorot }
        : null;
      if (includesFinancials && forgottenStamp) totalNetAgorot -= forgottenStamp.deductionAgorot;

      rows.push({
        businessDate: entry.businessDate,
        shiftTitle: entry.shift.title,
        projectName: entry.shift.project?.name ?? null,
        siteName: entry.shift.site?.name ?? null,
        checkInMethod: entry.checkInMethod,
        rawClockIn: clockIn?.deviceTimestamp.toISOString() ?? null,
        validatedClockIn: entry.clockInAt?.toISOString() ?? null,
        rawClockOut: clockOut?.deviceTimestamp.toISOString() ?? null,
        validatedClockOut: entry.clockOutAt?.toISOString() ?? null,
        clockInGps: clockIn ? `${clockIn.latitude.toFixed(5)}, ${clockIn.longitude.toFixed(5)} (±${clockIn.accuracyMeters}m)` : null,
        clockOutGps: clockOut ? `${clockOut.latitude.toFixed(5)}, ${clockOut.longitude.toFixed(5)} (±${clockOut.accuracyMeters}m)` : null,
        locationValidationStatus: clockIn?.locationValidationStatus ?? null,
        isEmergency: entry.isEmergency,
        emergencyBreakdown: entry.emergencyCallout
          ? `Retroactive +${entry.emergencyCallout.retroactiveMinutes}min, return buffer +${entry.emergencyCallout.returnBufferMinutes ?? 0}min, total compensated ${entry.emergencyCallout.compensatedDurationMinutes ?? "—"}min`
          : null,
        status: entry.status,
        fullDayCredit: entry.fullDayCredit,
        corrections: entry.corrections.map((c) => ({
          field: c.field,
          reason: c.reason,
          note: c.note,
          editedBy: actorNameById.get(c.editedBy) ?? c.editedBy,
          editedAt: c.createdAt.toISOString(),
        })),
        summaryText: entry.dailySummary?.text ?? null,
        approvals: entry.approvals.map((a) => ({
          action: a.action,
          actedBy: actorNameById.get(a.actedBy) ?? a.actedBy,
          actedAt: a.createdAt.toISOString(),
        })),
        forgottenStamp,
        financials,
      });
    }

    const reportId = generateId();
    const generatedAt = new Date();

    const dataForHash = { reportId, organizationId, workerId: dto.workerProfileId, fromDate: dto.fromDate, toDate: dto.toDate, includesFinancials, rows };
    const dataHash = createHash("sha256").update(JSON.stringify(dataForHash)).digest("hex");

    const reportData: ReportData = {
      reportId,
      organizationName: organization.name,
      workerName: worker.membership.user.fullLegalName,
      workerId: worker.id,
      periodLabel: `${dto.fromDate} to ${dto.toDate}`,
      generatedAt: generatedAt.toISOString(),
      generatedByName: actorNameById.get(actor.sub) ?? actor.sub,
      includesFinancials,
      dataHash,
      rows,
      totalNetAgorot: includesFinancials ? totalNetAgorot : null,
    };

    const html = renderWorkerAttendanceLedgerHtml(reportData);
    const pdfBuffer = await this.renderPdf(html);

    const storageKey = `reports/${organizationId}/${reportId}.pdf`;
    await this.filesService.putObject(storageKey, pdfBuffer, "application/pdf");

    await this.prisma.generatedReport.create({
      data: {
        id: reportId,
        organizationId,
        reportType: "WORKER_ATTENDANCE_LEDGER",
        requestedByUserId: actor.sub,
        subjectWorkerProfileId: dto.workerProfileId,
        filtersJson: { fromDate: dto.fromDate, toDate: dto.toDate },
        includesFinancials,
        templateVersion: TEMPLATE_VERSION,
        sha256Hash: dataHash,
        storageKey,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "REPORT_GENERATED",
      entityType: "GeneratedReport",
      entityId: reportId,
      newValue: dataHash,
      correlationId,
    });

    const downloadUrl = await this.filesService.getSignedDownloadUrl(storageKey);
    return { reportId, sha256Hash: dataHash, includesFinancials, downloadUrl };
  }

  async getDownloadUrl(organizationId: string, reportId: string, actor: AuthenticatedUser) {
    const report = await this.prisma.generatedReport.findFirst({ where: { id: reportId, organizationId } });
    if (!report) throw new AppException(404, ErrorCodes.NOT_FOUND, "Report not found.");

    const isOwner = actor.role === OrgRole.OWNER;
    const isSelf = actor.workerProfileId !== null && actor.workerProfileId === report.subjectWorkerProfileId;
    const isRequester = report.requestedByUserId === actor.sub;
    if (!isOwner && !isSelf && !isRequester) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You cannot access this report.");
    }

    const downloadUrl = await this.filesService.getSignedDownloadUrl(report.storageKey);
    return { downloadUrl, sha256Hash: report.sha256Hash, generatedAt: report.generatedAt };
  }

  async listForOrganization(organizationId: string, actor: AuthenticatedUser) {
    const isOwner = actor.role === OrgRole.OWNER;
    return this.prisma.generatedReport.findMany({
      where: {
        organizationId,
        ...(isOwner ? {} : { OR: [{ requestedByUserId: actor.sub }, { subjectWorkerProfileId: actor.workerProfileId ?? "__none__" }] }),
      },
      orderBy: { generatedAt: "desc" },
      take: 100,
    });
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A4",
        margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#94a3b8;text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}
