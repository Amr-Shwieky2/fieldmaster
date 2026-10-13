import { Injectable } from "@nestjs/common";
import type { PayrollCalculationSnapshot } from "@prisma/client";
import { OVERTIME_SPIKE_FACTOR, OVERTIME_SPIKE_MIN_MINUTES, PayrollAdjustmentType, PayrollFigureSource, PayrollPeriodStatus } from "@fieldmaster/shared-types";
import { calculatePayrollMonth, findOvertimeSpikes, toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AttendanceCostService, CostBasis } from "./attendance-cost.service";
import { PayrollInputsService, PENDING_ENTRY_STATUSES } from "./payroll-inputs.service";
import {
  buildPayrollSnapshotResult,
  PAYROLL_SNAPSHOT_SCHEMA_VERSION,
  type PayrollSnapshotInputs,
  type PayrollSnapshotResult,
  type PayrollSnapshotTotals,
} from "./payroll-snapshot";

export function previousYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** Every business date of the month up to today (all of it for a past month, none for a future one). */
function monthDays(yearMonth: string, today: string): string[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentMonth = today.slice(0, 7);
  const lastDay = yearMonth < currentMonth ? daysInMonth : yearMonth === currentMonth ? Number(today.slice(8, 10)) : 0;
  return Array.from({ length: lastDay }, (_, index) => `${yearMonth}-${String(index + 1).padStart(2, "0")}`);
}

interface MonthFigures {
  source: PayrollFigureSource;
  finalizedVersion: number | null;
  inputs: PayrollSnapshotInputs | null;
  result: PayrollSnapshotResult;
  totals: PayrollSnapshotTotals;
}

/**
 * The Owner's financial dashboard (spec section 23.5, Step 7). Every route
 * using it requires Permission.VIEW_FINANCIAL_DASHBOARD, which Field Managers
 * never hold. A month whose latest version is FINALIZED is shown from that
 * version's stored calculation; any other month is calculated live from its
 * approved attendance and adjustments, with the same engine as payroll.
 */
