import { Injectable } from "@nestjs/common";
import type { PayrollItem } from "@prisma/client";
import { PayrollPeriodStatus, SalaryStatementStatus, TimeEntryStatus, type CompensationType } from "@fieldmaster/shared-types";
import {
  calculateWorkerPayroll,
  computeEntryCompensation,
  pickEffectiveCompensationProfile,
  splitWorkedMinutes,
  toBusinessYearMonth,
  type PayrollWorkerResult,
} from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { PayrollInputsService, toEngineProfile } from "./payroll-inputs.service";
import { previousYearMonth } from "./financial-dashboard.service";
import { PAYROLL_SNAPSHOT_SCHEMA_VERSION, snapshotRulesFor, type PayrollSnapshotInputs, type PayrollSnapshotResult } from "./payroll-snapshot";

/** `GET /time-entries/:id/my-pay` (the contract's `MyEntryPay`): the caller's own pay for one entry. */
export interface MyEntryPay {
  timeEntryId: string;
  approved: boolean;
  compensationType: CompensationType | null;
  regularMinutes: number;
  overtimeMinutes: number;
  /** Emergency call-outs only: the paid minutes, which include the -60 / +15 compensation. */
  compensatedMinutes: number | null;
  baseAgorot: number | null;
  overtimeAgorot: number | null;
  totalAgorot: number | null;
  /** True when the figures come from the month's latest FINALIZED payroll version. */
  finalized: boolean;
}

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
    private readonly workRules: WorkRulesService,
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
      const { worker } = calculateWorkerPayroll(workerProfileId, inputs.entries, inputs.compensationProfiles, inputs.adjustments, snapshotRulesFor(inputs));
      estimates.push(statement(yearMonth, worker, null, inputs.pending.entries));
    }

    return { statements, estimates };
  }

  /**
   * `GET /payroll-statements/me/current` (Step 9): the current business month
   * (Asia/Jerusalem) as a labeled estimate -- the caller's APPROVED entries
   * and the month's recorded adjustments through the payroll engine; entries
   * still waiting for approval are only counted (`pendingEntries`). 404
   * without a worker profile; 409 PAYROLL_PERIOD_FINALIZED once the month
   * has a finalized version (its statement is in `GET /payroll-statements/me`).
   */
  async myCurrentEstimate(organizationId: string, actor: AuthenticatedUser) {
    const workerProfileId = actor.workerProfileId;
    if (!workerProfileId) throw new AppException(404, ErrorCodes.NOT_FOUND, "No salary statements for this account.");

    const now = new Date();
    const yearMonth = toBusinessYearMonth(now);
    const finalized = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth, status: PayrollPeriodStatus.FINALIZED },
      select: { id: true },
    });
    if (finalized) {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This month's payroll is finalized: its statement is in GET /payroll-statements/me.", { yearMonth });
    }

    const { inputs } = await this.inputs.load(organizationId, yearMonth, { workerProfileId });
    const { worker } = calculateWorkerPayroll(workerProfileId, inputs.entries, inputs.compensationProfiles, inputs.adjustments, snapshotRulesFor(inputs));
    return { ...statement(yearMonth, worker, null, inputs.pending.entries), isEstimate: true as const, basis: "APPROVED_ENTRIES_ONLY" as const, calculatedAt: now };
  }

  /**
   * `GET /time-entries/:id/my-pay` (Step 9): the caller's own pay for one of
   * their entries; any other entry -- another worker's, or one that does not
   * exist -- is a 404. No amount before the entry is APPROVED. When the
   * entry's month has a FINALIZED version (the latest finalized one) whose
   * stored calculation paid it, the figures are that version's; otherwise
   * they are computed by the payroll engine with the compensation profile in
   * effect on the entry's business date (amounts null when no profile covers
   * it: payroll pays nothing for it either). Emergency call-outs also get
   * `compensatedMinutes`, the paid minutes with the -60 / +15.
   */
  async myEntryPay(organizationId: string, timeEntryId: string, actor: AuthenticatedUser): Promise<MyEntryPay> {
    const workerProfileId = actor.workerProfileId;
    const entry =
      workerProfileId && UUID_PATTERN.test(timeEntryId)
        ? await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId, workerProfileId } })
        : null;
    if (!entry || !workerProfileId) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");

    const pay = (figures: Omit<MyEntryPay, "timeEntryId" | "compensatedMinutes">): MyEntryPay => ({
      timeEntryId: entry.id,
      ...figures,
      compensatedMinutes: entry.isEmergency ? figures.regularMinutes + figures.overtimeMinutes : null,
    });

    if (entry.status !== TimeEntryStatus.APPROVED) {
      // The minutes as recorded, split the way approval would split them; no amount before approval.
      const recorded =
        entry.clockOutAt && entry.rawDurationMinutes !== null
          ? splitWorkedMinutes(
              { rawDurationMinutes: entry.rawDurationMinutes, unpaidBreakMinutes: entry.unpaidBreakMinutes, fullDayCredit: entry.fullDayCredit },
              await this.workRules.rulesOn(organizationId, entry.businessDate),
            )
          : { regularMinutes: 0, overtimeMinutes: 0 };
      return pay({
        approved: false,
        compensationType: null,
        regularMinutes: recorded.regularMinutes,
        overtimeMinutes: recorded.overtimeMinutes,
        baseAgorot: null,
        overtimeAgorot: null,
        totalAgorot: null,
        finalized: false,
      });
    }

    const finalizedVersion = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth: entry.businessDate.slice(0, 7), status: PayrollPeriodStatus.FINALIZED },
      orderBy: { version: "desc" },
      include: { currentSnapshot: { select: { schemaVersion: true, resultJson: true } } },
    });
    const snapshot = finalizedVersion?.currentSnapshot;
    const stored =
      snapshot?.schemaVersion === PAYROLL_SNAPSHOT_SCHEMA_VERSION
        ? (snapshot.resultJson as unknown as PayrollSnapshotResult).entries.find((line) => line.timeEntryId === entry.id && line.workerProfileId === workerProfileId)
        : undefined;
    if (stored) {
      // A line without a profile was paid nothing (the Owner saw a warning): its minutes, no amount.
      const paid = stored.compensationProfileId !== null;
      return pay({
        approved: true,
        compensationType: stored.compensationType,
        regularMinutes: paid ? stored.regularMinutes : (entry.approvedRegularMinutes ?? 0),
        overtimeMinutes: paid ? stored.overtimeMinutes : (entry.approvedOvertimeMinutes ?? 0),
        baseAgorot: paid ? stored.baseAgorot : null,
        overtimeAgorot: paid ? stored.overtimeAgorot : null,
        totalAgorot: paid ? stored.totalAgorot : null,
        finalized: true,
      });
    }

    const profiles = await this.prisma.compensationProfile.findMany({ where: { workerProfileId } });
    const profile = pickEffectiveCompensationProfile(profiles.map(toEngineProfile), workerProfileId, entry.businessDate);
    if (!profile) {
      return pay({
        approved: true,
        compensationType: null,
        regularMinutes: entry.approvedRegularMinutes ?? 0,
        overtimeMinutes: entry.approvedOvertimeMinutes ?? 0,
        baseAgorot: null,
        overtimeAgorot: null,
        totalAgorot: null,
        finalized: false,
      });
    }
    const computed = computeEntryCompensation(entry, profile, await this.workRules.rulesOn(organizationId, entry.businessDate));
    return pay({
      approved: true,
      compensationType: profile.compensationType,
      regularMinutes: computed.regularMinutes,
      overtimeMinutes: computed.overtimeMinutes,
      baseAgorot: computed.baseAgorot,
      overtimeAgorot: computed.overtimeAgorot,
      totalAgorot: computed.baseAgorot + computed.overtimeAgorot,
      finalized: false,
    });
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
