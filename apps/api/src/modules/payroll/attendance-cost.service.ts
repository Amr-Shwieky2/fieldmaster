import { Injectable } from "@nestjs/common";
import type { TimeEntry } from "@prisma/client";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import { splitWorkedMinutes } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { PayrollCalculationService } from "./payroll-calculation.service";

/** Where an entry's estimate comes from. */
export const CostBasis = {
  /** Approved minutes: what payroll will pay. */
  APPROVED: "APPROVED",
  /** Waiting for approval: the recorded minutes split the way approval would split them. */
  ESTIMATED: "ESTIMATED",
  /** Still open (no clock-out yet): nothing to estimate. */
  OPEN: "OPEN",
  /** Rejected: not paid. */
  REJECTED: "REJECTED",
  /** No compensation profile covers the entry's date: payroll skips it too. */
  NO_COMPENSATION_PROFILE: "NO_COMPENSATION_PROFILE",
} as const;
export type CostBasis = (typeof CostBasis)[keyof typeof CostBasis];

type CostedEntry = Pick<
  TimeEntry,
  | "id"
  | "workerProfileId"
  | "businessDate"
  | "status"
  | "clockOutAt"
  | "rawDurationMinutes"
  | "unpaidBreakMinutes"
  | "fullDayCredit"
  | "approvedRegularMinutes"
  | "approvedOvertimeMinutes"
>;

export interface EntryCostEstimate {
  timeEntryId: string;
  basis: CostBasis;
  compensationType: string | null;
  regularMinutes: number | null;
  overtimeMinutes: number | null;
  baseAgorot: number | null;
  overtimeAgorot: number | null;
  estimatedCostAgorot: number | null;
}

const ENTRY_COST_SELECT = {
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
} as const;

/**
 * Owner-only cost estimates for the attendance screens (Step 5): one entry,
 * one emergency call-out, or a worker's month. Money is computed only here,
 * through PayrollCalculationService.computeEntryCompensation -- the same
 * function the monthly payroll uses -- and only served by routes that need a
 * financial permission (or, for call-outs, only placed in an Owner's DTO).
 */
@Injectable()
export class AttendanceCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollCalculation: PayrollCalculationService,
  ) {}

  async estimateEntry(entry: CostedEntry): Promise<EntryCostEstimate> {
    const none = (basis: CostBasis, compensationType: string | null = null): EntryCostEstimate => ({
      timeEntryId: entry.id,
      basis,
      compensationType,
      regularMinutes: null,
      overtimeMinutes: null,
      baseAgorot: null,
      overtimeAgorot: null,
      estimatedCostAgorot: basis === CostBasis.REJECTED ? 0 : null,
    });

    const profile = await this.payrollCalculation.findEffectiveCompensationProfile(entry.workerProfileId, entry.businessDate);
    if (entry.status === TimeEntryStatus.REJECTED) return none(CostBasis.REJECTED, profile?.compensationType ?? null);
    if (!profile) return none(CostBasis.NO_COMPENSATION_PROFILE);
    if (entry.status === TimeEntryStatus.ACTIVE || entry.clockOutAt === null || entry.rawDurationMinutes === null) {
      return none(CostBasis.OPEN, profile.compensationType);
    }

    let basis: CostBasis = CostBasis.APPROVED;
    let minutes = { approvedRegularMinutes: entry.approvedRegularMinutes, approvedOvertimeMinutes: entry.approvedOvertimeMinutes };
    if (entry.status !== TimeEntryStatus.APPROVED) {
      basis = CostBasis.ESTIMATED;
      const split = splitWorkedMinutes({
        rawDurationMinutes: entry.rawDurationMinutes,
        unpaidBreakMinutes: entry.unpaidBreakMinutes,
        fullDayCredit: entry.fullDayCredit,
      });
      minutes = { approvedRegularMinutes: split.regularMinutes, approvedOvertimeMinutes: split.overtimeMinutes };
    }

    const comp = this.payrollCalculation.computeEntryCompensation({ ...entry, ...minutes } as TimeEntry, profile);
    return {
      timeEntryId: entry.id,
      basis,
      compensationType: profile.compensationType,
      regularMinutes: comp.regularMinutes,
      overtimeMinutes: comp.overtimeMinutes,
      baseAgorot: comp.baseAgorot,
      overtimeAgorot: comp.overtimeAgorot,
      estimatedCostAgorot: comp.baseAgorot + comp.overtimeAgorot,
    };
  }

  async estimateEntryById(organizationId: string, timeEntryId: string): Promise<EntryCostEstimate> {
    const entry = UUID_PATTERN.test(timeEntryId)
      ? await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId }, select: ENTRY_COST_SELECT })
      : null;
    if (!entry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    return this.estimateEntry(entry);
  }

  /**
   * A worker's estimated earnings for one business month: approved entries
   * (what payroll will pay), entries still waiting for approval (estimated),
   * and the month's payroll adjustments (forgotten-stamp deductions and their
   * reversals, manual adjustments).
   */
  async estimateWorkerMonth(organizationId: string, workerProfileId: string, month: string) {
    const worker = UUID_PATTERN.test(workerProfileId)
      ? await this.prisma.workerProfile.findFirst({ where: { id: workerProfileId, organizationId }, select: { id: true } })
      : null;
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const [entries, adjustments] = await Promise.all([
      this.prisma.timeEntry.findMany({ where: { organizationId, workerProfileId, businessDate: { startsWith: month } }, select: ENTRY_COST_SELECT }),
      this.prisma.payrollAdjustment.findMany({ where: { organizationId, workerProfileId, businessMonth: month }, select: { amountAgorot: true } }),
    ]);

    const estimates = await Promise.all(entries.map((entry) => this.estimateEntry(entry)));
    const sum = (basis: CostBasis) =>
      estimates.filter((estimate) => estimate.basis === basis).reduce((total, estimate) => total + (estimate.estimatedCostAgorot ?? 0), 0);
    const count = (basis: CostBasis) => estimates.filter((estimate) => estimate.basis === basis).length;
    const approvedAgorot = sum(CostBasis.APPROVED);
    const pendingEstimateAgorot = sum(CostBasis.ESTIMATED);
    const adjustmentsAgorot = adjustments.reduce((total, adjustment) => total + adjustment.amountAgorot, 0);

    return {
      workerProfileId,
      month,
      approvedAgorot,
      pendingEstimateAgorot,
      adjustmentsAgorot,
      totalEstimatedAgorot: approvedAgorot + pendingEstimateAgorot + adjustmentsAgorot,
      approvedEntries: count(CostBasis.APPROVED),
      pendingEntries: count(CostBasis.ESTIMATED),
      openEntries: count(CostBasis.OPEN),
      entriesWithoutCompensationProfile: count(CostBasis.NO_COMPENSATION_PROFILE),
    };
  }
}