@Injectable()
export class FinancialDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inputs: PayrollInputsService,
    private readonly costs: AttendanceCostService,
  ) {}

  async getDashboard(organizationId: string, yearMonth: string) {
    const previousMonth = previousYearMonth(yearMonth);
    const [current, previous, pendingApproval] = await Promise.all([
      this.monthFigures(organizationId, yearMonth),
      this.monthFigures(organizationId, previousMonth),
      this.pendingApproval(organizationId, yearMonth),
    ]);
    const { result, totals, inputs } = current;
    const entryById = new Map((inputs?.entries ?? []).map((entry) => [entry.timeEntryId, entry]));
    const nameOf = new Map(result.workers.map((worker) => [worker.workerProfileId, worker.fullLegalName]));
    const paid = result.entries.filter((line) => line.compensationProfileId !== null);

    // Daily labor cost and overtime.
    const days = new Map(
      monthDays(yearMonth, toBusinessDate(new Date())).map((date) => [
        date,
        { date, laborCostAgorot: 0, overtimeAgorot: 0, overtimeMinutes: 0, approvedShifts: 0 },
      ]),
    );
    for (const line of paid) {
      const date = entryById.get(line.timeEntryId)?.businessDate;
      if (!date) continue;
      const day = days.get(date) ?? { date, laborCostAgorot: 0, overtimeAgorot: 0, overtimeMinutes: 0, approvedShifts: 0 };
      day.laborCostAgorot += line.totalAgorot;
      day.overtimeAgorot += line.overtimeAgorot;
      day.overtimeMinutes += line.overtimeMinutes;
      day.approvedShifts += 1;
      days.set(date, day);
    }
    const dayList = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const spikes = findOvertimeSpikes(dayList.map((day) => ({ date: day.date, overtimeMinutes: day.overtimeMinutes, worked: day.approvedShifts > 0 })));
    const spikeDates = new Set(spikes.spikeDates);

    const adjustments = inputs?.adjustments ?? [];
    const penalties = adjustments.filter((adjustment) => adjustment.type === PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY);
    const reversals = adjustments.filter((adjustment) => adjustment.type === PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL);
    const emergencies = paid.filter((line) => entryById.get(line.timeEntryId)?.isEmergency);

    const costByWorker = result.workers
      .map((worker) => ({
        workerProfileId: worker.workerProfileId,
        fullLegalName: worker.fullLegalName,
        approvedShifts: worker.approvedShifts,
        overtimeMinutes: worker.overtimeMinutes,
        laborCostAgorot: worker.grossBaseAgorot + worker.overtimeAgorot,
        netPayableAgorot: worker.netPayableAgorot,
      }))
      .sort((a, b) => b.netPayableAgorot - a.netPayableAgorot || a.fullLegalName.localeCompare(b.fullLegalName, "ar"));

    return {
      yearMonth,
      source: current.source,
      finalizedVersion: current.finalizedVersion,
      netPayableAgorot: totals.netPayableAgorot,
      laborCostAgorot: totals.grossBaseAgorot + totals.overtimeAgorot,
      previousMonth: {
        yearMonth: previousMonth,
        source: previous.source,
        netPayableAgorot: previous.totals.netPayableAgorot,
        laborCostAgorot: previous.totals.grossBaseAgorot + previous.totals.overtimeAgorot,
      },
      costByProject: result.projects.map((group) => ({
        id: group.id,
        name: group.name,
        approvedShifts: group.approvedShifts,
        laborCostAgorot: group.totalAgorot,
        overtimeAgorot: group.overtimeAgorot,
      })),
      costBySite: result.sites.map((group) => ({
        id: group.id,
        name: group.name,
        projectName: group.projectName ?? null,
        approvedShifts: group.approvedShifts,
        laborCostAgorot: group.totalAgorot,
        overtimeAgorot: group.overtimeAgorot,
      })),
      costByWorker,
      topEarners: costByWorker.slice(0, 5),
      overtime: {
        totalAgorot: totals.overtimeAgorot,
        totalMinutes: totals.overtimeMinutes,
        averageDailyMinutes: spikes.averageDailyMinutes,
        spikeFactor: OVERTIME_SPIKE_FACTOR,
        spikeMinimumMinutes: OVERTIME_SPIKE_MIN_MINUTES,
        spikes: dayList
          .filter((day) => spikeDates.has(day.date))
          .map((day) => {
            const byWorker = new Map<string, number>();
            for (const line of paid) {
              if (entryById.get(line.timeEntryId)?.businessDate !== day.date || line.overtimeMinutes === 0) continue;
              byWorker.set(line.workerProfileId, (byWorker.get(line.workerProfileId) ?? 0) + line.overtimeMinutes);
            }
            return {
              date: day.date,
              overtimeMinutes: day.overtimeMinutes,
              overtimeAgorot: day.overtimeAgorot,
              thresholdMinutes: spikes.thresholdMinutes,
              workers: [...byWorker.entries()]
                .map(([workerProfileId, overtimeMinutes]) => ({ workerProfileId, fullLegalName: nameOf.get(workerProfileId) ?? "", overtimeMinutes }))
                .sort((a, b) => b.overtimeMinutes - a.overtimeMinutes),
            };
          }),
      },
      forgottenStamps: {
        penalties: penalties.length,
        penaltiesAgorot: penalties.reduce((sum, adjustment) => sum - adjustment.amountAgorot, 0),
        reversals: reversals.length,
        reversalsAgorot: reversals.reduce((sum, adjustment) => sum + adjustment.amountAgorot, 0),
        netDeductionsAgorot: totals.forgottenStampPenaltiesAgorot - totals.reversalsAgorot,
      },
      emergencies: {
        callouts: emergencies.length,
        compensatedMinutes: emergencies.reduce((sum, line) => {
          const entry = entryById.get(line.timeEntryId);
          return sum + (entry?.approvedRegularMinutes ?? 0) + (entry?.approvedOvertimeMinutes ?? 0);
        }, 0),
        costAgorot: emergencies.reduce((sum, line) => sum + line.totalAgorot, 0),
      },
      dailyTrend: dayList.map((day) => ({
        date: day.date,
        laborCostAgorot: day.laborCostAgorot,
        overtimeAgorot: day.overtimeAgorot,
        overtimeMinutes: day.overtimeMinutes,
        isOvertimeSpike: spikeDates.has(day.date),
      })),
      pendingApproval,
      workersWithoutCompensation: result.warnings.workersWithoutCompensation.map((worker) => ({
        workerProfileId: worker.workerProfileId,
        fullLegalName: worker.fullLegalName,
        entries: worker.entries,
      })),
    };
  }

  /** The month as payroll sees it: its finalized version's stored calculation, or a live one. */
  private async monthFigures(organizationId: string, yearMonth: string): Promise<MonthFigures> {
    const latest = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth },
      orderBy: { version: "desc" },
      include: { currentSnapshot: true },
    });
    if (latest?.status === PayrollPeriodStatus.FINALIZED) {
      const stored = this.stored(latest.currentSnapshot);
      if (stored) return { source: PayrollFigureSource.FINALIZED, finalizedVersion: latest.version, ...stored };
      return { source: PayrollFigureSource.FINALIZED, finalizedVersion: latest.version, ...(await this.legacyFigures(latest.id)) };
    }
    const { inputs } = await this.inputs.load(organizationId, yearMonth);
    const month = calculatePayrollMonth({ entries: inputs.entries, profiles: inputs.compensationProfiles, adjustments: inputs.adjustments });
    return { source: PayrollFigureSource.LIVE, finalizedVersion: null, inputs, ...buildPayrollSnapshotResult(inputs, month.workers, month.entries) };
  }

  private stored(snapshot: PayrollCalculationSnapshot | null) {
    if (!snapshot || snapshot.schemaVersion !== PAYROLL_SNAPSHOT_SCHEMA_VERSION || !snapshot.totalsJson) return null;
    return {
      inputs: snapshot.inputsJson as unknown as PayrollSnapshotInputs,
      result: snapshot.resultJson as unknown as PayrollSnapshotResult,
      totals: snapshot.totalsJson as unknown as PayrollSnapshotTotals,
    };
  }

  /** A version finalized before Step 7: only its items were kept (no entries, so no daily, project or site figures). */
  private async legacyFigures(payrollPeriodId: string): Promise<Pick<MonthFigures, "inputs" | "result" | "totals">> {
    const items = await this.prisma.payrollItem.findMany({
      where: { payrollPeriodId },
      include: { worker: { select: { membership: { select: { user: { select: { fullLegalName: true } } } } } } },
    });
    const workers = items.map((item) => ({
      workerProfileId: item.workerProfileId,
      fullLegalName: item.worker.membership.user.fullLegalName,
      approvedShifts: item.approvedShifts ?? 0,
      standardDaysCredited: item.standardDaysCredited,
      regularMinutes: item.regularMinutes,
      overtimeMinutes: item.overtimeMinutes,
      emergencyRetroactiveMinutes: item.emergencyRetroactiveMinutes,
      emergencyReturnMinutes: item.emergencyReturnMinutes,
      grossBaseAgorot: item.grossBaseAgorot,
      overtimeAgorot: item.overtimeAgorot,
      positiveAdjustmentsAgorot: item.positiveAdjustmentsAgorot,
      forgottenStampPenaltiesAgorot: item.forgottenStampPenaltiesAgorot,
      reversalsAgorot: item.reversalsAgorot,
      otherDeductionsAgorot: item.otherDeductionsAgorot,
      deductionsAgorot: item.deductionsAgorot,
      netPayableAgorot: item.netPayableAgorot,
      entriesWithoutCompensation: 0,
      pendingEntries: 0,
    }));
    const sum = (pick: (worker: (typeof workers)[number]) => number) => workers.reduce((total, worker) => total + pick(worker), 0);
    return {
      inputs: null,
      result: { schemaVersion: PAYROLL_SNAPSHOT_SCHEMA_VERSION, workers, entries: [], projects: [], sites: [], warnings: { workersWithoutCompensation: [] } },
      totals: {
        workers: workers.length,
        approvedShifts: sum((w) => w.approvedShifts),
        standardDaysCredited: sum((w) => w.standardDaysCredited),
        regularMinutes: sum((w) => w.regularMinutes),
        overtimeMinutes: sum((w) => w.overtimeMinutes),
        emergencyRetroactiveMinutes: sum((w) => w.emergencyRetroactiveMinutes),
        emergencyReturnMinutes: sum((w) => w.emergencyReturnMinutes),
        grossBaseAgorot: sum((w) => w.grossBaseAgorot),
        overtimeAgorot: sum((w) => w.overtimeAgorot),
        positiveAdjustmentsAgorot: sum((w) => w.positiveAdjustmentsAgorot),
        forgottenStampPenaltiesAgorot: sum((w) => w.forgottenStampPenaltiesAgorot),
        reversalsAgorot: sum((w) => w.reversalsAgorot),
        otherDeductionsAgorot: sum((w) => w.otherDeductionsAgorot),
        deductionsAgorot: sum((w) => w.deductionsAgorot),
        netPayableAgorot: sum((w) => w.netPayableAgorot),
      },
    };
  }

  /**
   * Always live: the month's entries still waiting for approval, priced as
   * approval would split them (the attendance screens' own estimate).
   */
  private async pendingApproval(organizationId: string, yearMonth: string) {
    const entries = await this.prisma.timeEntry.findMany({
      where: { organizationId, status: { in: PENDING_ENTRY_STATUSES }, businessDate: { startsWith: `${yearMonth}-` } },
      select: {
        id: true,
        workerProfileId: true,
        businessDate: true,
        status: true,
        clockOutAt: true,
        rawDurationMinutes: true,
        unpaidBreakMinutes: true,
        fullDayCredit: true,
        approvedRegularMinutes: true,
        approvedOvertimeMinutes: true,
      },
    });
    const estimates = await Promise.all(entries.map((entry) => this.costs.estimateEntry(entry)));
    return {
      entries: entries.length,
      exposureAgorot: estimates.reduce((sum, estimate) => sum + (estimate.basis === CostBasis.ESTIMATED ? (estimate.estimatedCostAgorot ?? 0) : 0), 0),
      entriesWithoutCompensation: estimates.filter((estimate) => estimate.basis === CostBasis.NO_COMPENSATION_PROFILE).length,
    };
  }
}
