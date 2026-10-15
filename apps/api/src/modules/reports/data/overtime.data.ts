import { reportShiftScope } from "../report-scope";
import type { Prisma } from "@prisma/client";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import { pickEffectiveCompensationProfile, splitWorkedMinutes } from "@fieldmaster/shared-validation";
import { PENDING_ENTRY_STATUSES, toEngineProfile } from "../../payroll/payroll-inputs.service";
import type { ReportDataDeps, ReportLoadContext } from "../report.types";

/**
 * The overtime report: approved entries with overtime in the period (the
 * minutes payroll pays), a per-worker summary, and how many entries still
 * waiting for approval would add overtime (counted, not listed). The
 * operational version has minutes only; the financial one (Owner) adds each
 * entry's overtime pay from `PayrollCalculationService` with the profile in
 * effect on the entry's date.
 */

export interface OvertimeRow {
  timeEntryId: string;
  businessDate: string;
  workerProfileId: string;
  workerName: string;
  shiftTitle: string;
  shiftType: string;
  projectName: string | null;
  siteName: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  workedMinutes: number | null;
  approvedRegularMinutes: number;
  approvedOvertimeMinutes: number;
  isEmergency: boolean;
}

export interface OvertimeWorker {
  workerProfileId: string;
  workerName: string;
  entries: number;
  overtimeMinutes: number;
}

export interface OvertimeOperationalData {
  rows: OvertimeRow[];
  workers: OvertimeWorker[];
  totals: { entries: number; overtimeMinutes: number };
  /** Entries waiting for approval whose recorded time would add overtime (not included above). */
  pending: { entries: number; expectedOvertimeMinutes: number };
}

export interface OvertimeFinancialRow extends OvertimeRow {
  compensationType: string | null;
  /** Null: no compensation profile on the entry's date (payroll pays nothing for it). */
  overtimePayAgorot: number | null;
}

export interface OvertimeFinancialWorker extends OvertimeWorker {
  overtimePayAgorot: number;
}

export interface OvertimeFinancialData {
  rows: OvertimeFinancialRow[];
  workers: OvertimeFinancialWorker[];
  totals: { entries: number; overtimeMinutes: number; overtimePayAgorot: number; entriesWithoutCompensation: number };
  pending: { entries: number; expectedOvertimeMinutes: number };
}

function entryFilter(context: ReportLoadContext): Prisma.TimeEntryWhereInput {
  const { filters } = context;
  const scoped = reportShiftScope(filters);
  const shift: Prisma.ShiftWhereInput = {
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
    ...(scoped ? { AND: [scoped] } : {}),
  };
  return {
    organizationId: context.organizationId,
    businessDate: { gte: filters.fromDate, lte: filters.toDate },
    ...(filters.workerProfileId ? { workerProfileId: filters.workerProfileId } : {}),
    ...(Object.keys(shift).length > 0 ? { shift } : {}),
  };
}

const ROW_SELECT = {
  id: true,
  businessDate: true,
  workerProfileId: true,
  clockInAt: true,
  clockOutAt: true,
  rawDurationMinutes: true,
  unpaidBreakMinutes: true,
  approvedRegularMinutes: true,
  approvedOvertimeMinutes: true,
  fullDayCredit: true,
  isEmergency: true,
  worker: { select: { membership: { select: { user: { select: { fullLegalName: true } } } } } },
  shift: { select: { title: true, shiftType: true, project: { select: { name: true } }, site: { select: { name: true } } } },
} satisfies Prisma.TimeEntrySelect;

