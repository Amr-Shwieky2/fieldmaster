import { Injectable } from "@nestjs/common";
import type { CompensationProfile, Prisma } from "@prisma/client";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import { businessMonthDates, type PayrollCompensationProfile } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import {
  PAYROLL_SNAPSHOT_SCHEMA_VERSION,
  payrollInputsHash,
  type PayrollFigureInputs,
  type PayrollSnapshotInputs,
  type SnapshotEntryInput,
  type SnapshotWorkerName,
} from "./payroll-snapshot";

/** Entries a calculation leaves out because they still wait for a decision. */
export const PENDING_ENTRY_STATUSES = [TimeEntryStatus.PENDING_APPROVAL, TimeEntryStatus.CORRECTION_REQUESTED];


const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/** What every read of a month's entries selects: what payroll prices, and the shift to name the project and site. */
const FIGURE_ENTRY_FIELDS = {
  id: true,
  workerProfileId: true,
  shiftId: true,
  businessDate: true,
  approvedRegularMinutes: true,
  approvedOvertimeMinutes: true,
  fullDayCredit: true,
  isEmergency: true,
} as const;

/** What only a stored calculation keeps of each entry (and its fingerprint reads). */
const ENTRY_TIME_FIELDS = { clockInAt: true, clockOutAt: true, updatedAt: true } as const;

type EntryRow = Prisma.TimeEntryGetPayload<{ select: typeof FIGURE_ENTRY_FIELDS }> & Partial<Prisma.TimeEntryGetPayload<{ select: typeof ENTRY_TIME_FIELDS }>>;

