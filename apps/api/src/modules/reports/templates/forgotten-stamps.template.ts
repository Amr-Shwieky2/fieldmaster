import { EM_DASH, formatMonth } from "@fieldmaster/i18n/node";
import { enumLabel, rd } from "../render/messages";
import { dataTable, EMPTY, fmt, markup, rdHtml, userText, type CellValue, type SafeHtml } from "../render/html";
import { buildCsv, csv, unitHeader, type CsvCell } from "../render/csv";
import { operationalNotice, standardHeader, summaryBlock } from "./common";
import type { ReportDocumentMeta } from "../report.types";
import type { ForgottenStampsFinancialData, ForgottenStampsOperationalData, StampRow } from "../data/forgotten-stamps.data";

/**
 * The forgotten-stamp report. The operational version (Field Manager)
 * renders `ForgottenStampsOperationalData`: the infractions and counts, no
 * amount. The financial version (Owner) renders
 * `ForgottenStampsFinancialData`: the same rows plus deductions, reversals
 * and the net.
 */

function correctedField(field: string): string {
  return rd(`values.correctionField.${["clockInAt", "clockOutAt", "unpaidBreakMinutes"].includes(field) ? field : "other"}`);
}

function reversal(row: StampRow): SafeHtml {
  if (!row.reversedAt) return markup`${EM_DASH}`;
  return markup`${rdHtml("values.reversedAt", { time: fmt.dateTime(row.reversedAt), reason: userText(row.reversalReason) })}${
    row.reversedByName ? markup`<br />${rdHtml("values.by", { name: userText(row.reversedByName) })}` : EMPTY
  }`;
}

function columns(): string[] {
  return [
    rd("columns.sequence"),
    rd("columns.month"),
    rd("forgottenStamps.entryDate"),
    rd("forgottenStamps.correctedField"),
    rd("columns.reason"),
    rd("columns.by"),
    rd("columns.at"),
    rd("columns.reversal"),
  ];
}

function cells(row: StampRow): CellValue[] {
  return [
    rd("values.stampNumber", { number: row.sequence }),
    formatMonth(row.businessMonth),
    fmt.date(row.entryBusinessDate),
    correctedField(row.correctedField),
    markup`${enumLabel("CorrectionReason", row.correctionReason)}${row.correctionNote ? markup`<br /><span class="muted">${userText(row.correctionNote)}</span>` : EMPTY}`,
    userText(row.correctedByName),
    fmt.dateTime(row.correctedAt),
    reversal(row),
  ];
}

function workerTitle(name: string, counts: { infractions: number; reversed: number }): SafeHtml {
  return markup`<h3>${userText(name)} — ${rd("forgottenStamps.workerCounts", { infractions: counts.infractions, reversed: counts.reversed })}</h3>`;
}

export function forgottenStampsOperationalBody(data: ForgottenStampsOperationalData, meta: ReportDocumentMeta): SafeHtml {
  return markup`${standardHeader(meta)} ${operationalNotice()}
    ${summaryBlock(rd("common.summary"), [
      [rd("forgottenStamps.summary.workers"), fmt.number(data.totals.workers)],
      [rd("forgottenStamps.summary.infractions"), fmt.number(data.totals.infractions)],
      [rd("forgottenStamps.summary.reversed"), fmt.number(data.totals.reversed)],
    ])}
    <p class="note">${rd("forgottenStamps.rule")}</p>
    <section>
      <h2>${rd("forgottenStamps.byWorkerTitle")}</h2>
      ${data.workers.length === 0 ? markup`<p class="empty">${rd("common.noRecords")}</p>` : EMPTY}
      ${data.workers.map((worker) => markup`${workerTitle(worker.workerName, worker.counts)}${dataTable(columns(), worker.infractions.map(cells))}`)}
    </section>`;
}

