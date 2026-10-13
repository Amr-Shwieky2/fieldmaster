import { formatTime, toBusinessDay, toWesternDigits, type DateInput, type EnumName } from "@fieldmaster/i18n/node";
import { commonText, enumLabel, rd } from "./messages";

/**
 * The CSV next to every PDF: UTF-8 with a BOM (so Excel reads the Arabic),
 * Arabic headers, Western digits, CRLF line ends and RFC 4180 quoting. Text
 * cells are guarded against spreadsheet formula injection; numbers are
 * written as plain numbers (money as shekels with 2 decimals, in financial
 * reports only).
 */

/** A number already formatted for a spreadsheet (e.g. "-20.00"): written as is, never guarded as text. */
export class CsvNumber {
  constructor(readonly value: string) {}
}

export type CsvCell = string | number | CsvNumber | null | undefined;

export const CSV_BOM = "\uFEFF";
const CRLF = "\r\n";

/** OWASP: a cell starting with one of these is a formula in Excel / LibreOffice / Sheets. */
const FORMULA_START = /^[=+\-@\t\r]/;

function textCell(text: string): string {
  const western = toWesternDigits(text);
  return FORMULA_START.test(western) ? `'${western}` : western;
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

function renderCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof CsvNumber) return quote(cell.value);
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  return quote(textCell(cell));
}

export function buildCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map((title) => quote(textCell(title))), ...rows.map((row) => row.map(renderCell))];
  return CSV_BOM + lines.map((line) => line.join(",")).join(CRLF) + CRLF;
}

/** Integer agorot as shekels with 2 decimals ("1234.50", "-20.00"), integer arithmetic only. */
export function shekels(agorot: number): string {
  const rounded = Math.round(agorot);
  const abs = Math.abs(rounded);
  return `${rounded < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** CSV cell helpers. */
export const csv = {
  money: (agorot: number | null | undefined): CsvCell => (agorot === null || agorot === undefined ? null : new CsvNumber(shekels(agorot))),
  /** YYYY-MM-DD (a business date as stored). */
  date: (businessDate: string | null | undefined): CsvCell => businessDate ?? null,
  /** "YYYY-MM-DD HH:mm" in Asia/Jerusalem. */
  dateTime: (value: DateInput): CsvCell => {
    const day = toBusinessDay(value);
    return day ? `${day} ${formatTime(value)}` : null;
  },
  coordinates: (latitude: number | null | undefined, longitude: number | null | undefined): CsvCell =>
    latitude === null || latitude === undefined || longitude === null || longitude === undefined ? null : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
  round: (value: number | null | undefined): CsvCell => (value === null || value === undefined ? null : Math.round(value)),
  label: (enumName: EnumName, value: string | null | undefined): CsvCell => (value ? enumLabel(enumName, value) : null),
  yesNo: (value: boolean): CsvCell => commonText(value ? "yes" : "no"),
};

/** "<label> (دقائق)", "<label> (₪)", ...: a column title with its unit. */
export const unitHeader = {
  minutes: (label: string) => rd("csvHeader.minutes", { label }),
  meters: (label: string) => rd("csvHeader.meters", { label }),
  seconds: (label: string) => rd("csvHeader.seconds", { label }),
  shekels: (label: string) => rd("csvHeader.shekels", { label }),
};