/** An entry's times and last change, as a stored calculation keeps them. */
function timesOf(row: EntryRow): Pick<SnapshotEntryInput, "clockInAt" | "clockOutAt" | "updatedAt"> {
  if (!row.updatedAt) throw new Error(`Time entry ${row.id} was read without its times.`);
  return { clockInAt: row.clockInAt?.toISOString() ?? null, clockOutAt: row.clockOutAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
}

export function toEngineProfile(profile: CompensationProfile): PayrollCompensationProfile {
  return {
    id: profile.id,
    workerProfileId: profile.workerProfileId,
    compensationType: profile.compensationType,
    dailyBaseRateAgorot: profile.dailyBaseRateAgorot,
    baseHourlyRateAgorot: profile.baseHourlyRateAgorot,
    overtimeHourlyRateAgorot: profile.overtimeHourlyRateAgorot,
    effectiveStartDate: toDateOnly(profile.effectiveStartDate),
    effectiveEndDate: profile.effectiveEndDate ? toDateOnly(profile.effectiveEndDate) : null,
  };
}

/**
 * Reads what a month's payroll is calculated from (Step 7), and nothing else:
 * the APPROVED time entries of the business month (with their shift, project,
 * site and emergency -60 / +15 minutes), the compensation profiles of the
 * workers involved, and the month's adjustments (penalties, reversals, manual).
 * Entries waiting for approval are only counted. `workerProfileId` narrows
 * every query to one worker (a worker's own estimate).
 */
@Injectable()
export class PayrollInputsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workRules: WorkRulesService,
  ) {}

  /** What a month's calculation reads, as a calculation stores it (each entry with its times and last change), and its fingerprint. */
  async load(
    organizationId: string,
    yearMonth: string,
    options: { workerProfileId?: string } = {},
  ): Promise<{ inputs: PayrollSnapshotInputs; inputsHash: string }> {
    const month = await this.readMonth(organizationId, yearMonth, options.workerProfileId, true);
    const inputs: PayrollSnapshotInputs = {
      schemaVersion: PAYROLL_SNAPSHOT_SCHEMA_VERSION,
      yearMonth,
      ...month.figures,
      entries: month.figures.entries.map((entry, index) => ({ ...entry, ...timesOf(month.rows[index]) })),
    };
    return {
      inputs,
      // Worked out when read (a calculation reads it).
      get inputsHash() {
        return payrollInputsHash({
          entries: inputs.entries.map((entry) => ({ id: entry.timeEntryId, updatedAt: entry.updatedAt })),
          adjustmentIds: month.figures.adjustments.map((adjustment) => adjustment.id),
          profiles: month.profiles,
          workRuleVersionIds: month.workRuleVersions.map((version) => version.id),
        });
      },
    };
  }

  /**
   * The month's figures only, for the live Owner dashboard: the same entries,
   * rates, adjustments, names and rules as `load`, without each entry's times
   * and last change -- which only a stored calculation keeps, and which are
   * half of what a month of entries costs to read.
   */
  async loadFigures(organizationId: string, yearMonth: string): Promise<PayrollFigureInputs> {
    return (await this.readMonth(organizationId, yearMonth, undefined, false)).figures;
  }

  private async readMonth(organizationId: string, yearMonth: string, workerProfileId: string | undefined, withTimes: boolean) {
    const worker = workerProfileId ? { workerProfileId } : {};
    const where = { organizationId, status: TimeEntryStatus.APPROVED, businessDate: businessMonthDates(yearMonth), ...worker };
    const orderBy: Prisma.TimeEntryOrderByWithRelationInput[] = [{ businessDate: "asc" }, { clockInAt: "asc" }, { id: "asc" }];
    const [approved, pending, adjustments, workRuleVersions] = await Promise.all([
      // Flat rows: a month holds thousands of entries but a few hundred shifts, read once below (nesting
      // the shift, its project and site in every entry costs three times as much to load).
      withTimes
        ? (this.prisma.timeEntry.findMany({ where, select: { ...FIGURE_ENTRY_FIELDS, ...ENTRY_TIME_FIELDS }, orderBy }) as Promise<EntryRow[]>)
        : (this.prisma.timeEntry.findMany({ where, select: FIGURE_ENTRY_FIELDS, orderBy }) as Promise<EntryRow[]>),
      this.prisma.timeEntry.groupBy({
        by: ["workerProfileId"],
        where: { organizationId, status: { in: PENDING_ENTRY_STATUSES }, businessDate: businessMonthDates(yearMonth), ...worker },
        _count: { _all: true },
      }),
      this.prisma.payrollAdjustment.findMany({
        where: { organizationId, businessMonth: yearMonth, ...worker },
        include: { relatedInfraction: { select: { timeEntryId: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.workRules.versions(organizationId),
    ]);

    const paidWorkerIds = new Set([...approved.map((entry) => entry.workerProfileId), ...adjustments.map((adjustment) => adjustment.workerProfileId)]);
    const workerIds = [...new Set([...paidWorkerIds, ...pending.map((row) => row.workerProfileId)])];
    const emergencyEntryIds = approved.filter((entry) => entry.isEmergency).map((entry) => entry.id);
    const [profiles, workerRows, shifts, callouts] = await Promise.all([
      this.prisma.compensationProfile.findMany({ where: { workerProfileId: { in: [...paidWorkerIds] } }, orderBy: { effectiveStartDate: "asc" } }),
      this.prisma.workerProfile.findMany({
        where: { id: { in: workerIds }, organizationId },
        select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } },
      }),
      this.prisma.shift.findMany({
        where: { id: { in: [...new Set(approved.map((entry) => entry.shiftId))] }, organizationId },
        select: { id: true, title: true, shiftType: true, projectId: true, siteId: true, project: { select: { name: true } }, site: { select: { name: true } } },
      }),
      // The emergency -60 / +15 minutes, of the few entries that are call-outs.
      emergencyEntryIds.length > 0
        ? this.prisma.emergencyCallout.findMany({
            where: { timeEntryId: { in: emergencyEntryIds } },
            select: { timeEntryId: true, retroactiveMinutes: true, returnBufferMinutes: true },
          })
        : [],
    ]);
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    const calloutByEntry = new Map(callouts.map((callout) => [callout.timeEntryId, callout]));
    const shiftOf = (entry: EntryRow) => {
      const shift = shiftById.get(entry.shiftId);
      if (!shift) throw new Error(`Shift ${entry.shiftId} of time entry ${entry.id} not found.`);
      return shift;
    };

    const workers: SnapshotWorkerName[] = workerRows
      .map((row) => ({ workerProfileId: row.id, fullLegalName: row.membership.user.fullLegalName }))
      .sort((a, b) => a.fullLegalName.localeCompare(b.fullLegalName, "ar"));
    const nameById = new Map(workers.map((w) => [w.workerProfileId, w.fullLegalName]));
    const nameOf = (id: string) => nameById.get(id) ?? "";
    const byWorker = pending
      .map((row) => ({ workerProfileId: row.workerProfileId, fullLegalName: nameOf(row.workerProfileId), entries: row._count._all }))
      .sort((a, b) => a.fullLegalName.localeCompare(b.fullLegalName, "ar"));

    const figures: PayrollFigureInputs = {
      entries: approved.map((entry) => {
        const shift = shiftOf(entry);
        const callout = calloutByEntry.get(entry.id);
        return {
          timeEntryId: entry.id,
          workerProfileId: entry.workerProfileId,
          businessDate: entry.businessDate,
          approvedRegularMinutes: entry.approvedRegularMinutes ?? 0,
          approvedOvertimeMinutes: entry.approvedOvertimeMinutes ?? 0,
          fullDayCredit: entry.fullDayCredit,
          isEmergency: entry.isEmergency,
          emergencyRetroactiveMinutes: entry.isEmergency ? (callout?.retroactiveMinutes ?? 0) : 0,
          emergencyReturnMinutes: entry.isEmergency ? (callout?.returnBufferMinutes ?? 0) : 0,
          projectId: shift.projectId,
          siteId: shift.siteId,
          shift: { id: shift.id, title: shift.title, shiftType: shift.shiftType },
          projectName: shift.project?.name ?? null,
          siteName: shift.site?.name ?? null,
        };
      }),
      compensationProfiles: profiles.map(toEngineProfile),
      adjustments: adjustments.map((adjustment) => ({
        id: adjustment.id,
        workerProfileId: adjustment.workerProfileId,
        type: adjustment.type,
        source: adjustment.source,
        amountAgorot: adjustment.amountAgorot,
        reason: adjustment.reason,
        relatedInfractionId: adjustment.relatedInfractionId,
        timeEntryId: adjustment.relatedInfraction?.timeEntryId ?? null,
        reversalOfId: adjustment.reversalOfId,
        createdBy: adjustment.createdBy,
        createdAt: adjustment.createdAt.toISOString(),
      })),
      workers,
      pending: { entries: byWorker.reduce((sum, row) => sum + row.entries, 0), byWorker },
      // The rule versions the entries are priced with (every organization has at least its first one).
      workRules: workRuleVersions,
    };
    return { rows: approved, figures, profiles, workRuleVersions };
  }

  /** The same fingerprint as `load`, from the live records, without loading them in full. */
  async liveInputsHash(organizationId: string, yearMonth: string): Promise<string> {
    const [entries, adjustments, workRuleVersions] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { organizationId, status: TimeEntryStatus.APPROVED, businessDate: businessMonthDates(yearMonth) },
        select: { id: true, updatedAt: true, workerProfileId: true },
      }),
      this.prisma.payrollAdjustment.findMany({ where: { organizationId, businessMonth: yearMonth }, select: { id: true, workerProfileId: true } }),
      this.workRules.versions(organizationId),
    ]);
    const paidWorkerIds = [...new Set([...entries.map((entry) => entry.workerProfileId), ...adjustments.map((adjustment) => adjustment.workerProfileId)])];
    const profiles = await this.prisma.compensationProfile.findMany({
      where: { workerProfileId: { in: paidWorkerIds } },
      select: { id: true, updatedAt: true },
    });
    return payrollInputsHash({ entries, adjustmentIds: adjustments.map((adjustment) => adjustment.id), profiles, workRuleVersionIds: workRuleVersions.map((version) => version.id) });
  }
}
