import type { PayrollTotals, PayrollWorkerLine } from "@fieldmaster/api-client";
import { toWesternDigits } from "@fieldmaster/i18n";

/**
 * CSV export of a payroll version, for spreadsheets (Excel, Google Sheets,
 * LibreOffice). Pure: the caller passes the translated column headers.
 *
 * - UTF-8 with a byte order mark, so Excel reads the Arabic text correctly.
 * - Western digits only; money as shekels with exactly two decimals, without
 *   a thousands separator or the ₪ sign ("450.00", "-20.00"), computed from
 *   the integer agorot with integer arithmetic; minutes as integers.
 * - Deductions (forgotten-stamp penalties, other deductions) are negative, so
 *   the money cells of a row add up to its net.
 * - RFC 4180: CRLF line endings; a field with a comma, a quote, CR or LF is
 *   quoted, with its quotes doubled.
 * - Text cells (names) that a spreadsheet would run as a formula are prefixed
 *   with an apostrophe. Numeric cells are never changed.
 */

export const CSV_BOM = "﻿";
export const CSV_LINE_END = "\r\n";

/** Translated column headers and the label of the totals row. */
export interface PayrollCsvLabels {
  worker: string;
  approvedShifts: string;
  standardDays: string;
  regularMinutes: string;
  overtimeMinutes: string;
  emergencyRetroactiveMinutes: string;
  emergencyReturnMinutes: string;
  grossBase: string;
  overtimePay: string;
  positiveAdjustments: string;
  forgottenStampPenalties: string;
  reversals: string;
  otherDeductions: string;
  net: string;
  totals: string;
}

export interface PayrollCsvInput {
  workers: PayrollWorkerLine[];
  /** The version's totals; when null they are added up from the worker lines. */
  totals: PayrollTotals | null;
  /** Legacy versions without worker lines: the net per worker their old calculation stored. */
  legacyNetByWorker?: { fullLegalName: string; netPayableAgorot: number }[] | null;
  labels: PayrollCsvLabels;
}

type Cell = { text: string } | { number: string };

/** Characters that make a spreadsheet treat a cell as a formula (OWASP CSV injection: = + - @, tab, carriage return). */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Shekels with exactly two decimals from integer agorot: 45000 -> "450.00", -2000 -> "-20.00", 7 -> "0.07". */
export function csvMoney(agorot: number): string {
  const value = Math.round(agorot);
  const abs = Math.abs(value);
  const shekels = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${value < 0 ? "-" : ""}${shekels}.${cents < 10 ? "0" : ""}${cents}`;
}

/** A whole number (minutes, counts), or an empty cell when unknown. */
export function csvInteger(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(Math.round(value));
}

/** A text cell: Western digits, and an apostrophe before a leading formula character. */
export function csvText(value: string): string {
  const text = toWesternDigits(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** RFC 4180 quoting. */
export function csvField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function cellValue(cell: Cell): string {
  return "text" in cell ? csvText(cell.text) : cell.number;
}

function toCsv(rows: Cell[][]): string {
  return CSV_BOM + rows.map((row) => row.map((cell) => csvField(cellValue(cell))).join(",")).join(CSV_LINE_END) + CSV_LINE_END;
}

const text = (value: string): Cell => ({ text: value });
const integer = (value: number | null): Cell => ({ number: csvInteger(value) });
const money = (agorot: number): Cell => ({ number: csvMoney(agorot) });

/** The figures of a worker line or of the totals, deductions negative. */
function figures(line: Omit<PayrollTotals, "workers">): Cell[] {
  return [
    integer(line.approvedShifts),
    { number: Number.isFinite(line.standardDaysCredited) ? String(line.standardDaysCredited) : "" },
    integer(line.regularMinutes),
    integer(line.overtimeMinutes),
    integer(line.emergencyRetroactiveMinutes),
    integer(line.emergencyReturnMinutes),
    money(line.grossBaseAgorot),
    money(line.overtimeAgorot),
    money(line.positiveAdjustmentsAgorot),
    money(-line.forgottenStampPenaltiesAgorot),
    money(line.reversalsAgorot),
    money(-line.otherDeductionsAgorot),
    money(line.netPayableAgorot),
  ];
}

/** Totals added up from the worker lines (approved shifts stay unknown when a line does not have them). */
function sumLines(workers: PayrollWorkerLine[]): Omit<PayrollTotals, "workers"> {
  const sum = (pick: (line: PayrollWorkerLine) => number) => workers.reduce((total, line) => total + pick(line), 0);
  return {
    approvedShifts: workers.every((line) => line.approvedShifts !== null) ? sum((line) => line.approvedShifts ?? 0) : null,
    standardDaysCredited: sum((line) => line.standardDaysCredited),
    regularMinutes: sum((line) => line.regularMinutes),
    overtimeMinutes: sum((line) => line.overtimeMinutes),
    emergencyRetroactiveMinutes: sum((line) => line.emergencyRetroactiveMinutes),
    emergencyReturnMinutes: sum((line) => line.emergencyReturnMinutes),
    grossBaseAgorot: sum((line) => line.grossBaseAgorot),
    overtimeAgorot: sum((line) => line.overtimeAgorot),
    positiveAdjustmentsAgorot: sum((line) => line.positiveAdjustmentsAgorot),
    forgottenStampPenaltiesAgorot: sum((line) => line.forgottenStampPenaltiesAgorot),
    reversalsAgorot: sum((line) => line.reversalsAgorot),
    otherDeductionsAgorot: sum((line) => line.otherDeductionsAgorot),
    netPayableAgorot: sum((line) => line.netPayableAgorot),
  };
}

/**
 * The CSV text of a version: a header row, one row per worker and a totals
 * row. A legacy version that only stored the net per worker gives a
 * worker + net file.
 */
export function buildPayrollCsv({ workers, totals, legacyNetByWorker, labels }: PayrollCsvInput): string {
  if (workers.length === 0 && legacyNetByWorker) {
    const net = totals?.netPayableAgorot ?? legacyNetByWorker.reduce((sum, row) => sum + row.netPayableAgorot, 0);
    return toCsv([
      [text(labels.worker), text(labels.net)],
      ...legacyNetByWorker.map((row) => [text(row.fullLegalName), money(row.netPayableAgorot)]),
      [text(labels.totals), money(net)],
    ]);
  }

  const header = [
    labels.worker,
    labels.approvedShifts,
    labels.standardDays,
    labels.regularMinutes,
    labels.overtimeMinutes,
    labels.emergencyRetroactiveMinutes,
    labels.emergencyReturnMinutes,
    labels.grossBase,
    labels.overtimePay,
    labels.positiveAdjustments,
    labels.forgottenStampPenalties,
    labels.reversals,
    labels.otherDeductions,
    labels.net,
  ].map(text);

  return toCsv([
    header,
    ...workers.map((line) => [text(line.fullLegalName), ...figures(line)]),
    [text(labels.totals), ...figures(totals ?? sumLines(workers))],
  ]);
}

/** `payroll-2026-09-v2.csv` */
export function payrollCsvFileName(yearMonth: string, version: number): string {
  return `payroll-${yearMonth}-v${version}.csv`;
}