export function forgottenStampsFinancialBody(data: ForgottenStampsFinancialData, meta: ReportDocumentMeta): SafeHtml {
  const { totals } = data;
  return markup`${standardHeader(meta)}
    ${summaryBlock(rd("common.summary"), [
      [rd("forgottenStamps.summary.workers"), fmt.number(totals.workers)],
      [rd("forgottenStamps.summary.infractions"), fmt.number(totals.infractions)],
      [rd("forgottenStamps.summary.reversed"), fmt.number(totals.reversed)],
      [rd("forgottenStamps.summary.deductions"), fmt.money(-totals.deductionsAgorot)],
      [rd("forgottenStamps.summary.reversals"), fmt.money(totals.reversalsAgorot)],
      [rd("forgottenStamps.summary.net"), markup`<strong>${fmt.money(totals.netAgorot)}</strong>`],
    ])}
    <p class="note">${rd("forgottenStamps.rule")}</p>
    <section>
      <h2>${rd("forgottenStamps.byWorkerTitle")}</h2>
      ${data.workers.length === 0 ? markup`<p class="empty">${rd("common.noRecords")}</p>` : EMPTY}
      ${data.workers.map(
        (worker) =>
          markup`${workerTitle(worker.workerName, worker.counts)}${dataTable(
            [...columns(), rd("columns.deduction"), rd("columns.reversalAmount")],
            worker.infractions.map((row) => [
              ...cells(row),
              row.deductionAgorot > 0 ? fmt.money(-row.deductionAgorot) : rd("values.noDeduction"),
              row.reversalAgorot > 0 ? fmt.money(row.reversalAgorot) : EM_DASH,
            ]),
            {
              totals: [
                rd("forgottenStamps.workerNet"),
                ...new Array<CellValue>(7).fill(""),
                fmt.money(-worker.money.deductionsAgorot),
                markup`${fmt.money(worker.money.reversalsAgorot)}<br /><strong
                    >${rdHtml("forgottenStamps.netValue", { amount: fmt.money(worker.money.netAgorot) })}</strong
                  >`,
              ],
            },
          )}`,
      )}
    </section>`;
}

function csvHeader(): string[] {
  return [
    rd("columns.worker"),
    rd("columns.sequence"),
    rd("columns.month"),
    rd("forgottenStamps.entryDate"),
    rd("forgottenStamps.correctedField"),
    rd("columns.reason"),
    rd("columns.note"),
    rd("columns.by"),
    rd("columns.at"),
    rd("forgottenStamps.reversedAt"),
    rd("forgottenStamps.reversedBy"),
    rd("forgottenStamps.reversalReason"),
  ];
}

function csvCells(workerName: string, row: StampRow): CsvCell[] {
  return [
    workerName,
    row.sequence,
    row.businessMonth,
    csv.date(row.entryBusinessDate),
    correctedField(row.correctedField),
    enumLabel("CorrectionReason", row.correctionReason),
    row.correctionNote,
    row.correctedByName,
    csv.dateTime(row.correctedAt),
    csv.dateTime(row.reversedAt),
    row.reversedByName,
    row.reversalReason,
  ];
}

export function forgottenStampsOperationalCsv(data: ForgottenStampsOperationalData): string {
  return buildCsv(
    csvHeader(),
    data.workers.flatMap((worker) => worker.infractions.map((row) => csvCells(worker.workerName, row))),
  );
}

export function forgottenStampsFinancialCsv(data: ForgottenStampsFinancialData): string {
  const header = [...csvHeader(), unitHeader.shekels(rd("columns.deduction")), unitHeader.shekels(rd("columns.reversalAmount"))];
  const rows = data.workers.flatMap((worker) =>
    worker.infractions.map((row) => [
      ...csvCells(worker.workerName, row),
      csv.money(row.deductionAgorot > 0 ? -row.deductionAgorot : 0),
      csv.money(row.reversalAgorot),
    ]),
  );
  const totals: CsvCell[] = [
    rd("common.totalRow"),
    ...new Array<CsvCell>(11).fill(null),
    csv.money(-data.totals.deductionsAgorot),
    csv.money(data.totals.reversalsAgorot),
  ];
  return buildCsv(header, [...rows, totals]);
}