export async function loadOvertimeOperational(deps: ReportDataDeps, context: ReportLoadContext): Promise<OvertimeOperationalData> {
  const where = entryFilter(context);
  const [entries, pendingEntries] = await Promise.all([
    deps.prisma.timeEntry.findMany({
      where: { ...where, status: TimeEntryStatus.APPROVED, approvedOvertimeMinutes: { gt: 0 } },
      select: ROW_SELECT,
      orderBy: [{ businessDate: "asc" }, { clockInAt: "asc" }, { id: "asc" }],
    }),
    deps.prisma.timeEntry.findMany({
      where: { ...where, status: { in: PENDING_ENTRY_STATUSES }, rawDurationMinutes: { not: null } },
      select: { businessDate: true, rawDurationMinutes: true, unpaidBreakMinutes: true, fullDayCredit: true },
    }),
  ]);

  const rows: OvertimeRow[] = entries.map((entry) => ({
    timeEntryId: entry.id,
    businessDate: entry.businessDate,
    workerProfileId: entry.workerProfileId,
    workerName: entry.worker.membership.user.fullLegalName,
    shiftTitle: entry.shift.title,
    shiftType: entry.shift.shiftType,
    projectName: entry.shift.project?.name ?? null,
    siteName: entry.shift.site?.name ?? null,
    clockInAt: entry.clockInAt?.toISOString() ?? null,
    clockOutAt: entry.clockOutAt?.toISOString() ?? null,
    workedMinutes: entry.rawDurationMinutes === null ? null : Math.max(0, entry.rawDurationMinutes - entry.unpaidBreakMinutes),
    approvedRegularMinutes: entry.approvedRegularMinutes ?? 0,
    approvedOvertimeMinutes: entry.approvedOvertimeMinutes ?? 0,
    isEmergency: entry.isEmergency,
  }));

  const byWorker = new Map<string, OvertimeWorker>();
  for (const row of rows) {
    const worker = byWorker.get(row.workerProfileId) ?? { workerProfileId: row.workerProfileId, workerName: row.workerName, entries: 0, overtimeMinutes: 0 };
    worker.entries += 1;
    worker.overtimeMinutes += row.approvedOvertimeMinutes;
    byWorker.set(row.workerProfileId, worker);
  }

  // Each waiting entry is split with the rules in force on its business date.
  const rules = await deps.workRules.resolver(context.organizationId);
  const expected = pendingEntries
    .map(
      (entry) =>
        splitWorkedMinutes(
          {
            rawDurationMinutes: entry.rawDurationMinutes ?? 0,
            unpaidBreakMinutes: entry.unpaidBreakMinutes,
            fullDayCredit: entry.fullDayCredit,
          },
          rules.rulesFor(entry.businessDate),
        ).overtimeMinutes,
    )
    .filter((minutes) => minutes > 0);

  return {
    rows,
    workers: [...byWorker.values()].sort((a, b) => a.workerName.localeCompare(b.workerName, "ar") || a.workerProfileId.localeCompare(b.workerProfileId)),
    totals: { entries: rows.length, overtimeMinutes: rows.reduce((sum, row) => sum + row.approvedOvertimeMinutes, 0) },
    pending: { entries: expected.length, expectedOvertimeMinutes: expected.reduce((sum, minutes) => sum + minutes, 0) },
  };
}

export async function loadOvertimeFinancial(deps: ReportDataDeps, context: ReportLoadContext): Promise<OvertimeFinancialData> {
  const operational = await loadOvertimeOperational(deps, context);
  const workerIds = operational.workers.map((worker) => worker.workerProfileId);
  const [profiles, entries] = await Promise.all([
    workerIds.length > 0
      ? deps.prisma.compensationProfile.findMany({ where: { workerProfileId: { in: workerIds } }, orderBy: [{ effectiveStartDate: "asc" }, { id: "asc" }] })
      : Promise.resolve([]),
    deps.prisma.timeEntry.findMany({
      where: { id: { in: operational.rows.map((row) => row.timeEntryId) } },
      select: { id: true, approvedRegularMinutes: true, approvedOvertimeMinutes: true, fullDayCredit: true },
    }),
  ]);
  const engineProfiles = profiles.map(toEngineProfile);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const rules = await deps.workRules.resolver(context.organizationId);

  const rows = operational.rows.map((row): OvertimeFinancialRow => {
    const effective = pickEffectiveCompensationProfile(engineProfiles, row.workerProfileId, row.businessDate);
    const profile = effective ? profiles.find((candidate) => candidate.id === effective.id) : undefined;
    const entry = entryById.get(row.timeEntryId);
    if (!profile || !entry) return { ...row, compensationType: null, overtimePayAgorot: null };
    const pay = deps.payrollCalculation.computeEntryCompensation(entry, profile, rules.rulesFor(row.businessDate));
    return { ...row, compensationType: profile.compensationType, overtimePayAgorot: pay.overtimeAgorot };
  });

  const workers = operational.workers.map((worker) => ({
    ...worker,
    overtimePayAgorot: rows.filter((row) => row.workerProfileId === worker.workerProfileId).reduce((sum, row) => sum + (row.overtimePayAgorot ?? 0), 0),
  }));
  return {
    rows,
    workers,
    totals: {
      ...operational.totals,
      overtimePayAgorot: workers.reduce((sum, worker) => sum + worker.overtimePayAgorot, 0),
      entriesWithoutCompensation: rows.filter((row) => row.overtimePayAgorot === null).length,
    },
    pending: operational.pending,
  };
}
