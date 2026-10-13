import type { PayrollTotalsDto, PayrollWorkerLineDto } from "../../payroll/payroll.types";
import type { ReportDataDeps, ReportLoadContext } from "../report.types";

/**
 * The payroll report (Owner only): one payroll version exactly as it was
 * stored -- the calculation's snapshot (schema 2), or the items of a version
 * calculated before Step 7 -- read through `PayrollVersionsService.detail`,
 * the same read the payroll page uses. Nothing is recalculated. A working
 * version's live extras (adjustments added since, "changed since
 * calculation") are left out: the report shows what the version holds.
 */

export interface PayrollAdjustmentRow {
  workerName: string;
  type: string;
  source: string;
  amountAgorot: number;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface PayrollReportData {
  yearMonth: string;
  version: number;
  status: string;
  isCurrent: boolean;
  legacy: boolean;
  previousVersion: number | null;
  createdAt: string;
  createdByName: string | null;
  calculatedAt: string | null;
  calculatedByName: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  /** False: this version has not been calculated yet (nothing stored). */
  calculated: boolean;
  workers: PayrollWorkerLineDto[];
  totals: PayrollTotalsDto | null;
  adjustments: PayrollAdjustmentRow[];
  workersWithoutCompensation: { fullLegalName: string; entries: number; businessDates: string[] }[];
  pending: { entries: number; byWorker: { fullLegalName: string; entries: number }[] } | null;
  /** A version from before Step 7 that kept only each worker's net. */
  legacyNetByWorker: { fullLegalName: string; netPayableAgorot: number }[] | null;
}

const iso = (value: Date | string | null | undefined): string | null => (value === null || value === undefined ? null : new Date(value).toISOString());

export async function loadPayroll(deps: ReportDataDeps, context: ReportLoadContext): Promise<PayrollReportData> {
  const yearMonth = context.filters.yearMonth as string;
  const detail = await deps.payrollVersions.detail(context.organizationId, yearMonth, context.filters.version);
  return {
    yearMonth: detail.yearMonth,
    version: detail.version,
    status: detail.status,
    isCurrent: detail.isCurrent,
    legacy: detail.legacy,
    previousVersion: detail.previousVersion,
    createdAt: detail.createdAt.toISOString(),
    createdByName: detail.createdByName,
    calculatedAt: iso(detail.calculatedAt),
    calculatedByName: detail.calculatedByName,
    finalizedAt: iso(detail.finalizedAt),
    finalizedByName: detail.finalizedByName,
    reopenedAt: iso(detail.reopenedAt),
    reopenedByName: detail.reopenedByName,
    reopenReason: detail.reopenReason,
    calculated: detail.totals !== null || detail.legacyNetByWorker !== null,
    workers: detail.workers,
    totals: detail.totals,
    adjustments: detail.adjustments.map((adjustment) => ({
      workerName: adjustment.fullLegalName,
      type: adjustment.type,
      source: adjustment.source,
      amountAgorot: adjustment.amountAgorot,
      reason: adjustment.reason,
      createdByName: adjustment.createdByName,
      createdAt: new Date(adjustment.createdAt).toISOString(),
    })),
    workersWithoutCompensation: detail.warnings.workersWithoutCompensation.map((worker) => ({
      fullLegalName: worker.fullLegalName,
      entries: worker.entries,
      businessDates: worker.businessDates,
    })),
    pending: detail.pending
      ? {
          entries: detail.pending.entries,
          byWorker: detail.pending.byWorker.map((worker) => ({ fullLegalName: worker.fullLegalName, entries: worker.entries })),
        }
      : null,
    legacyNetByWorker: detail.legacyNetByWorker?.map((row) => ({ fullLegalName: row.fullLegalName, netPayableAgorot: row.netPayableAgorot })) ?? null,
  };
}
