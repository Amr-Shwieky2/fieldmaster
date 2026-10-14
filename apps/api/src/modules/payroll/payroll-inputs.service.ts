import { Injectable } from "@nestjs/common";
import type { CompensationProfile } from "@prisma/client";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import type { PayrollCompensationProfile } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { PAYROLL_SNAPSHOT_SCHEMA_VERSION, payrollInputsHash, type PayrollSnapshotInputs, type SnapshotWorkerName } from "./payroll-snapshot";

/** Entries a calculation leaves out because they still wait for a decision. */
export const PENDING_ENTRY_STATUSES = [TimeEntryStatus.PENDING_APPROVAL, TimeEntryStatus.CORRECTION_REQUESTED];

/** "2026-10" -> the `startsWith` prefix of its business dates. */
const monthPrefix = (yearMonth: string) => `${yearMonth}-`;

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

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

  async load(
    organizationId: string,
    yearMonth: string,
    options: { workerProfileId?: string } = {},
  ): Promise<{ inputs: PayrollSnapshotInputs; inputsHash: string }> {
    const worker = options.workerProfileId ? { workerProfileId: options.workerProfileId } : {};
    const [approved, pending, adjustments, workRuleVersions] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { organizationId, status: TimeEntryStatus.APPROVED, businessDate: { startsWith: monthPrefix(yearMonth) }, ...worker },
        select: {
          id: true,
          workerProfileId: true,
          businessDate: true,
          clockInAt: true,
          clockOutAt: true,
          approvedRegularMinutes: true,
          approvedOvertimeMinutes: true,
          fullDayCredit: true,
          isEmergency: true,
          updatedAt: true,
          shift: {
            select: {
              id: true,
              title: true,
              shiftType: true,
              projectId: true,
              siteId: true,
              project: { select: { name: true } },
              site: { select: { name: true } },
            },
          },
          emergencyCallout: { select: { retroactiveMinutes: true, returnBufferMinutes: true } },
        },
        orderBy: [{ businessDate: "asc" }, { clockInAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.timeEntry.groupBy({
        by: ["workerProfileId"],
        where: { organizationId, status: { in: PENDING_ENTRY_STATUSES }, businessDate: { startsWith: monthPrefix(yearMonth) }, ...worker },
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
    const [profiles, workerRows] = await Promise.all([
      this.prisma.compensationProfile.findMany({ where: { workerProfileId: { in: [...paidWorkerIds] } }, orderBy: { effectiveStartDate: "asc" } }),
      this.prisma.workerProfile.findMany({
        where: { id: { in: workerIds }, organizationId },
        select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } },
      }),
    ]);

    const workers: SnapshotWorkerName[] = workerRows
      .map((row) => ({ workerProfileId: row.id, fullLegalName: row.membership.user.fullLegalName }))
      .sort((a, b) => a.fullLegalName.localeCompare(b.fullLegalName, "ar"));
    const nameOf = (workerProfileId: string) => workers.find((w) => w.workerProfileId === workerProfileId)?.fullLegalName ?? "";
    const byWorker = pending
      .map((row) => ({ workerProfileId: row.workerProfileId, fullLegalName: nameOf(row.workerProfileId), entries: row._count._all }))
      .sort((a, b) => a.fullLegalName.localeCompare(b.fullLegalName, "ar"));

    const inputs: PayrollSnapshotInputs = {
      schemaVersion: PAYROLL_SNAPSHOT_SCHEMA_VERSION,
      yearMonth,
      entries: approved.map((entry) => ({
        timeEntryId: entry.id,
        workerProfileId: entry.workerProfileId,
        businessDate: entry.businessDate,
        approvedRegularMinutes: entry.approvedRegularMinutes ?? 0,
        approvedOvertimeMinutes: entry.approvedOvertimeMinutes ?? 0,
        fullDayCredit: entry.fullDayCredit,
        isEmergency: entry.isEmergency,
        emergencyRetroactiveMinutes: entry.isEmergency ? (entry.emergencyCallout?.retroactiveMinutes ?? 0) : 0,
        emergencyReturnMinutes: entry.isEmergency ? (entry.emergencyCallout?.returnBufferMinutes ?? 0) : 0,
        projectId: entry.shift.projectId,
        siteId: entry.shift.siteId,
        shift: { id: entry.shift.id, title: entry.shift.title, shiftType: entry.shift.shiftType },
        projectName: entry.shift.project?.name ?? null,
        siteName: entry.shift.site?.name ?? null,
        clockInAt: entry.clockInAt?.toISOString() ?? null,
        clockOutAt: entry.clockOutAt?.toISOString() ?? null,
        updatedAt: entry.updatedAt.toISOString(),
      })),
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
      // The rule versions the entries are priced with (only when the organization has changed a rule: none = the defaults).
      ...(workRuleVersions.length > 0 ? { workRules: workRuleVersions } : {}),
    };

    return {
      inputs,
      inputsHash: payrollInputsHash({
        entries: approved,
        adjustmentIds: adjustments.map((adjustment) => adjustment.id),
        profiles,
        workRuleVersionIds: workRuleVersions.map((version) => version.id),
      }),
    };
  }

  /** The same fingerprint as `load`, from the live records, without loading them in full. */
  async liveInputsHash(organizationId: string, yearMonth: string): Promise<string> {
    const [entries, adjustments, workRuleVersions] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { organizationId, status: TimeEntryStatus.APPROVED, businessDate: { startsWith: monthPrefix(yearMonth) } },
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
