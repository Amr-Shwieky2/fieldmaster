import type { Prisma } from "@prisma/client";
import type { ReportDataDeps, ReportLoadContext } from "../report.types";

/**
 * The emergency call-out report: each call-out whose entry falls in the
 * period (as the call-out list filters them), with its authorization, the
 * actual clicks, the compensated window (-60 / +15 minutes) and the daily
 * summary. The financial version (Owner) adds each call-out's cost, the
 * same estimate the Owner's call-out screen shows
 * (`AttendanceCostService.estimateEntry`).
 */

export interface CalloutRow {
  calloutId: string;
  workerProfileId: string;
  workerName: string;
  businessDate: string | null;
  status: string | null;
  authorizationSource: string;
  authorizedByName: string | null;
  turanType: string | null;
  actualStartClick: string;
  actualEndClick: string | null;
  compensatedStart: string;
  compensatedEnd: string | null;
  actualWorkedMinutes: number | null;
  retroactiveMinutes: number;
  returnBufferMinutes: number | null;
  compensatedDurationMinutes: number | null;
  summaryText: string | null;
  summaryCategory: string | null;
}

export interface EmergencyOperationalData {
  rows: CalloutRow[];
  totals: { callouts: number; actualWorkedMinutes: number; compensatedMinutes: number };
}

export interface CalloutFinancialRow extends CalloutRow {
  /** How the cost was obtained (APPROVED, ESTIMATED, OPEN, REJECTED, NO_COMPENSATION_PROFILE). */
  costBasis: string | null;
  costAgorot: number | null;
}

export interface EmergencyFinancialData {
  rows: CalloutFinancialRow[];
  totals: { callouts: number; actualWorkedMinutes: number; compensatedMinutes: number; costAgorot: number };
}

const CALLOUT_SELECT = {
  id: true,
  workerProfileId: true,
  timeEntryId: true,
  authorizationSource: true,
  authorizedBy: true,
  actualStartClick: true,
  compensatedStart: true,
  actualEndClick: true,
  compensatedEnd: true,
  actualWorkedMinutes: true,
  retroactiveMinutes: true,
  returnBufferMinutes: true,
  compensatedDurationMinutes: true,
  worker: { select: { membership: { select: { user: { select: { fullLegalName: true } } } } } },
  turanAssignment: { select: { turanType: true } },
  timeEntry: { select: { status: true, businessDate: true, dailySummary: { select: { text: true, taskCategory: true } } } },
} satisfies Prisma.EmergencyCalloutSelect;

export async function loadEmergencyOperational(deps: ReportDataDeps, context: ReportLoadContext): Promise<EmergencyOperationalData> {
  const { filters } = context;
  const callouts = await deps.prisma.emergencyCallout.findMany({
    where: {
      organizationId: context.organizationId,
      ...(filters.workerProfileId ? { workerProfileId: filters.workerProfileId } : {}),
      timeEntry: { businessDate: { gte: filters.fromDate, lte: filters.toDate } },
    },
    select: CALLOUT_SELECT,
    orderBy: [{ actualStartClick: "asc" }, { id: "asc" }],
  });

  const authorizerIds = [...new Set(callouts.map((callout) => callout.authorizedBy).filter((id): id is string => id !== null))];
  const authorizers =
    authorizerIds.length > 0 ? await deps.prisma.user.findMany({ where: { id: { in: authorizerIds } }, select: { id: true, fullLegalName: true } }) : [];
  const nameOf = (id: string | null) => (id ? (authorizers.find((user) => user.id === id)?.fullLegalName ?? null) : null);

  const rows: CalloutRow[] = callouts.map((callout) => ({
    calloutId: callout.id,
    workerProfileId: callout.workerProfileId,
    workerName: callout.worker.membership.user.fullLegalName,
    businessDate: callout.timeEntry?.businessDate ?? null,
    status: callout.timeEntry?.status ?? null,
    authorizationSource: callout.authorizationSource,
    authorizedByName: nameOf(callout.authorizedBy),
    turanType: callout.turanAssignment?.turanType ?? null,
    actualStartClick: callout.actualStartClick.toISOString(),
    actualEndClick: callout.actualEndClick?.toISOString() ?? null,
    compensatedStart: callout.compensatedStart.toISOString(),
    compensatedEnd: callout.compensatedEnd?.toISOString() ?? null,
    actualWorkedMinutes: callout.actualWorkedMinutes,
    retroactiveMinutes: callout.retroactiveMinutes,
    returnBufferMinutes: callout.returnBufferMinutes,
    compensatedDurationMinutes: callout.compensatedDurationMinutes,
    summaryText: callout.timeEntry?.dailySummary?.text ?? null,
    summaryCategory: callout.timeEntry?.dailySummary?.taskCategory ?? null,
  }));

  return {
    rows,
    totals: {
      callouts: rows.length,
      actualWorkedMinutes: rows.reduce((sum, row) => sum + (row.actualWorkedMinutes ?? 0), 0),
      compensatedMinutes: rows.reduce((sum, row) => sum + (row.compensatedDurationMinutes ?? 0), 0),
    },
  };
}

export async function loadEmergencyFinancial(deps: ReportDataDeps, context: ReportLoadContext): Promise<EmergencyFinancialData> {
  const operational = await loadEmergencyOperational(deps, context);
  const callouts = await deps.prisma.emergencyCallout.findMany({
    where: { id: { in: operational.rows.map((row) => row.calloutId) } },
    select: {
      id: true,
      timeEntry: {
        select: {
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
        },
      },
    },
  });
  const entryOf = new Map(callouts.map((callout) => [callout.id, callout.timeEntry]));

  const rows: CalloutFinancialRow[] = [];
  for (const row of operational.rows) {
    const entry = entryOf.get(row.calloutId);
    const estimate = entry ? await deps.attendanceCost.estimateEntry(entry, context.organizationId) : null;
    rows.push({ ...row, costBasis: estimate?.basis ?? null, costAgorot: estimate?.estimatedCostAgorot ?? null });
  }
  return {
    rows,
    totals: { ...operational.totals, costAgorot: rows.reduce((sum, row) => sum + (row.costAgorot ?? 0), 0) },
  };
}
