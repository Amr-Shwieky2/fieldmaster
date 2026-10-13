import { commonText, rd } from "../render/messages";
import { dataTable, fmt, markup, rdHtml, section, userText, type CellValue, type SafeHtml } from "../render/html";
import { buildCsv, csv, unitHeader, type CsvCell } from "../render/csv";
import { operationalNotice, projectText, shiftTitle, shiftTitleText, siteText, standardHeader, summaryBlock } from "./common";
import type { ReportDocumentMeta } from "../report.types";
import type { OvertimeFinancialData, OvertimeOperationalData, OvertimeRow } from "../data/overtime.data";

/**
 * The overtime report. The operational version (Field Manager) renders
 * `OvertimeOperationalData` (minutes only); the financial version (Owner)
 * renders `OvertimeFinancialData`, which adds the overtime pay.
 */

function entryColumns(): string[] {
  return [
    rd("columns.date"),
    rd("columns.worker"),
    rd("columns.shift"),
    rd("columns.project"),
    rd("columns.site"),
    rd("columns.worked"),
    rd("columns.approvedRegular"),
    rd("columns.approvedOvertime"),
  ];
}

function entryCells(row: OvertimeRow): CellValue[] {
  return [
    fmt.date(row.businessDate),
    userText(row.workerName),
    shiftTitle(row.shiftTitle, row.shiftType),
    userText(projectText(row.projectName)),
    userText(siteText(row.siteName)),
    fmt.minutes(row.workedMinutes),
    fmt.minutes(row.approvedRegularMinutes),
    markup`<strong>${fmt.minutes(row.approvedOvertimeMinutes)}</strong>`,
  ];
}

function pendingNote(pending: { entries: number; expectedOvertimeMinutes: number }): SafeHtml {
  if (pending.entries === 0) return markup`<p class="note">${rd("overtime.approvedOnly")}</p>`;
  return markup`<p class="note">
    ${rd("overtime.approvedOnly")}
    ${rdHtml("overtime.pendingNote", { count: fmt.number(pending.entries), minutes: fmt.minutes(pending.expectedOvertimeMinutes) })}
  </p>`;
}

export function overtimeOperationalBody(data: OvertimeOperationalData, meta: ReportDocumentMeta): SafeHtml {
  return markup`${standardHeader(meta)} ${operationalNotice()}
  ${summaryBlock(rd("common.summary"), [
    [rd("overtime.summary.entries"), fmt.number(data.totals.entries)],
    [rd("overtime.summary.minutes"), fmt.minutes(data.totals.overtimeMinutes)],
    [rd("overtime.summary.workers"), fmt.number(data.workers.length)],
    [rd("overtime.summary.pendingEntries"), fmt.number(data.pending.entries)],
  ])}
  ${pendingNote(data.pending)}
  ${section(
    rd("overtime.byWorkerTitle"),
    dataTable(
      [rd("columns.worker"), rd("columns.entries"), commonText("overtime")],
      data.workers.map((worker) => [userText(worker.workerName), fmt.number(worker.entries), fmt.minutes(worker.overtimeMinutes)]),
      { totals: [rd("common.totalRow"), fmt.number(data.totals.entries), fmt.minutes(data.totals.overtimeMinutes)] },
    ),
  )}
  ${section(rd("overtime.entriesTitle"), dataTable(entryColumns(), data.rows.map(entryCells)))}`;
}

export function overtimeFinancialBody(data: OvertimeFinancialData, meta: ReportDocumentMeta): SafeHtml {
  return markup`${standardHeader(meta)}
  ${summaryBlock(rd("common.summary"), [
    [rd("overtime.summary.entries"), fmt.number(data.totals.entries)],
    [rd("overtime.summary.minutes"), fmt.minutes(data.totals.overtimeMinutes)],
    [rd("overtime.summary.pay"), markup`<strong>${fmt.money(data.totals.overtimePayAgorot)}</strong>`],
    [rd("overtime.summary.workers"), fmt.number(data.workers.length)],
    [rd("overtime.summary.pendingEntries"), fmt.number(data.pending.entries)],
    [rd("overtime.summary.withoutCompensation"), fmt.number(data.totals.entriesWithoutCompensation)],
  ])}
  ${pendingNote(data.pending)}
  ${section(
    rd("overtime.byWorkerTitle"),
    dataTable(
      [rd("columns.worker"), rd("columns.entries"), commonText("overtime"), rd("columns.overtimePay")],
      data.workers.map((worker) => [
        userText(worker.workerName),
        fmt.number(worker.entries),
        fmt.minutes(worker.overtimeMinutes),
        fmt.money(worker.overtimePayAgorot),
      ]),
      {
        totals: [rd("common.totalRow"), fmt.number(data.totals.entries), fmt.minutes(data.totals.overtimeMinutes), fmt.money(data.totals.overtimePayAgorot)],
      },
    ),
  )}
  ${section(
    rd("overtime.entriesTitle"),
    dataTable(
      [...entryColumns(), rd("columns.overtimePay")],
      data.rows.map((row) => [
        ...entryCells(row),
        row.overtimePayAgorot === null ? rd("values.payStatus.NO_COMPENSATION_PROFILE") : fmt.money(row.overtimePayAgorot),
      ]),
    ),
  )}`;
}

function csvHeader(): string[] {
  return [
    rd("columns.date"),
    rd("columns.worker"),
    rd("columns.shift"),
    rd("columns.project"),
    rd("columns.site"),
    commonText("clockIn"),
    commonText("clockOut"),
    unitHeader.minutes(rd("columns.worked")),
    unitHeader.minutes(rd("columns.approvedRegular")),
    unitHeader.minutes(rd("columns.approvedOvertime")),
  ];
}

function csvCells(row: OvertimeRow): CsvCell[] {
  return [
    csv.date(row.businessDate),
    row.workerName,
    shiftTitleText(row.shiftTitle, row.shiftType),
    projectText(row.projectName),
    siteText(row.siteName),
    csv.dateTime(row.clockInAt),
    csv.dateTime(row.clockOutAt),
    row.workedMinutes,
    row.approvedRegularMinutes,
    row.approvedOvertimeMinutes,
  ];
}

export function overtimeOperationalCsv(data: OvertimeOperationalData): string {
  return buildCsv(csvHeader(), data.rows.map(csvCells));
}

export function overtimeFinancialCsv(data: OvertimeFinancialData): string {
  const header = [...csvHeader(), rd("columns.compensationType"), unitHeader.shekels(rd("columns.overtimePay"))];
  const rows = data.rows.map((row) => [
    ...csvCells(row),
    row.compensationType ? csv.label("CompensationType", row.compensationType) : rd("values.payStatus.NO_COMPENSATION_PROFILE"),
    csv.money(row.overtimePayAgorot),
  ]);
  const totals: CsvCell[] = [
    rd("common.totalRow"),
    ...new Array<CsvCell>(8).fill(null),
    data.totals.overtimeMinutes,
    null,
    csv.money(data.totals.overtimePayAgorot),
  ];
  return buildCsv(header, [...rows, totals]);
}
