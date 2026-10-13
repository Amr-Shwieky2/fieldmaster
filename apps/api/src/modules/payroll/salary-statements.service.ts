import { Injectable } from "@nestjs/common";
import type { PayrollItem } from "@prisma/client";
import { PayrollPeriodStatus, SalaryStatementStatus } from "@fieldmaster/shared-types";
import { calculateWorkerPayroll, toBusinessYearMonth, type PayrollWorkerResult } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { PayrollInputsService } from "./payroll-inputs.service";
import { previousYearMonth } from "./financial-dashboard.service";
import { PAYROLL_SNAPSHOT_SCHEMA_VERSION, type PayrollSnapshotInputs } from "./payroll-snapshot";

/** How many finalized months a statement list goes back. */
const STATEMENT_MONTHS = 24;

type Figures = Pick<
  PayrollWorkerResult,
  | "standardDaysCredited"
  | "regularMinutes"
  | "overtimeMinutes"
  | "grossBaseAgorot"
  | "overtimeAgorot"
  | "positiveAdjustmentsAgorot"
  | "forgottenStampPenaltiesAgorot"
  | "reversalsAgorot"
  | "otherDeductionsAgorot"
  | "netPayableAgorot"
> & { approvedShifts: number | null };

function statement(yearMonth: string, figures: Figures, finalized: { version: number; finalizedAt: Date | null } | null, pendingEntries: number | null) {
  return {
    yearMonth,
    status: finalized ? SalaryStatementStatus.FINALIZED : SalaryStatementStatus.DRAFT,
    isEstimate: finalized === null,
    version: finalized?.version ?? null,
    finalizedAt: finalized?.finalizedAt ?? null,
    approvedShifts: figures.approvedShifts,
    standardDaysCredited: figures.standardDaysCredited,
    regularMinutes: figures.regularMinutes,
    overtimeMinutes: figures.overtimeMinutes,
    baseAgorot: figures.grossBaseAgorot,
    overtimeAgorot: figures.overtimeAgorot,
    grossAgorot: figures.grossBaseAgorot + figures.overtimeAgorot,
    adjustmentsAgorot: figures.positiveAdjustmentsAgorot - figures.otherDeductionsAgorot,
    forgottenStampDeductionsAgorot: figures.forgottenStampPenaltiesAgorot - figures.reversalsAgorot,
    netPayableAgorot: figures.netPayableAgorot,
    pendingEntries,
  };
}

/**
 * The caller's own salary (Step 7; the mobile "my salary" screen comes in
 * Step 9). Every query is bound to the caller's own worker profile from the
 * token -- the route takes no worker id at all. Statements come only from
 * FINALIZED versions (a month's latest finalized one); a month without one
 * gets a DRAFT estimate from the caller's approved attendance and
 * adjustments so far, calculated by the payroll engine.
 */
@Injectable()
export class SalaryStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inputs: PayrollInputsService,
  ) {}

  async myStatements(organizationId: string, actor: AuthenticatedUser) {
    const workerProfileId = actor.workerProfileId;
    if (!workerProfileId) throw new AppException(404, ErrorCodes.NOT_FOUND, "No salary statements for this account.");

    const finalizedVersions = await this.latestFinalizedVersions(organizationId);
    const items = await this.prisma.payrollItem.findMany({
      where: { workerProfileId, payrollPeriodId: { in: [...finalizedVersions.values()].map((version) => version.id) } },
    });
    const statements = items
      .map((item) => {
        const version = [...finalizedVersions.values()].find((candidate) => candidate.id === item.payrollPeriodId)!;
        return statement(version.yearMonth, item, version, null);
      })
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
      .slice(0, STATEMENT_MONTHS);

    // Open months: the current one, and the previous one until it is finalized.
    const currentMonth = toBusinessYearMonth(new Date());
    const estimates = [];
    for (const yearMonth of [currentMonth, previousYearMonth(currentMonth)]) {
      if (finalizedVersions.has(yearMonth)) continue;
      const { inputs } = await this.inputs.load(organizationId, yearMonth, { workerProfileId });
      const hasActivity = inputs.entries.length > 0 || inputs.adjustments.length > 0 || inputs.pending.entries > 0;
      if (yearMonth !== currentMonth && !hasActivity) continue;
      const { worker } = calculateWorkerPayroll(workerProfileId, inputs.entries, inputs.compensationProfiles, inputs.adjustments);
      estimates.push(statement(yearMonth, worker, null, inputs.pending.entries));
    }

    return { statements, estimates };
  }

  /** Each month's latest FINALIZED version (a reopened month keeps its finalized version until the next one is finalized). */
  private async latestFinalizedVersions(organizationId: string) {
    const finalized = await this.prisma.payrollPeriod.findMany({
      where: { organizationId, status: PayrollPeriodStatus.FINALIZED },
      orderBy: [{ yearMonth: "desc" }, { version: "desc" }],
      select: { id: true, yearMonth: true, version: true, finalizedAt: true },
    });
    const latest = new Map<string, (typeof finalized)[number]>();
    for (const version of finalized) if (!latest.has(version.yearMonth)) latest.set(version.yearMonth, version);
    return latest;
  }

  /**
   * `GET /payroll-periods/:yearMonth/my-payslip`: the caller's item in the
   * month's latest FINALIZED version (Step 7: never a draft), with the
   * adjustments that version included for the caller.
   */
  async myPayslip(organizationId: string, yearMonth: string, actor: AuthenticatedUser) {
    const workerProfileId = actor.workerProfileId;
    if (!workerProfileId) throw new AppException(404, ErrorCodes.NOT_FOUND, "No payslip available for this account.");
    const version = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth, status: PayrollPeriodStatus.FINALIZED },
      orderBy: { version: "desc" },
      include: { currentSnapshot: { select: { schemaVersion: true, inputsJson: true } } },
    });
    if (!version) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll for this month has not been finalized yet.");
    const item: (PayrollItem & { adjustments: unknown[] }) | null = await this.prisma.payrollItem.findUnique({
      where: { payrollPeriodId_workerProfileId: { payrollPeriodId: version.id, workerProfileId } },
      include: { adjustments: { where: { workerProfileId } } },
    });
    if (!item) throw new AppException(404, ErrorCodes.NOT_FOUND, "No payroll record found for this month.");
    const snapshot = version.currentSnapshot;
    const adjustments =
      snapshot?.schemaVersion === PAYROLL_SNAPSHOT_SCHEMA_VERSION
        ? (snapshot.inputsJson as unknown as PayrollSnapshotInputs).adjustments.filter((adjustment) => adjustment.workerProfileId === workerProfileId)
        : item.adjustments;
    return { periodStatus: version.status, version: version.version, ...item, adjustments };
  }
}
