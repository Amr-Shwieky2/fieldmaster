import { Injectable } from "@nestjs/common";
import { STANDARD_DAY_MINUTES, TimeEntryStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { PayrollCalculationService } from "./payroll-calculation.service";

function previousYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/**
 * Owner-only aggregate view (spec section 23.5). Every endpoint here is
 * gated by Permission.VIEW_FINANCIAL_DASHBOARD, which Field Managers never
 * hold -- see permissions.ts and the financial-isolation tests.
 */
@Injectable()
export class FinancialDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollCalculation: PayrollCalculationService,
  ) {}

  async getDashboard(organizationId: string, yearMonth: string) {
    const [currentTotal, previousTotal, overtimeTotal, forgottenStampDeductions, costByProject, pendingExposure] = await Promise.all([
      this.periodTotal(organizationId, yearMonth),
      this.periodTotal(organizationId, previousYearMonth(yearMonth)),
      this.overtimeTotal(organizationId, yearMonth),
      this.forgottenStampDeductions(organizationId, yearMonth),
      this.costByProject(organizationId, yearMonth),
      this.pendingApprovalExposure(organizationId, yearMonth),
    ]);

    return {
      yearMonth,
      totalCurrentMonthPayrollAgorot: currentTotal,
      totalPreviousMonthPayrollAgorot: previousTotal,
      overtimeTotalAgorot: overtimeTotal,
      forgottenStampDeductionsAgorot: forgottenStampDeductions,
      costByProject,
      pendingApprovalFinancialExposureAgorot: pendingExposure,
    };
  }

  private async periodTotal(organizationId: string, yearMonth: string): Promise<number> {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } });
    if (!period) return 0;
    const agg = await this.prisma.payrollItem.aggregate({ where: { payrollPeriodId: period.id }, _sum: { netPayableAgorot: true } });
    return agg._sum.netPayableAgorot ?? 0;
  }

  private async overtimeTotal(organizationId: string, yearMonth: string): Promise<number> {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } });
    if (!period) return 0;
    const agg = await this.prisma.payrollItem.aggregate({ where: { payrollPeriodId: period.id }, _sum: { overtimeAgorot: true } });
    return agg._sum.overtimeAgorot ?? 0;
  }

  private async forgottenStampDeductions(organizationId: string, yearMonth: string): Promise<number> {
    const adjustments = await this.prisma.payrollAdjustment.findMany({
      where: { organizationId, businessMonth: yearMonth, type: "FORGOTTEN_STAMP_PENALTY" },
    });
    return adjustments.reduce((sum, a) => sum - a.amountAgorot, 0);
  }

  private async costByProject(organizationId: string, yearMonth: string): Promise<Array<{ projectId: string | null; projectName: string; totalAgorot: number }>> {
    const entries = await this.prisma.timeEntry.findMany({
      where: { organizationId, status: TimeEntryStatus.APPROVED, businessDate: { startsWith: yearMonth } },
      include: { shift: { include: { project: true } } },
    });

    const totals = new Map<string, { projectName: string; totalAgorot: number }>();
    for (const entry of entries) {
      const profile = await this.payrollCalculation.findEffectiveCompensationProfile(entry.workerProfileId, entry.businessDate);
      if (!profile) continue;
      const comp = this.payrollCalculation.computeEntryCompensation(entry, profile);
      const key = entry.shift.projectId ?? "unassigned";
      const projectName = entry.shift.project?.name ?? "Unassigned";
      const existing = totals.get(key) ?? { projectName, totalAgorot: 0 };
      existing.totalAgorot += comp.baseAgorot + comp.overtimeAgorot;
      totals.set(key, existing);
    }

    return Array.from(totals.entries()).map(([projectId, v]) => ({
      projectId: projectId === "unassigned" ? null : projectId,
      projectName: v.projectName,
      totalAgorot: v.totalAgorot,
    }));
  }

  private async pendingApprovalExposure(organizationId: string, yearMonth: string): Promise<number> {
    const entries = await this.prisma.timeEntry.findMany({
      where: { organizationId, status: TimeEntryStatus.PENDING_APPROVAL, businessDate: { startsWith: yearMonth } },
    });

    let total = 0;
    for (const entry of entries) {
      const profile = await this.payrollCalculation.findEffectiveCompensationProfile(entry.workerProfileId, entry.businessDate);
      if (!profile || entry.rawDurationMinutes === null) continue;
      const netMinutes = Math.max(0, entry.rawDurationMinutes - entry.unpaidBreakMinutes);
      const approvedRegular = Math.min(netMinutes, STANDARD_DAY_MINUTES);
      const approvedOvertime = Math.max(0, netMinutes - STANDARD_DAY_MINUTES);
      const comp = this.payrollCalculation.computeEntryCompensation(
        { ...entry, approvedRegularMinutes: approvedRegular, approvedOvertimeMinutes: approvedOvertime },
        profile,
      );
      total += comp.baseAgorot + comp.overtimeAgorot;
    }
    return total;
  }
}
