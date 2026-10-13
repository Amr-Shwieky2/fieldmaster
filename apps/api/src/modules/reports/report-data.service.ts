import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "../../common/prisma/prisma.service";
import { PayrollCalculationService } from "../payroll/payroll-calculation.service";
import { AttendanceCostService } from "../payroll/attendance-cost.service";
import { PayrollVersionsService } from "../payroll/payroll-versions.service";
import { AttendanceRecordsService } from "../attendance/attendance-records.service";
import type { ReportDataDeps, ReportDefinition, ReportFilters, ReportLoadContext, ReportNames } from "./report.types";

/**
 * Reads a report's source data through its definition's loader, and the
 * names its header shows. Loaders only read: the evidence, the pay of an
 * entry and a payroll version come from the services that already define
 * them for the API's screens.
 */
@Injectable()
export class ReportDataService {
  private resolved: ReportDataDeps | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollCalculation: PayrollCalculationService,
    private readonly attendanceCost: AttendanceCostService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * AttendanceModule and PayrollModule do not export the attendance evidence
   * (AttendanceRecordsService) and the payroll version read
   * (PayrollVersionsService). They are looked up, never provided a second
   * time: the reports read exactly what the attendance and payroll screens
   * read, through the same instances.
   */
  private get deps(): ReportDataDeps {
    this.resolved ??= {
      prisma: this.prisma,
      payrollCalculation: this.payrollCalculation,
      attendanceCost: this.attendanceCost,
      attendanceRecords: this.moduleRef.get(AttendanceRecordsService, { strict: false }),
      payrollVersions: this.moduleRef.get(PayrollVersionsService, { strict: false }),
    };
    return this.resolved;
  }

  load(definition: ReportDefinition<unknown>, context: ReportLoadContext): Promise<unknown> {
    return definition.load(this.deps, context);
  }

  async names(organizationId: string, filters: ReportFilters): Promise<ReportNames> {
    const [organization, worker, project, site] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
      filters.workerProfileId
        ? this.prisma.workerProfile.findFirst({
            where: { id: filters.workerProfileId, organizationId },
            select: { membership: { select: { user: { select: { fullLegalName: true } } } } },
          })
        : null,
      filters.projectId ? this.prisma.project.findFirst({ where: { id: filters.projectId, organizationId }, select: { name: true } }) : null,
      filters.siteId ? this.prisma.site.findFirst({ where: { id: filters.siteId, organizationId }, select: { name: true } }) : null,
    ]);
    return {
      organizationName: organization.name,
      workerName: worker?.membership.user.fullLegalName ?? null,
      projectName: project?.name ?? null,
      siteName: site?.name ?? null,
    };
  }
}
