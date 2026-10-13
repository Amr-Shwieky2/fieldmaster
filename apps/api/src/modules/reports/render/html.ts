import {
  EM_DASH,
  formatAgorot,
  formatBusinessDate,
  formatDateTime,
  formatMinutes,
  formatMonth,
  formatNumber,
  formatTime,
  type DateInput,
  type EnumName,
} from "@fieldmaster/i18n/node";
import { REPORT_FONT_FAMILY, reportFontFaces } from "./fonts";
import { commonText, enumLabel, formatMessage, messageAt, parseMessage, rd } from "./messages";

/**
 * HTML for the PDF reports. Everything interpolated into a template goes
 * through the `markup` tag, which escapes plain values and only passes
 * `SafeHtml` (built by this module) through, so a worker's name, a daily
 * summary or a project name can never inject markup.
 */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

export type HtmlValue = SafeHtml | string | number | null | undefined | false | readonly HtmlValue[];

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function renderValue(value: HtmlValue): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(String(value));
}

/**
 * A `reportDocuments.*` message with HTML values (a name in a `<bdi>`, an
 * amount in a left-to-right run): its own text is escaped, the values are
 * rendered like any interpolated value.
 */
export function rdHtml(key: string, values: Readonly<Record<string, HtmlValue>> = {}): SafeHtml {
  const template = messageAt(`reportDocuments.${key}`);
  return new SafeHtml(
    parseMessage(template)
      .map((part) => {
        if ("text" in part) return escapeHtml(part.text);
        if (!(part.argument in values)) throw new Error(`Missing value for {${part.argument}} in "${template}"`);
        return renderValue(values[part.argument]);
      })
      .join(""),
  );
}

/** Tagged template: escapes every interpolated plain value. */
export function markup(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = strings[0];
  values.forEach((value, index) => {
    out += renderValue(value) + strings[index + 1];
  });
  return new SafeHtml(out);
}

export const EMPTY = new SafeHtml("");

/** A left-to-right run inside Arabic text (amounts, times, coordinates, ids, hashes, signed numbers). */
export function ltr(value: HtmlValue): SafeHtml {
  return markup`<bdi dir="ltr">${value}</bdi>`;
}

/** Text someone typed (a name, a summary): isolated so its own direction never reorders the text around it. */
export function userText(value: string | null | undefined): SafeHtml {
  return value === null || value === undefined || value.trim() === "" ? new SafeHtml(EM_DASH) : markup`<bdi>${value}</bdi>`;
}

