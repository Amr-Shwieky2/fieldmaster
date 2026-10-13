import { EM_DASH, formatBusinessDate } from "@fieldmaster/i18n/node";
import { enumLabel, rd } from "../render/messages";
import { dataTable, EMPTY, fmt, markup, keyValueTable, rdHtml, section, userText, type CellValue, type SafeHtml } from "../render/html";
import { buildCsv, csv, unitHeader, type CsvCell } from "../render/csv";
import { standardHeader } from "./common";
import type { ReportDocumentMeta } from "../report.types";
import type { PayrollReportData } from "../data/payroll.data";
import type { PayrollTotalsDto, PayrollWorkerLineDto } from "../../payroll/payroll.types";

/** The payroll report (Owner only): one version as it was stored, never recalculated. */

function byAt(name: string | null, at: string | null): SafeHtml {
  if (!at) return markup`${EM_DASH}`;
  return rdHtml("ledger.byAt", { name: userText(name ?? rd("common.systemActor")), time: fmt.dateTime(at) });
}

function versionInfo(data: PayrollReportData): SafeHtml {
  const pairs: [string, CellValue][] = [
    [
      rd("payroll.status"),
      markup`${enumLabel("PayrollPeriodStatus", data.status)}${data.legacy ? markup` <span class="tag">${rd("payroll.legacy")}</span>` : EMPTY}`,
    ],
    [rd("payroll.previousVersion"), data.previousVersion === null ? EM_DASH : rd("header.payrollVersionValue", { version: data.previousVersion })],
    [rd("payroll.created"), byAt(data.createdByName, data.createdAt)],
    [rd("payroll.calculated"), byAt(data.calculatedByName, data.calculatedAt)],
    [rd("payroll.finalized"), byAt(data.finalizedByName, data.finalizedAt)],
    [rd("payroll.reopened"), byAt(data.reopenedByName, data.reopenedAt)],
  ];
  if (data.reopenReason) pairs.push([rd("payroll.reopenReason"), userText(data.reopenReason)]);
  return section(rd("payroll.versionTitle"), keyValueTable(pairs));
}

const MINUTE_KEYS = ["regularMinutes", "overtimeMinutes", "emergencyRetroactiveMinutes", "emergencyReturnMinutes"] as const;
const MONEY_KEYS = [
  "grossBaseAgorot",
  "overtimeAgorot",
  "positiveAdjustmentsAgorot",
  "forgottenStampPenaltiesAgorot",
  "reversalsAgorot",
  "otherDeductionsAgorot",
  "netPayableAgorot",
] as const;

function workerColumns(): string[] {
  return [
    rd("columns.worker"),
    rd("payroll.columns.approvedShifts"),
    rd("payroll.columns.standardDays"),
    ...MINUTE_KEYS.map((key) => rd(`payroll.columns.${key}`)),
    ...MONEY_KEYS.map((key) => rd(`payroll.columns.${key}`)),
  ];
}

/** Deductions are stored as positive amounts; shown with their sign. */
const signed = (key: (typeof MONEY_KEYS)[number], amount: number) =>
  key === "forgottenStampPenaltiesAgorot" || key === "otherDeductionsAgorot" ? -amount : amount;

function workerCells(line: PayrollWorkerLineDto | PayrollTotalsDto, label: CellValue): CellValue[] {
  return [
    label,
    fmt.number(line.approvedShifts),
    fmt.number(line.standardDaysCredited),
    ...MINUTE_KEYS.map((key) => fmt.minutes(line[key])),
    ...MONEY_KEYS.map((key) => (key === "netPayableAgorot" ? markup`<strong>${fmt.money(line[key])}</strong>` : fmt.money(signed(key, line[key])))),
  ];
}

