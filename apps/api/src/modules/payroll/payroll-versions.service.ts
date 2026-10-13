import { Injectable } from "@nestjs/common";
import type { PayrollAdjustment, PayrollCalculationRun, PayrollCalculationSnapshot, PayrollItem, PayrollPeriod } from "@prisma/client";
import { PayrollPeriodStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { PayrollInputsService } from "./payroll-inputs.service";
import {
  PAYROLL_SNAPSHOT_SCHEMA_VERSION,
  type PayrollSnapshotInputs,
  type PayrollSnapshotResult,
  type PayrollSnapshotTotals,
  type SnapshotAdjustmentInput,
  type SnapshotCostGroup,
  type SnapshotWorkerResult,
} from "./payroll-snapshot";
import type {
  PayrollAdjustmentLineDto,
  PayrollCalculationRunDto,
  PayrollCostGroupDto,
  PayrollTotalsDto,
  PayrollVersionDetailDto,
  PayrollWorkerLineDto,
} from "./payroll.types";

interface StoredCalculation {
  inputs: PayrollSnapshotInputs;
  result: PayrollSnapshotResult;
  totals: PayrollSnapshotTotals;
}

type ItemAdjustment = PayrollAdjustment & { relatedInfraction: { timeEntryId: string } | null };
type ItemWithNames = PayrollItem & { adjustments: ItemAdjustment[]; worker: { membership: { user: { fullLegalName: string } } } };

const ITEM_INCLUDE = {
  adjustments: { include: { relatedInfraction: { select: { timeEntryId: true } } } },
  worker: { select: { membership: { select: { user: { select: { fullLegalName: true } } } } } },
} as const;

function storedCalculation(snapshot: PayrollCalculationSnapshot | null): StoredCalculation | null {
  if (!snapshot || snapshot.schemaVersion !== PAYROLL_SNAPSHOT_SCHEMA_VERSION || !snapshot.totalsJson) return null;
  return {
    inputs: snapshot.inputsJson as unknown as PayrollSnapshotInputs,
    result: snapshot.resultJson as unknown as PayrollSnapshotResult,
    totals: snapshot.totalsJson as unknown as PayrollSnapshotTotals,
  };
}

function workerLine(worker: SnapshotWorkerResult): PayrollWorkerLineDto {
  return {
    workerProfileId: worker.workerProfileId,
    fullLegalName: worker.fullLegalName,
    approvedShifts: worker.approvedShifts,
    standardDaysCredited: worker.standardDaysCredited,
    regularMinutes: worker.regularMinutes,
    overtimeMinutes: worker.overtimeMinutes,
    emergencyRetroactiveMinutes: worker.emergencyRetroactiveMinutes,
    emergencyReturnMinutes: worker.emergencyReturnMinutes,
    grossBaseAgorot: worker.grossBaseAgorot,
    overtimeAgorot: worker.overtimeAgorot,
    positiveAdjustmentsAgorot: worker.positiveAdjustmentsAgorot,
    forgottenStampPenaltiesAgorot: worker.forgottenStampPenaltiesAgorot,
    reversalsAgorot: worker.reversalsAgorot,
    otherDeductionsAgorot: worker.otherDeductionsAgorot,
    netPayableAgorot: worker.netPayableAgorot,
    pendingEntries: worker.pendingEntries,
    entriesWithoutCompensation: worker.entriesWithoutCompensation,
  };
}

/** A version calculated before Step 7: only its items (and their linked adjustments) were kept. */
function legacyWorkerLine(item: ItemWithNames): PayrollWorkerLineDto {
  return {
    workerProfileId: item.workerProfileId,
    fullLegalName: item.worker.membership.user.fullLegalName,
    approvedShifts: item.approvedShifts,
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
    netPayableAgorot: item.netPayableAgorot,
    pendingEntries: null,
    entriesWithoutCompensation: null,
  };
}

function sumLines(lines: readonly PayrollWorkerLineDto[]): PayrollTotalsDto {
  const sum = (pick: (line: PayrollWorkerLineDto) => number) => lines.reduce((total, line) => total + pick(line), 0);
  return {
    workers: lines.length,
    approvedShifts: lines.some((line) => line.approvedShifts === null) ? null : sum((line) => line.approvedShifts ?? 0),
    standardDaysCredited: sum((line) => line.standardDaysCredited),
    regularMinutes: sum((line) => line.regularMinutes),
    overtimeMinutes: sum((line) => line.overtimeMinutes),
    emergencyRetroactiveMinutes: sum((line) => line.emergencyRetroactiveMinutes),
    emergencyReturnMinutes: sum((line) => line.emergencyReturnMinutes),
    grossBaseAgorot: sum((line) => line.grossBaseAgorot),
    overtimeAgorot: sum((line) => line.overtimeAgorot),
    positiveAdjustmentsAgorot: sum((line) => line.positiveAdjustmentsAgorot),
    forgottenStampPenaltiesAgorot: sum((line) => line.forgottenStampPenaltiesAgorot),
    reversalsAgorot: sum((line) => line.reversalsAgorot),
    otherDeductionsAgorot: sum((line) => line.otherDeductionsAgorot),
    netPayableAgorot: sum((line) => line.netPayableAgorot),
  };
}

function totalsDto(totals: PayrollSnapshotTotals): PayrollTotalsDto {
  return {
    workers: totals.workers,
    approvedShifts: totals.approvedShifts,
    standardDaysCredited: totals.standardDaysCredited,
    regularMinutes: totals.regularMinutes,
    overtimeMinutes: totals.overtimeMinutes,
    emergencyRetroactiveMinutes: totals.emergencyRetroactiveMinutes,
    emergencyReturnMinutes: totals.emergencyReturnMinutes,
    grossBaseAgorot: totals.grossBaseAgorot,
    overtimeAgorot: totals.overtimeAgorot,
    positiveAdjustmentsAgorot: totals.positiveAdjustmentsAgorot,
    forgottenStampPenaltiesAgorot: totals.forgottenStampPenaltiesAgorot,
    reversalsAgorot: totals.reversalsAgorot,
    otherDeductionsAgorot: totals.otherDeductionsAgorot,
    netPayableAgorot: totals.netPayableAgorot,
  };
}

function costGroup(group: SnapshotCostGroup, withProject: boolean): PayrollCostGroupDto {
  return {
    id: group.id,
    name: group.name,
    ...(withProject ? { projectName: group.projectName ?? null } : {}),
    approvedShifts: group.approvedShifts,
    workers: group.workers,
    regularMinutes: group.regularMinutes,
    overtimeMinutes: group.overtimeMinutes,
    grossBaseAgorot: group.grossBaseAgorot,
    overtimeAgorot: group.overtimeAgorot,
    totalAgorot: group.totalAgorot,
  };
}

/**
 * The payroll read side (Step 7, Owner only): versions are always shown from
 * what was stored -- the calculation's snapshot (inputs, results, totals) or,
 * for versions calculated before Step 7, their items. Nothing a version shows
 * is recomputed from live records; live data is only used to say what a
 * WORKING version does not include yet (new adjustments, changed inputs).
 */
@Injectable()
export class PayrollVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inputs: PayrollInputsService,
  ) {}

  private async userNames(userIds: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string"))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullLegalName: true } });
    return new Map(users.map((user) => [user.id, user.fullLegalName]));
  }

  private async findVersion(organizationId: string, yearMonth: string, version?: number): Promise<PayrollPeriod> {
    const period =
      version === undefined
        ? await this.prisma.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } })
        : await this.prisma.payrollPeriod.findUnique({ where: { organizationId_yearMonth_version: { organizationId, yearMonth, version } } });
    if (!period) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll period not found.");
    return period;
  }

  private async isLatest(period: PayrollPeriod): Promise<boolean> {
    const newer = await this.prisma.payrollPeriod.count({
      where: { organizationId: period.organizationId, yearMonth: period.yearMonth, version: { gt: period.version } },
    });
    return newer === 0;
  }

  runDto(run: PayrollCalculationRun, period: Pick<PayrollPeriod, "yearMonth" | "version">, names: Map<string, string>): PayrollCalculationRunDto {
    return {
      id: run.id,
      yearMonth: period.yearMonth,
      version: period.version,
      state: run.state,
      progress: run.progress,
      processedWorkers: run.processedWorkers,
      totalWorkers: run.totalWorkers,
      requestedAt: run.requestedAt,
      requestedByName: names.get(run.requestedBy) ?? null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorCode: run.errorCode,
    };
  }

  /** A run by id (the answer of "calculate", always its current state). */
  async run(organizationId: string, runId: string): Promise<PayrollCalculationRunDto> {
    const run = await this.prisma.payrollCalculationRun.findFirst({ where: { id: runId, organizationId }, include: { payrollPeriod: true } });
    if (!run) throw new AppException(404, ErrorCodes.NOT_FOUND, "Calculation not found.");
    return this.runDto(run, run.payrollPeriod, await this.userNames([run.requestedBy]));
  }

  /** The latest run of the month's latest version. */
  async latestRun(organizationId: string, yearMonth: string): Promise<PayrollCalculationRunDto> {
    const period = await this.findVersion(organizationId, yearMonth);
    const run = await this.prisma.payrollCalculationRun.findFirst({ where: { payrollPeriodId: period.id }, orderBy: { requestedAt: "desc" } });
    if (!run) throw new AppException(404, ErrorCodes.NOT_FOUND, "This payroll version has not been calculated yet.");
    return this.runDto(run, period, await this.userNames([run.requestedBy]));
  }

  /** One row per month (its latest version), newest month first. */
  async listMonths(organizationId: string) {
    const periods = await this.prisma.payrollPeriod.findMany({
      where: { organizationId },
      orderBy: [{ yearMonth: "desc" }, { version: "desc" }],
      include: { currentSnapshot: { select: { calculatedAt: true, totalsJson: true, schemaVersion: true } } },
    });
    const latest = new Map<string, (typeof periods)[number]>();
    const counts = new Map<string, number>();
    for (const period of periods) {
      if (!latest.has(period.yearMonth)) latest.set(period.yearMonth, period);
      counts.set(period.yearMonth, (counts.get(period.yearMonth) ?? 0) + 1);
    }
    const rows = [...latest.values()];
    const figures = await this.versionFigures(rows);
    return rows.map((period) => ({
      id: period.id,
      yearMonth: period.yearMonth,
      version: period.version,
      versionCount: counts.get(period.yearMonth) ?? 1,
      status: period.status,
      workers: figures.get(period.id)?.workers ?? null,
      netPayableAgorot: figures.get(period.id)?.netPayableAgorot ?? null,
      calculatedAt: period.currentSnapshot?.calculatedAt ?? null,
      finalizedAt: period.finalizedAt,
    }));
  }

  /** Workers and net of each version: from its stored totals, or (before Step 7) its items. */
  private async versionFigures(periods: readonly (PayrollPeriod & { currentSnapshot: { totalsJson: unknown; schemaVersion: number } | null })[]) {
    const figures = new Map<string, { workers: number; netPayableAgorot: number }>();
    const withoutTotals: string[] = [];
    for (const period of periods) {
      const totals =
        period.currentSnapshot?.schemaVersion === PAYROLL_SNAPSHOT_SCHEMA_VERSION ? (period.currentSnapshot.totalsJson as PayrollSnapshotTotals | null) : null;
      if (totals) figures.set(period.id, { workers: totals.workers, netPayableAgorot: totals.netPayableAgorot });
      else withoutTotals.push(period.id);
    }
    if (withoutTotals.length > 0) {
      const sums = await this.prisma.payrollItem.groupBy({
        by: ["payrollPeriodId"],
        where: { payrollPeriodId: { in: withoutTotals } },
        _count: { _all: true },
        _sum: { netPayableAgorot: true },
      });
      for (const sum of sums) figures.set(sum.payrollPeriodId, { workers: sum._count._all, netPayableAgorot: sum._sum.netPayableAgorot ?? 0 });
    }
    return figures;
  }

  /** The version history of a month, newest first: who started each version and why, who calculated and finalized it. */
  async listVersions(organizationId: string, yearMonth: string) {
    const periods = await this.prisma.payrollPeriod.findMany({
      where: { organizationId, yearMonth },
      orderBy: { version: "desc" },
      include: { currentSnapshot: { select: { calculatedAt: true, calculatedBy: true, totalsJson: true, schemaVersion: true } } },
    });
    if (periods.length === 0) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll period not found.");
    const names = await this.userNames(periods.flatMap((p) => [p.createdBy, p.reopenedBy, p.finalizedBy, p.currentSnapshot?.calculatedBy]));
    const figures = await this.versionFigures(periods);
    return periods.map((period, index) => ({
      id: period.id,
      version: period.version,
      status: period.status,
      isCurrent: index === 0,
      legacy: period.legacy,
      createdAt: period.createdAt,
      createdByName: period.createdBy ? (names.get(period.createdBy) ?? null) : null,
      reopenedAt: period.reopenedAt,
      reopenedByName: period.reopenedBy ? (names.get(period.reopenedBy) ?? null) : null,
      reopenReason: period.reopenReason,
      calculatedAt: period.currentSnapshot?.calculatedAt ?? null,
      calculatedByName: period.currentSnapshot ? (names.get(period.currentSnapshot.calculatedBy) ?? null) : null,
      finalizedAt: period.finalizedAt,
      finalizedByName: period.finalizedBy ? (names.get(period.finalizedBy) ?? null) : null,
      workers: figures.get(period.id)?.workers ?? null,
      netPayableAgorot: figures.get(period.id)?.netPayableAgorot ?? null,
    }));
  }

  /** The latest version (no `version`) or a given one. */
  async detail(organizationId: string, yearMonth: string, version?: number): Promise<PayrollVersionDetailDto> {
    const period = await this.findVersion(organizationId, yearMonth, version);
    return this.buildDetail(period, await this.isLatest(period));
  }

  async detailById(periodId: string): Promise<PayrollVersionDetailDto> {
    const period = await this.prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    return this.buildDetail(period, await this.isLatest(period));
  }

  private async buildDetail(period: PayrollPeriod, isCurrent: boolean): Promise<PayrollVersionDetailDto> {
    const [snapshot, run, previous] = await Promise.all([
      period.currentSnapshotId ? this.prisma.payrollCalculationSnapshot.findUnique({ where: { id: period.currentSnapshotId } }) : null,
      this.prisma.payrollCalculationRun.findFirst({ where: { payrollPeriodId: period.id }, orderBy: { requestedAt: "desc" } }),
      period.previousVersionId ? this.prisma.payrollPeriod.findUnique({ where: { id: period.previousVersionId }, select: { version: true } }) : null,
    ]);
    const stored = storedCalculation(snapshot);
    const working = isCurrent && period.status !== PayrollPeriodStatus.FINALIZED;

    let workers: PayrollWorkerLineDto[];
    let totals: PayrollTotalsDto | null;
    let included: (SnapshotAdjustmentInput & { fullLegalName: string })[];
    let legacyItems: ItemWithNames[] = [];
    if (stored) {
      const nameOf = new Map(stored.inputs.workers.map((worker) => [worker.workerProfileId, worker.fullLegalName]));
      workers = stored.result.workers.map(workerLine);
      totals = totalsDto(stored.totals);
      included = stored.inputs.adjustments.map((adjustment) => ({ ...adjustment, fullLegalName: nameOf.get(adjustment.workerProfileId) ?? "" }));
    } else {
      legacyItems = (await this.prisma.payrollItem.findMany({ where: { payrollPeriodId: period.id }, include: ITEM_INCLUDE })) as ItemWithNames[];
      workers = legacyItems.map(legacyWorkerLine).sort((a, b) => a.fullLegalName.localeCompare(b.fullLegalName, "ar"));
      totals = legacyItems.length > 0 ? sumLines(workers) : null;
      included = legacyItems.flatMap((item) =>
        item.adjustments.map((adjustment) => ({
          ...this.adjustmentInput(adjustment, adjustment.relatedInfraction?.timeEntryId ?? null),
          fullLegalName: item.worker.membership.user.fullLegalName,
        })),
      );
    }

    // A working version: the month's adjustments its calculation does not include yet.
    let notIncluded: (SnapshotAdjustmentInput & { fullLegalName: string })[] = [];
    if (working) {
      const includedIds = new Set(included.map((adjustment) => adjustment.id));
      const live = await this.prisma.payrollAdjustment.findMany({
        where: { organizationId: period.organizationId, businessMonth: period.yearMonth, id: { notIn: [...includedIds] } },
        include: {
          relatedInfraction: { select: { timeEntryId: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const workerNames = await this.prisma.workerProfile.findMany({
        where: { id: { in: [...new Set(live.map((adjustment) => adjustment.workerProfileId))] } },
        select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } },
      });
      const nameOf = new Map(workerNames.map((worker) => [worker.id, worker.membership.user.fullLegalName]));
      notIncluded = live.map((adjustment) => ({
        ...this.adjustmentInput(adjustment, adjustment.relatedInfraction?.timeEntryId ?? null),
        fullLegalName: nameOf.get(adjustment.workerProfileId) ?? "",
      }));
    }

    const names = await this.userNames([
      period.createdBy,
      period.reopenedBy,
      period.finalizedBy,
      snapshot?.calculatedBy,
      run?.requestedBy,
      ...included.map((adjustment) => adjustment.createdBy),
      ...notIncluded.map((adjustment) => adjustment.createdBy),
    ]);
    const all = [...included, ...notIncluded];
    const line = (adjustment: SnapshotAdjustmentInput & { fullLegalName: string }): PayrollAdjustmentLineDto => ({
      id: adjustment.id,
      workerProfileId: adjustment.workerProfileId,
      fullLegalName: adjustment.fullLegalName,
      type: adjustment.type,
      source: adjustment.source,
      amountAgorot: adjustment.amountAgorot,
      reason: adjustment.reason,
      createdAt: adjustment.createdAt,
      createdByName: names.get(adjustment.createdBy) ?? null,
      relatedInfractionId: adjustment.relatedInfractionId,
      timeEntryId: adjustment.timeEntryId,
      reversalOfId: adjustment.reversalOfId,
      reversedById: all.find((other) => other.reversalOfId === adjustment.id)?.id ?? null,
    });

    const changedSinceCalculation =
      working && period.status === PayrollPeriodStatus.REVIEW && snapshot?.inputsHash
        ? (await this.inputs.liveInputsHash(period.organizationId, period.yearMonth)) !== snapshot.inputsHash
        : false;

    const legacyNet =
      !stored && legacyItems.length === 0 && snapshot
        ? ((snapshot.resultJson as { items?: { workerProfileId: string; netPayableAgorot: number }[] }).items ?? null)
        : null;
    let legacyNetByWorker: PayrollVersionDetailDto["legacyNetByWorker"] = null;
    if (legacyNet) {
      const workerNames = await this.prisma.workerProfile.findMany({
        where: { id: { in: legacyNet.map((row) => row.workerProfileId) } },
        select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } },
      });
      const nameOf = new Map(workerNames.map((worker) => [worker.id, worker.membership.user.fullLegalName]));
      legacyNetByWorker = legacyNet.map((row) => ({
        workerProfileId: row.workerProfileId,
        fullLegalName: nameOf.get(row.workerProfileId) ?? "",
        netPayableAgorot: row.netPayableAgorot,
      }));
    }

    return {
      id: period.id,
      yearMonth: period.yearMonth,
      version: period.version,
      status: period.status,
      isCurrent,
      legacy: period.legacy || (!stored && (legacyItems.length > 0 || snapshot !== null)),
      createdAt: period.createdAt,
      createdByName: period.createdBy ? (names.get(period.createdBy) ?? null) : null,
      reopenedAt: period.reopenedAt,
      reopenedByName: period.reopenedBy ? (names.get(period.reopenedBy) ?? null) : null,
      reopenReason: period.reopenReason,
      previousVersion: previous?.version ?? null,
      calculatedAt: snapshot?.calculatedAt ?? null,
      calculatedByName: snapshot ? (names.get(snapshot.calculatedBy) ?? null) : null,
      finalizedAt: period.finalizedAt,
      finalizedByName: period.finalizedBy ? (names.get(period.finalizedBy) ?? null) : null,
      calculation: run ? this.runDto(run, period, names) : null,
      changedSinceCalculation,
      allowedActions: {
        calculate: working && period.status !== PayrollPeriodStatus.CALCULATING,
        finalize: working && period.status === PayrollPeriodStatus.REVIEW && period.currentSnapshotId !== null,
        reopen: isCurrent && period.status === PayrollPeriodStatus.FINALIZED,
        addAdjustment: working,
      },
      totals,
      workers,
      projects: stored ? stored.result.projects.map((group) => costGroup(group, false)) : null,
      sites: stored ? stored.result.sites.map((group) => costGroup(group, true)) : null,
      adjustments: included.map(line),
      adjustmentsNotIncluded: notIncluded.map(line),
      warnings: stored ? stored.result.warnings : { workersWithoutCompensation: [] },
      pending: stored ? stored.inputs.pending : null,
      legacyNetByWorker,
    };
  }

  private adjustmentInput(adjustment: PayrollAdjustment, timeEntryId: string | null): SnapshotAdjustmentInput {
    return {
      id: adjustment.id,
      workerProfileId: adjustment.workerProfileId,
      type: adjustment.type,
      source: adjustment.source,
      amountAgorot: adjustment.amountAgorot,
      reason: adjustment.reason,
      relatedInfractionId: adjustment.relatedInfractionId,
      timeEntryId,
      reversalOfId: adjustment.reversalOfId,
      createdBy: adjustment.createdBy,
      createdAt: adjustment.createdAt.toISOString(),
    };
  }

  /** One worker's lines in a version: their entries as the calculation saw and paid them, and their adjustments. */
  async workerDetail(organizationId: string, yearMonth: string, version: number, workerProfileId: string) {
    const period = await this.findVersion(organizationId, yearMonth, version);
    const notFound = () => new AppException(404, ErrorCodes.NOT_FOUND, "This worker is not in this payroll version.");
    if (!UUID_PATTERN.test(workerProfileId)) throw notFound();
    const snapshot = period.currentSnapshotId ? await this.prisma.payrollCalculationSnapshot.findUnique({ where: { id: period.currentSnapshotId } }) : null;
    const stored = storedCalculation(snapshot);

    if (stored) {
      const worker = stored.result.workers.find((row) => row.workerProfileId === workerProfileId);
      if (!worker) throw notFound();
      const resultById = new Map(stored.result.entries.map((result) => [result.timeEntryId, result]));
      const adjustments = stored.inputs.adjustments.filter((adjustment) => adjustment.workerProfileId === workerProfileId);
      const names = await this.userNames(adjustments.map((adjustment) => adjustment.createdBy));
      return {
        yearMonth: period.yearMonth,
        version: period.version,
        worker: workerLine(worker),
        entries: stored.inputs.entries
          .filter((entry) => entry.workerProfileId === workerProfileId)
          .map((entry) => {
            const pay = resultById.get(entry.timeEntryId);
            return {
              timeEntryId: entry.timeEntryId,
              businessDate: entry.businessDate,
              shift: entry.shift,
              projectName: entry.projectName,
              siteName: entry.siteName,
              clockInAt: entry.clockInAt,
              clockOutAt: entry.clockOutAt,
              approvedRegularMinutes: entry.approvedRegularMinutes ?? 0,
              approvedOvertimeMinutes: entry.approvedOvertimeMinutes ?? 0,
              fullDayCredit: entry.fullDayCredit,
              isEmergency: entry.isEmergency,
              emergencyRetroactiveMinutes: entry.emergencyRetroactiveMinutes,
              emergencyReturnMinutes: entry.emergencyReturnMinutes,
              compensationType: pay?.compensationType ?? null,
              standardDayCredited: pay?.standardDayCredited ?? false,
              regularMinutes: pay?.regularMinutes ?? 0,
              overtimeMinutes: pay?.overtimeMinutes ?? 0,
              baseAgorot: pay?.baseAgorot ?? 0,
              overtimeAgorot: pay?.overtimeAgorot ?? 0,
              totalAgorot: pay?.totalAgorot ?? 0,
            };
          }),
        adjustments: adjustments.map((adjustment) => ({
          ...adjustment,
          fullLegalName: worker.fullLegalName,
          createdByName: names.get(adjustment.createdBy) ?? null,
          reversedById: adjustments.find((other) => other.reversalOfId === adjustment.id)?.id ?? null,
        })),
      };
    }

    const item = (await this.prisma.payrollItem.findUnique({
      where: { payrollPeriodId_workerProfileId: { payrollPeriodId: period.id, workerProfileId } },
      include: ITEM_INCLUDE,
    })) as ItemWithNames | null;
    if (!item) throw notFound();
    const names = await this.userNames(item.adjustments.map((adjustment) => adjustment.createdBy));
    return {
      yearMonth: period.yearMonth,
      version: period.version,
      worker: legacyWorkerLine(item),
      entries: null,
      adjustments: item.adjustments.map((adjustment) => ({
        ...this.adjustmentInput(adjustment, adjustment.relatedInfraction?.timeEntryId ?? null),
        fullLegalName: item.worker.membership.user.fullLegalName,
        createdByName: names.get(adjustment.createdBy) ?? null,
        reversedById: item.adjustments.find((other) => other.reversalOfId === adjustment.id)?.id ?? null,
      })),
    };
  }
}
