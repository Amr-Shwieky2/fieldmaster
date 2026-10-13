import { EM_DASH } from "@fieldmaster/i18n/node";
import { enumLabel, rd } from "../render/messages";
import { dataTable, fmt, markup, rdHtml, section, userText, type CellValue, type SafeHtml } from "../render/html";
import { buildCsv, csv, unitHeader, type CsvCell } from "../render/csv";
import { operationalNotice, standardHeader, summaryBlock } from "./common";
import type { ReportDocumentMeta } from "../report.types";
import type { CalloutRow, EmergencyFinancialData, EmergencyOperationalData } from "../data/emergency-callouts.data";

/**
 * The emergency call-out report. The operational version (Field Manager)
 * renders `EmergencyOperationalData`; the financial version (Owner) renders
 * `EmergencyFinancialData`, which adds each call-out's cost.
 */

function authorization(row: CalloutRow): SafeHtml {
  return markup`${enumLabel("EmergencyAuthorizationSource", row.authorizationSource)}${
    row.authorizedByName ? markup`<br />${rdHtml("emergency.authorizedBy", { name: userText(row.authorizedByName) })}` : ""
  }`;
}

function columns(): string[] {
  return [
    rd("columns.worker"),
    rd("columns.date"),
    rd("columns.authorization"),
    rd("emergency.actualStartShort"),
    rd("emergency.actualEndShort"),
    rd("emergency.compensatedStartShort"),
    rd("emergency.compensatedEndShort"),
    rd("emergency.actualWorked"),
    rd("emergency.retroactive"),
    rd("emergency.returnBuffer"),
    rd("emergency.totalCompensated"),
    rd("columns.status"),
  ];
}

function cells(row: CalloutRow): CellValue[] {
  return [
    userText(row.workerName),
    fmt.date(row.businessDate),
    authorization(row),
    fmt.dateTime(row.actualStartClick),
    row.actualEndClick ? fmt.dateTime(row.actualEndClick) : rd("common.notEnded"),
    fmt.dateTime(row.compensatedStart),
    row.compensatedEnd ? fmt.dateTime(row.compensatedEnd) : EM_DASH,
    fmt.minutes(row.actualWorkedMinutes),
    fmt.shortMinutes(row.retroactiveMinutes),
    fmt.shortMinutes(row.returnBufferMinutes),
    markup`<strong>${fmt.minutes(row.compensatedDurationMinutes)}</strong>`,
    enumLabel("TimeEntryStatus", row.status),
  ];
}

/** Each call-out's daily summary, under the table (summaries are free text). */
function summaries(rows: readonly CalloutRow[]): SafeHtml {
  return dataTable(
    [rd("columns.worker"), rd("emergency.actualStartShort"), rd("columns.category"), rd("emergency.summary")],
    rows.map((row) => [
      userText(row.workerName),
      fmt.dateTime(row.actualStartClick),
      row.summaryCategory ? enumLabel("TaskCategory", row.summaryCategory) : EM_DASH,
      markup`<span class="pre">${userText(row.summaryText)}</span>`,
    ]),
  );
}

export function emergencyOperationalBody(data: EmergencyOperationalData, meta: ReportDocumentMeta): SafeHtml {
  return markup`${standardHeader(meta)} ${operationalNotice()}
    ${summaryBlock(rd("common.summary"), [
      [rd("emergency.summaryCount"), fmt.number(data.totals.callouts)],
      [rd("emergency.actualWorked"), fmt.minutes(data.totals.actualWorkedMinutes)],
      [rd("emergency.totalCompensated"), fmt.minutes(data.totals.compensatedMinutes)],
    ])}
    <p class="note">${rd("emergency.rule")}</p>
    ${section(rd("emergency.listTitle"), dataTable(columns(), data.rows.map(cells)))}
    ${data.rows.length > 0 ? section(rd("emergency.summariesTitle"), summaries(data.rows)) : ""}`;
}

export function emergencyFinancialBody(data: EmergencyFinancialData, meta: ReportDocumentMeta): SafeHtml {
  return markup`${standardHeader(meta)}
    ${summaryBlock(rd("common.summary"), [
      [rd("emergency.summaryCount"), fmt.number(data.totals.callouts)],
      [rd("emergency.actualWorked"), fmt.minutes(data.totals.actualWorkedMinutes)],
      [rd("emergency.totalCompensated"), fmt.minutes(data.totals.compensatedMinutes)],
      [rd("emergency.totalCost"), markup`<strong>${fmt.money(data.totals.costAgorot)}</strong>`],
    ])}
    <p class="note">${rd("emergency.rule")} ${rd("emergency.costNote")}</p>
    ${section(
      rd("emergency.listTitle"),
      dataTable(
        [...columns(), rd("columns.cost")],
        data.rows.map((row) => [
          ...cells(row),
          markup`${fmt.money(row.costAgorot)}${row.costBasis ? markup`<br /><span class="muted">${rd(`values.costBasis.${row.costBasis}`)}</span>` : ""}`,
        ]),
      ),
    )}
    ${data.rows.length > 0 ? section(rd("emergency.summariesTitle"), summaries(data.rows)) : ""}`;
}

function csvHeader(): string[] {
  return [
    rd("columns.worker"),
    rd("columns.date"),
    rd("columns.authorization"),
    rd("columns.authorizedBy"),
    rd("emergency.actualStartShort"),
    rd("emergency.actualEndShort"),
    rd("emergency.compensatedStartShort"),
    rd("emergency.compensatedEndShort"),
    unitHeader.minutes(rd("emergency.actualWorked")),
    unitHeader.minutes(rd("emergency.retroactive")),
    unitHeader.minutes(rd("emergency.returnBuffer")),
    unitHeader.minutes(rd("emergency.totalCompensated")),
    rd("columns.status"),
    rd("columns.category"),
    rd("emergency.summary"),
  ];
}

function csvCells(row: CalloutRow): CsvCell[] {
  return [
    row.workerName,
    csv.date(row.businessDate),
    csv.label("EmergencyAuthorizationSource", row.authorizationSource),
    row.authorizedByName,
    csv.dateTime(row.actualStartClick),
    csv.dateTime(row.actualEndClick),
    csv.dateTime(row.compensatedStart),
    csv.dateTime(row.compensatedEnd),
    row.actualWorkedMinutes,
    row.retroactiveMinutes,
    row.returnBufferMinutes,
    row.compensatedDurationMinutes,
    csv.label("TimeEntryStatus", row.status),
    csv.label("TaskCategory", row.summaryCategory),
    row.summaryText,
  ];
}

export function emergencyOperationalCsv(data: EmergencyOperationalData): string {
  return buildCsv(csvHeader(), data.rows.map(csvCells));
}

export function emergencyFinancialCsv(data: EmergencyFinancialData): string {
  const header = [...csvHeader(), unitHeader.shekels(rd("columns.cost")), rd("columns.costBasis")];
  const rows = data.rows.map((row) => [...csvCells(row), csv.money(row.costAgorot), row.costBasis ? rd(`values.costBasis.${row.costBasis}`) : null]);
  const totals: CsvCell[] = [
    rd("common.totalRow"),
    ...new Array<CsvCell>(7).fill(null),
    data.totals.actualWorkedMinutes,
    null,
    null,
    data.totals.compensatedMinutes,
    null,
    null,
    null,
    csv.money(data.totals.costAgorot),
    null,
  ];
  return buildCsv(header, [...rows, totals]);
}
