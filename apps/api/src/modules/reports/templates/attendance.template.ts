import { EM_DASH } from "@fieldmaster/i18n/node";
import { commonText, enumLabel, rd } from "../render/messages";
import { dataTable, fmt, markup, section, userText, type CellValue, type SafeHtml } from "../render/html";
import { buildCsv, csv, unitHeader } from "../render/csv";
import { operationalNotice, projectText, shiftTitle, shiftTitleText, siteText, standardHeader, summaryBlock } from "./common";
import type { ReportDocumentMeta } from "../report.types";
import type { OperationalAttendanceData } from "../data/attendance.data";

/** The operational attendance report (Owner and Field Manager alike; never any money). */

export function attendanceBody(data: OperationalAttendanceData, meta: ReportDocumentMeta): SafeHtml {
  const { summary } = data;
  const pairs: [string, CellValue][] = [
    [rd("attendance.summary.entries"), fmt.number(summary.entries)],
    [rd("attendance.summary.workers"), fmt.number(summary.workers)],
    ...summary.byStatus.map(({ status, count }): [string, CellValue] => [enumLabel("TimeEntryStatus", status), fmt.number(count)]),
    [rd("attendance.summary.worked"), fmt.minutes(summary.workedMinutes)],
    [rd("attendance.summary.approvedRegular"), fmt.minutes(summary.approvedRegularMinutes)],
    [rd("attendance.summary.approvedOvertime"), fmt.minutes(summary.approvedOvertimeMinutes)],
    [rd("attendance.summary.flagged"), fmt.number(summary.flaggedEntries)],
    ...summary.byFlag.map(({ flag, count }): [string, CellValue] => [enumLabel("AttendanceFlag", flag), fmt.number(count)]),
  ];
  const table = dataTable(
    [
      rd("columns.date"),
      rd("columns.worker"),
      rd("columns.shift"),
      rd("columns.project"),
      rd("columns.site"),
      commonText("clockIn"),
      commonText("clockOut"),
      rd("columns.worked"),
      rd("columns.status"),
      rd("columns.approvedRegular"),
      rd("columns.approvedOvertime"),
      rd("columns.flags"),
    ],
    data.rows.map((row) => [
      fmt.date(row.businessDate),
      userText(row.workerName),
      shiftTitle(row.shiftTitle, row.shiftType),
      userText(projectText(row.projectName)),
      userText(siteText(row.siteName)),
      row.clockInAt ? fmt.time(row.clockInAt) : EM_DASH,
      row.clockOutAt ? fmt.time(row.clockOutAt) : rd("common.notEnded"),
      fmt.minutes(row.workedMinutes),
      enumLabel("TimeEntryStatus", row.status),
      fmt.minutes(row.approvedRegularMinutes),
      fmt.minutes(row.approvedOvertimeMinutes),
      row.flags.length > 0 ? markup`${row.flags.map((flag) => markup`<span class="tag">${enumLabel("AttendanceFlag", flag)}</span> `)}` : EM_DASH,
    ]),
  );
  return markup`${standardHeader(meta)} ${operationalNotice()} ${summaryBlock(rd("common.summary"), pairs)} ${section(rd("attendance.entriesTitle"), table)}`;
}

export function attendanceCsv(data: OperationalAttendanceData): string {
  const separator = rd("values.listSeparator");
  return buildCsv(
    [
      rd("columns.date"),
      rd("columns.worker"),
      rd("columns.shift"),
      rd("columns.shiftType"),
      rd("columns.project"),
      rd("columns.site"),
      rd("columns.checkInMethod"),
      commonText("clockIn"),
      commonText("clockOut"),
      unitHeader.minutes(rd("columns.duration")),
      unitHeader.minutes(rd("columns.worked")),
      rd("columns.status"),
      unitHeader.minutes(rd("columns.approvedRegular")),
      unitHeader.minutes(rd("columns.approvedOvertime")),
      commonText("creditAsFullDay"),
      rd("columns.flags"),
    ],
    data.rows.map((row) => [
      csv.date(row.businessDate),
      row.workerName,
      shiftTitleText(row.shiftTitle, row.shiftType),
      csv.label("ShiftType", row.shiftType),
      projectText(row.projectName),
      siteText(row.siteName),
      csv.label("CheckInMethod", row.checkInMethod),
      csv.dateTime(row.clockInAt),
      csv.dateTime(row.clockOutAt),
      row.rawDurationMinutes,
      row.workedMinutes,
      csv.label("TimeEntryStatus", row.status),
      row.approvedRegularMinutes,
      row.approvedOvertimeMinutes,
      csv.yesNo(row.fullDayCredit),
      row.flags.map((flag) => enumLabel("AttendanceFlag", flag)).join(separator),
    ]),
  );
}
