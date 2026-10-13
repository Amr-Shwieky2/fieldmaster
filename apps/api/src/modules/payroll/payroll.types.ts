/**
 * Response shapes of the payroll routes (Step 7). They mirror the Payroll
 * section of `packages/api-client/src/types.ts`, which the clients use.
 * Every key holding money ends in "Agorot", so the financial leak scanner
 * catches it on any route that is not Owner-only.
 */

export interface PayrollCalculationRunDto {
  id: string;
  yearMonth: string;
  version: number;
  state: string;
  progress: number;
  processedWorkers: number;
  totalWorkers: number;
  requestedAt: Date;
  requestedByName: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorCode: string | null;
}

export interface PayrollWorkerLineDto {
  workerProfileId: string;
  fullLegalName: string;
  approvedShifts: number | null;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  positiveAdjustmentsAgorot: number;
  forgottenStampPenaltiesAgorot: number;
  reversalsAgorot: number;
  otherDeductionsAgorot: number;
  netPayableAgorot: number;
  pendingEntries: number | null;
  entriesWithoutCompensation: number | null;
}

export interface PayrollTotalsDto {
  workers: number;
  approvedShifts: number | null;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  positiveAdjustmentsAgorot: number;
  forgottenStampPenaltiesAgorot: number;
  reversalsAgorot: number;
  otherDeductionsAgorot: number;
  netPayableAgorot: number;
}

export interface PayrollCostGroupDto {
  id: string | null;
  name: string | null;
  projectName?: string | null;
  approvedShifts: number;
  workers: number;
  regularMinutes: number;
  overtimeMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  totalAgorot: number;
}

export interface PayrollAdjustmentLineDto {
  id: string;
  workerProfileId: string;
  fullLegalName: string;
  type: string;
  source: string;
  amountAgorot: number;
  reason: string | null;
  createdAt: Date | string;
  createdByName: string | null;
  relatedInfractionId: string | null;
  timeEntryId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
}

export interface PayrollVersionDetailDto {
  id: string;
  yearMonth: string;
  version: number;
  status: string;
  isCurrent: boolean;
  legacy: boolean;
  createdAt: Date;
  createdByName: string | null;
  reopenedAt: Date | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  previousVersion: number | null;
  calculatedAt: Date | null;
  calculatedByName: string | null;
  finalizedAt: Date | null;
  finalizedByName: string | null;
  calculation: PayrollCalculationRunDto | null;
  changedSinceCalculation: boolean;
  allowedActions: { calculate: boolean; finalize: boolean; reopen: boolean; addAdjustment: boolean };
  totals: PayrollTotalsDto | null;
  workers: PayrollWorkerLineDto[];
  projects: PayrollCostGroupDto[] | null;
  sites: PayrollCostGroupDto[] | null;
  adjustments: PayrollAdjustmentLineDto[];
  adjustmentsNotIncluded: PayrollAdjustmentLineDto[];
  warnings: { workersWithoutCompensation: { workerProfileId: string; fullLegalName: string; entries: number; businessDates: string[] }[] };
  pending: { entries: number; byWorker: { workerProfileId: string; fullLegalName: string; entries: number }[] } | null;
  legacyNetByWorker: { workerProfileId: string; fullLegalName: string; netPayableAgorot: number }[] | null;
}