/** Formatting through @fieldmaster/i18n only: Western digits, Asia/Jerusalem, ₪. */
export const fmt = {
  date: (businessDate: string | null | undefined) => markup`${formatBusinessDate(businessDate)}`,
  month: (yearMonth: string | null | undefined) => markup`${formatMonth(yearMonth)}`,
  dateTime: (value: DateInput) => markup`${formatDateTime(value)}`,
  time: (value: DateInput) => (value === null || value === undefined ? new SafeHtml(EM_DASH) : ltr(formatTime(value))),
  money: (agorot: number | null | undefined) =>
    agorot === null || agorot === undefined ? new SafeHtml(EM_DASH) : markup`<bdi dir="ltr" class="money">${formatAgorot(agorot)}</bdi>`,
  minutes: (minutes: number | null | undefined) => markup`${formatMinutes(minutes)}`,
  /** "60 د" (the shared `units.minutesShort`). */
  shortMinutes: (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined
      ? new SafeHtml(EM_DASH)
      : markup`${formatMessage(messageAt("units.minutesShort"), { count: formatNumber(minutes) })}`,
  number: (value: number | null | undefined) => (value === null || value === undefined ? new SafeHtml(EM_DASH) : ltr(formatNumber(value))),
  meters: (value: number | null | undefined) =>
    value === null || value === undefined ? new SafeHtml(EM_DASH) : markup`${rd("units.meters", { value: formatNumber(Math.round(value)) })}`,
  seconds: (value: number | null | undefined) =>
    value === null || value === undefined ? new SafeHtml(EM_DASH) : markup`${rd("units.seconds", { value: formatNumber(Math.round(value)) })}`,
  coordinates: (latitude: number | null | undefined, longitude: number | null | undefined) =>
    latitude === null || latitude === undefined || longitude === null || longitude === undefined
      ? new SafeHtml(EM_DASH)
      : ltr(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`),
  code: (value: string | null | undefined) => (value ? ltr(value) : new SafeHtml(EM_DASH)),
  label: (enumName: EnumName, value: string | null | undefined) => markup`${enumLabel(enumName, value)}`,
  yesNo: (value: boolean) => markup`${commonText(value ? "yes" : "no")}`,
};

export type CellValue = HtmlValue;

/** A table with a header row repeated on every page, and an optional totals row. */
export function dataTable(
  columns: readonly HtmlValue[],
  rows: readonly (readonly CellValue[])[],
  options: { totals?: readonly CellValue[]; className?: string; empty?: string } = {},
): SafeHtml {
  if (rows.length === 0) return markup`<p class="empty">${options.empty ?? rd("common.noRecords")}</p>`;
  const head = columns.map((column) => markup`<th>${column}</th>`);
  const body = rows.map((row) => markup`<tr>${row.map((cell) => markup`<td>${cell ?? EM_DASH}</td>`)}</tr>`);
  const foot = options.totals ? markup`<tfoot><tr class="totals">${options.totals.map((cell) => markup`<td>${cell ?? ""}</td>`)}</tr></tfoot>` : EMPTY;
  return markup`<table class="${options.className ?? "data"}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

/** Label / value pairs, `perRow` pairs per row. */
export function keyValueTable(pairs: readonly (readonly [string, CellValue])[], perRow = 2): SafeHtml {
  const body: SafeHtml[] = [];
  for (let index = 0; index < pairs.length; index += perRow) {
    const row = pairs.slice(index, index + perRow);
    const cells = row.map(([label, value]) => markup`<th>${label}</th><td>${value ?? EM_DASH}</td>`);
    const padding = Array.from({ length: perRow - row.length }, () => markup`<th></th><td></td>`);
    body.push(markup`<tr>${cells}${padding}</tr>`);
  }
  return markup`<table class="kv kv-${perRow}"><tbody>${body}</tbody></table>`;
}

export interface ReportHeader {
  title: string;
  financial: boolean;
  organizationName: string;
  /** The report's filters (period, worker, project, ...), already labeled. */
  filters: readonly (readonly [string, CellValue])[];
  generatedAt: Date;
  generatedByName: string | null;
  reportId: string;
  dataHash: string;
}

/** The header every report starts with: title, financial or operational version, organization, filters, who and when, and the report's identity. */
export function reportHeader(header: ReportHeader): SafeHtml {
  const version = header.financial ? rd("version.financial") : rd("version.operational");
  return markup`<header class="report-header">
    <div class="title-row">
      <h1>${header.title}</h1>
      <span class="badge ${header.financial ? "financial" : "operational"}">${version}</span>
    </div>
    ${keyValueTable([
      [rd("header.organization"), userText(header.organizationName)],
      ...header.filters,
      [rd("header.generatedBy"), userText(header.generatedByName)],
      [rd("header.generatedAt"), fmt.dateTime(header.generatedAt)],
    ])}
    <table class="kv identity">
      <tbody>
        <tr>
          <th>${rd("header.reportId")}</th>
          <td>${fmt.code(header.reportId)}</td>
        </tr>
        <tr>
          <th>${rd("header.dataHash")}</th>
          <td><span class="hash">${fmt.code(header.dataHash)}</span></td>
        </tr>
      </tbody>
    </table>
    <p class="note">${rd("header.dataHashNote")}</p>
  </header>`;
}

export function section(title: string, body: HtmlValue): SafeHtml {
  return markup`<section>
    <h2>${title}</h2>
    ${body}
  </section>`;
}

// ── The document: fonts, page size and the footer on every page ────────────

function cssString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ").replace(/</g, "\\3C ").replace(/>/g, "\\3E ")}"`;
}

/** A left-to-right isolate (U+2066 ... U+2069) inside a CSS string, so an id or a hash keeps its order in the RTL footer. */
function cssLtr(text: string): string {
  return `"\\002066" ${cssString(text)} "\\002069"`;
}

/** A message as a CSS `content` value: literal text, page counters, or isolated left-to-right values. */
function cssContent(template: string, values: Readonly<Record<string, string>>): string {
  return parseMessage(template)
    .map((part) => {
      if ("text" in part) return cssString(part.text);
      const value = values[part.argument];
      if (value === undefined) throw new Error(`Missing value for {${part.argument}} in "${template}"`);
      return value;
    })
    .join(" ");
}

export type PageOrientation = "portrait" | "landscape";

export interface ReportDocument {
  title: string;
  orientation: PageOrientation;
  reportId: string;
  dataHash: string;
  body: SafeHtml;
}

const BASE_CSS = `
* { box-sizing: border-box; }
html, body, h1, h2, h3, p, div, span, bdi, table, th, td { font-family: "${REPORT_FONT_FAMILY}"; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-size: 8.5pt; line-height: 1.45; color: #0f172a; }
h1 { font-size: 15pt; font-weight: 700; margin: 0; }
h2 { font-size: 11pt; font-weight: 700; margin: 5mm 0 2mm; padding-bottom: 1mm; border-bottom: 0.4mm solid #0f172a; break-after: avoid; }
h3 { font-size: 9.5pt; font-weight: 700; margin: 3mm 0 1.5mm; break-after: avoid; }
p { margin: 1mm 0; }
.title-row { display: flex; align-items: center; gap: 4mm; margin-bottom: 3mm; }
.badge { display: inline-block; padding: 0.6mm 2.5mm; border-radius: 1.2mm; font-size: 8.5pt; font-weight: 700; }
.badge.financial { background: #fef3c7; color: #78350f; border: 0.3mm solid #d97706; }
.badge.operational { background: #e0f2fe; color: #0c4a6e; border: 0.3mm solid #0284c7; }
.note { color: #475569; font-size: 7.5pt; }
.empty { color: #475569; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; }
th, td { border: 0.2mm solid #cbd5e1; padding: 0.8mm 1.4mm; text-align: start; vertical-align: top; }
th { background: #f1f5f9; font-weight: 700; }
thead { display: table-header-group; }
tfoot { display: table-row-group; }
tr { break-inside: avoid; }
table.kv th { color: #334155; }
table.kv-2 th { width: 16%; }
table.kv-2 td { width: 34%; }
table.kv-3 th { width: 12%; }
table.kv-3 td { width: 21.33%; }
table.identity { margin-top: -3mm; }
table.identity th { width: 1%; white-space: nowrap; }
.hash { font-size: 7.5pt; }
tr.totals td { font-weight: 700; background: #f8fafc; }
table.dense th, table.dense td { font-size: 7.5pt; padding: 0.6mm 1mm; }
.entry { margin-bottom: 5mm; }
.entry-title { display: flex; flex-wrap: wrap; gap: 2mm; align-items: center; }
.tag { display: inline-block; padding: 0.2mm 1.6mm; border-radius: 1mm; background: #f1f5f9; border: 0.2mm solid #94a3b8; font-size: 7.5pt; }
.tag.alert { background: #fee2e2; border-color: #dc2626; color: #7f1d1d; }
.pre { white-space: pre-line; }
.money { white-space: nowrap; }
.muted { color: #64748b; }
`;

/** The full HTML document of a report, with the embedded font and the footer («صفحة N من M», report id, data hash) on every page. */
export function reportDocument(document: ReportDocument): string {
  const footerMuted = `font-family: "${REPORT_FONT_FAMILY}"; color: #475569; vertical-align: top; padding-top: 3mm;`;
  const pageNumber = cssContent(commonText("pageOf"), { page: "counter(page)", total: "counter(pages)" });
  const identity = `${cssContent(messageAt("reportDocuments.footer.reportId"), { id: cssLtr(document.reportId) })} "\\A " ${cssContent(
    messageAt("reportDocuments.footer.dataHash"),
    { hash: cssLtr(document.dataHash) },
  )}`;
  const size = document.orientation === "landscape" ? "A4 landscape" : "A4";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(document.title)}</title>
<style>
${reportFontFaces()}
@page {
  size: ${size};
  margin: 12mm 11mm 19mm 11mm;
  @bottom-left { content: ${pageNumber}; ${footerMuted} font-size: 8pt; }
  @bottom-right { content: ${identity}; white-space: pre; text-align: right; direction: rtl; ${footerMuted} font-size: 6.5pt; }
}
${BASE_CSS}
</style>
</head>
<body>
${document.body.value}
</body>
</html>`;
}
