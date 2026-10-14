import { AttendanceListTab, TimeEntryStatus } from "@fieldmaster/shared-types";
import { MAX_PAGE_SIZE } from "../../../common/validation/patterns";
import type { ListAttendanceQueryDto } from "../../attendance/dto/attendance-list.dto";
import type { ReportDataDeps, ReportLoadContext } from "../report.types";
import { reportScope } from "../report-scope";

/**
 * The operational attendance report: every entry in the period (optionally
 * one project, site or worker) as the admin attendance list shows it --
 * read through `AttendanceRecordsService.list`, so the flags are the list's
 * own rules -- and summary counts. No money for anyone.
 */

export interface AttendanceRow {
  timeEntryId: string;
  businessDate: string;
  workerProfileId: string;
  workerName: string;
  shiftTitle: string;
  shiftType: string;
  projectName: string | null;
  siteName: string | null;
  checkInMethod: string;
  status: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  rawDurationMinutes: number | null;
  workedMinutes: number | null;
  approvedRegularMinutes: number | null;
  approvedOvertimeMinutes: number | null;
  fullDayCredit: boolean;
  isEmergency: boolean;
  flags: string[];
}

export interface OperationalAttendanceData {
  rows: AttendanceRow[];
  summary: {
    entries: number;
    workers: number;
    byStatus: { status: string; count: number }[];
    workedMinutes: number;
    approvedRegularMinutes: number;
    approvedOvertimeMinutes: number;
    flaggedEntries: number;
    byFlag: { flag: string; count: number }[];
  };
}

const STATUS_ORDER: string[] = [
  TimeEntryStatus.APPROVED,
  TimeEntryStatus.PENDING_APPROVAL,
  TimeEntryStatus.CORRECTION_REQUESTED,
  TimeEntryStatus.REJECTED,
  TimeEntryStatus.ACTIVE,
];

export async function loadOperationalAttendance(deps: ReportDataDeps, context: ReportLoadContext): Promise<OperationalAttendanceData> {
  const { filters } = context;
  const query: ListAttendanceQueryDto = {
    tab: AttendanceListTab.ALL,
    from: filters.fromDate,
    to: filters.toDate,
    ...(filters.workerProfileId ? { workerProfileId: filters.workerProfileId } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
    pageSize: MAX_PAGE_SIZE,
  };

  const byId = new Map<string, AttendanceRow>();
  for (let page = 1; ; page += 1) {
    const result = await deps.attendanceRecords.list(context.organizationId, { ...query, page }, reportScope(filters));
    for (const item of result.items) {
      const workedMinutes = item.rawDurationMinutes === null ? null : Math.max(0, item.rawDurationMinutes - item.unpaidBreakMinutes);
      byId.set(item.id, {
        timeEntryId: item.id,
        businessDate: item.businessDate,
        workerProfileId: item.worker.id,
        workerName: item.worker.fullLegalName,
        shiftTitle: item.shift.title,
        shiftType: item.shift.shiftType,
        projectName: item.shift.project?.name ?? null,
        siteName: item.shift.site?.name ?? null,
        checkInMethod: item.checkInMethod,
        status: item.status,
        clockInAt: item.clockInAt?.toISOString() ?? null,
        clockOutAt: item.clockOutAt?.toISOString() ?? null,
        rawDurationMinutes: item.rawDurationMinutes,
        workedMinutes,
        approvedRegularMinutes: item.status === TimeEntryStatus.APPROVED ? item.approvedRegularMinutes : null,
        approvedOvertimeMinutes: item.status === TimeEntryStatus.APPROVED ? item.approvedOvertimeMinutes : null,
        fullDayCredit: item.fullDayCredit,
        isEmergency: item.isEmergency,
        flags: [...item.flags],
      });
    }
    if (result.items.length === 0 || page * result.pageSize >= result.total) break;
  }

  // Oldest first: the order of a day-by-day record.
  const rows = [...byId.values()].sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) ||
      (a.clockInAt ?? "").localeCompare(b.clockInAt ?? "") ||
      a.workerName.localeCompare(b.workerName, "ar") ||
      a.timeEntryId.localeCompare(b.timeEntryId),
  );

  const statusCounts = new Map<string, number>();
  const flagCounts = new Map<string, number>();
  for (const row of rows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    for (const flag of row.flags) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
  }
  const statusRank = (status: string) => (STATUS_ORDER.includes(status) ? STATUS_ORDER.indexOf(status) : STATUS_ORDER.length);

  return {
    rows,
    summary: {
      entries: rows.length,
      workers: new Set(rows.map((row) => row.workerProfileId)).size,
      byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => statusRank(a.status) - statusRank(b.status)),
      workedMinutes: rows.reduce((sum, row) => sum + (row.workedMinutes ?? 0), 0),
      approvedRegularMinutes: rows.reduce((sum, row) => sum + (row.approvedRegularMinutes ?? 0), 0),
      approvedOvertimeMinutes: rows.reduce((sum, row) => sum + (row.approvedOvertimeMinutes ?? 0), 0),
      flaggedEntries: rows.filter((row) => row.flags.length > 0).length,
      byFlag: [...flagCounts.entries()].map(([flag, count]) => ({ flag, count })).sort((a, b) => a.flag.localeCompare(b.flag)),
    },
  };
}
