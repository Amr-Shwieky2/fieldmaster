import { reportShiftScope } from "../report-scope";
import type { Prisma } from "@prisma/client";
import { PayrollAdjustmentType } from "@fieldmaster/shared-types";
import type { ReportDataDeps, ReportLoadContext } from "../report.types";

/**
 * The forgotten-stamp report: each infraction per worker (its sequence in
 * the month, the day it corrected, the correction, who made it, whether its
 * deduction was reversed). A period selects infractions by the date of the
 * corrected entry; a month selects them by the month they count in (the
 * payroll month of their deduction).
 *
 * The operational version (Field Manager) never reads the deduction: counts
 * and sequence numbers only. The financial version (Owner) adds what each
 * infraction deducted and what its reversal gave back, from the payroll
 * adjustments.
 */

export interface StampRow {
  infractionId: string;
  businessMonth: string;
  sequence: number;
  entryBusinessDate: string;
  correctedField: string;
  correctionReason: string;
  correctionNote: string | null;
  correctedByName: string | null;
  correctedAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

export interface StampWorker {
  workerProfileId: string;
  workerName: string;
  infractions: StampRow[];
  counts: { infractions: number; reversed: number };
}

export interface ForgottenStampsOperationalData {
  workers: StampWorker[];
  totals: { workers: number; infractions: number; reversed: number };
}

export interface StampFinancialRow extends StampRow {
  deductionAgorot: number;
  reversalAgorot: number;
}

export interface StampFinancialWorker {
  workerProfileId: string;
  workerName: string;
  infractions: StampFinancialRow[];
  counts: { infractions: number; reversed: number };
  money: { deductionsAgorot: number; reversalsAgorot: number; netAgorot: number };
}

export interface ForgottenStampsFinancialData {
  workers: StampFinancialWorker[];
  totals: { workers: number; infractions: number; reversed: number; deductionsAgorot: number; reversalsAgorot: number; netAgorot: number };
}

export async function loadForgottenStampsOperational(deps: ReportDataDeps, context: ReportLoadContext): Promise<ForgottenStampsOperationalData> {
  const { filters, organizationId } = context;
  const scoped = reportShiftScope(filters);
  const where: Prisma.ForgottenStampInfractionWhereInput = {
    organizationId,
    ...(filters.workerProfileId ? { workerProfileId: filters.workerProfileId } : {}),
    ...(filters.yearMonth ? { businessMonth: filters.yearMonth } : { timeEntry: { businessDate: { gte: filters.fromDate, lte: filters.toDate } } }),
    ...(scoped ? { AND: [{ timeEntry: { shift: scoped } }] } : {}),
  };
  // An explicit allowlist without `deductionAgorot`: the operational version never reads money.
  const infractions = await deps.prisma.forgottenStampInfraction.findMany({
    where,
    select: {
      id: true,
      workerProfileId: true,
      businessMonth: true,
      monthlySequenceNumber: true,
      reversedAt: true,
      reversedBy: true,
      reversalReason: true,
      worker: { select: { membership: { select: { user: { select: { fullLegalName: true } } } } } },
      timeEntry: { select: { businessDate: true } },
      correction: { select: { field: true, reason: true, note: true, editedBy: true, createdAt: true } },
    },
    orderBy: [{ businessMonth: "asc" }, { monthlySequenceNumber: "asc" }, { id: "asc" }],
  });

  const userIds = [...new Set(infractions.flatMap((row) => [row.correction.editedBy, row.reversedBy]).filter((id): id is string => id !== null))];
  const users = userIds.length > 0 ? await deps.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullLegalName: true } }) : [];
  const nameOf = (id: string | null) => (id ? (users.find((user) => user.id === id)?.fullLegalName ?? null) : null);

  const byWorker = new Map<string, StampWorker>();
  for (const row of infractions) {
    const worker = byWorker.get(row.workerProfileId) ?? {
      workerProfileId: row.workerProfileId,
      workerName: row.worker.membership.user.fullLegalName,
      infractions: [],
      counts: { infractions: 0, reversed: 0 },
    };
    worker.infractions.push({
      infractionId: row.id,
      businessMonth: row.businessMonth,
      sequence: row.monthlySequenceNumber,
      entryBusinessDate: row.timeEntry.businessDate,
      correctedField: row.correction.field,
      correctionReason: row.correction.reason,
      correctionNote: row.correction.note,
      correctedByName: nameOf(row.correction.editedBy),
      correctedAt: row.correction.createdAt.toISOString(),
      reversedAt: row.reversedAt?.toISOString() ?? null,
      reversedByName: nameOf(row.reversedBy),
      reversalReason: row.reversalReason,
    });
    worker.counts.infractions += 1;
    if (row.reversedAt) worker.counts.reversed += 1;
    byWorker.set(row.workerProfileId, worker);
  }

  const workers = [...byWorker.values()].sort((a, b) => a.workerName.localeCompare(b.workerName, "ar") || a.workerProfileId.localeCompare(b.workerProfileId));
  return {
    workers,
    totals: {
      workers: workers.length,
      infractions: workers.reduce((sum, worker) => sum + worker.counts.infractions, 0),
      reversed: workers.reduce((sum, worker) => sum + worker.counts.reversed, 0),
    },
  };
}

export async function loadForgottenStampsFinancial(deps: ReportDataDeps, context: ReportLoadContext): Promise<ForgottenStampsFinancialData> {
  const operational = await loadForgottenStampsOperational(deps, context);
  const infractionIds = operational.workers.flatMap((worker) => worker.infractions.map((row) => row.infractionId));
  const adjustments =
    infractionIds.length > 0
      ? await deps.prisma.payrollAdjustment.findMany({
          where: { organizationId: context.organizationId, relatedInfractionId: { in: infractionIds } },
          select: { relatedInfractionId: true, type: true, amountAgorot: true },
        })
      : [];
  const sumOf = (infractionId: string, type: string) =>
    adjustments
      .filter((adjustment) => adjustment.relatedInfractionId === infractionId && adjustment.type === type)
      .reduce((sum, adjustment) => sum + adjustment.amountAgorot, 0);

  const workers = operational.workers.map((worker): StampFinancialWorker => {
    const infractions = worker.infractions.map((row) => ({
      ...row,
      deductionAgorot: -sumOf(row.infractionId, PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY),
      reversalAgorot: sumOf(row.infractionId, PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL),
    }));
    const deductionsAgorot = infractions.reduce((sum, row) => sum + row.deductionAgorot, 0);
    const reversalsAgorot = infractions.reduce((sum, row) => sum + row.reversalAgorot, 0);
    return { ...worker, infractions, money: { deductionsAgorot, reversalsAgorot, netAgorot: reversalsAgorot - deductionsAgorot } };
  });

  const deductionsAgorot = workers.reduce((sum, worker) => sum + worker.money.deductionsAgorot, 0);
  const reversalsAgorot = workers.reduce((sum, worker) => sum + worker.money.reversalsAgorot, 0);
  return { workers, totals: { ...operational.totals, deductionsAgorot, reversalsAgorot, netAgorot: reversalsAgorot - deductionsAgorot } };
}