export function payrollBody(data: PayrollReportData, meta: ReportDocumentMeta): SafeHtml {
  const notCalculated = markup`<p class="empty">${rd("payroll.notCalculated")}</p>`;
  let workers: SafeHtml;
  if (!data.calculated) {
    workers = notCalculated;
  } else if (data.totals) {
    workers = dataTable(
      workerColumns(),
      data.workers.map((line) => workerCells(line, userText(line.fullLegalName))),
      { totals: workerCells(data.totals, rd("payroll.totalsRow", { count: data.totals.workers })), empty: rd("payroll.noWorkers"), className: "data dense" },
    );
  } else {
    workers = markup`<p class="note">${rd("payroll.legacyNote")}</p>
      ${dataTable(
        [rd("columns.worker"), rd("payroll.columns.netPayableAgorot")],
        (data.legacyNetByWorker ?? []).map((row) => [userText(row.fullLegalName), fmt.money(row.netPayableAgorot)]),
      )}`;
  }

  const adjustments = dataTable(
    [
      rd("columns.worker"),
      rd("payroll.adjustmentType"),
      rd("payroll.adjustmentSource"),
      rd("columns.amount"),
      rd("columns.reason"),
      rd("columns.by"),
      rd("columns.at"),
    ],
    data.adjustments.map((adjustment) => [
      userText(adjustment.workerName),
      enumLabel("PayrollAdjustmentType", adjustment.type),
      enumLabel("PayrollAdjustmentSource", adjustment.source),
      fmt.money(adjustment.amountAgorot),
      userText(adjustment.reason),
      userText(adjustment.createdByName),
      fmt.dateTime(adjustment.createdAt),
    ]),
    { empty: rd("payroll.noAdjustments") },
  );

  const warnings =
    data.workersWithoutCompensation.length > 0
      ? section(
          rd("payroll.withoutCompensationTitle"),
          dataTable(
            [rd("columns.worker"), rd("columns.entries"), rd("payroll.dates")],
            data.workersWithoutCompensation.map((worker) => [
              userText(worker.fullLegalName),
              fmt.number(worker.entries),
              worker.businessDates.map((date) => formatBusinessDate(date)).join(rd("values.listSeparator")),
            ]),
          ),
        )
      : EMPTY;
  const pending =
    data.pending && data.pending.entries > 0
      ? section(
          rd("payroll.pendingTitle"),
          dataTable(
            [rd("columns.worker"), rd("columns.entries")],
            data.pending.byWorker.map((worker) => [userText(worker.fullLegalName), fmt.number(worker.entries)]),
            { totals: [rd("common.totalRow"), fmt.number(data.pending.entries)] },
          ),
        )
      : EMPTY;

  return markup`${standardHeader(meta)} ${versionInfo(data)}
    <p class="note">${rd("payroll.storedNote")}</p>
    ${section(rd("payroll.workersTitle"), workers)} ${data.calculated ? markup`<p class="note">${rd("payroll.emergencyNote")}</p>` : EMPTY}
    ${section(rd("payroll.adjustmentsTitle"), adjustments)} ${warnings} ${pending}`;
}

export function payrollCsv(data: PayrollReportData): string {
  if (data.totals === null) {
    return buildCsv(
      [rd("columns.worker"), unitHeader.shekels(rd("payroll.columns.netPayableAgorot"))],
      (data.legacyNetByWorker ?? []).map((row) => [row.fullLegalName, csv.money(row.netPayableAgorot)]),
    );
  }
  const header = [
    rd("columns.worker"),
    rd("payroll.columns.approvedShifts"),
    rd("payroll.columns.standardDays"),
    ...MINUTE_KEYS.map((key) => unitHeader.minutes(rd(`payroll.columns.${key}`))),
    ...MONEY_KEYS.map((key) => unitHeader.shekels(rd(`payroll.columns.${key}`))),
  ];
  const cells = (line: PayrollWorkerLineDto | PayrollTotalsDto, label: string): CsvCell[] => [
    label,
    line.approvedShifts,
    line.standardDaysCredited,
    ...MINUTE_KEYS.map((key) => line[key]),
    ...MONEY_KEYS.map((key) => csv.money(signed(key, line[key]))),
  ];
  return buildCsv(header, [...data.workers.map((line) => cells(line, line.fullLegalName)), cells(data.totals, rd("common.totalRow"))]);
}
