import { formatBusinessDate, isSystemShiftTitle } from "@fieldmaster/i18n/node";
import { ReportType } from "@fieldmaster/shared-types";
import { REPORT_FILTER_RULES } from "../report-filters";
import { enumLabel, rd } from "../render/messages";
import { fmt, markup, keyValueTable, reportHeader, userText, type CellValue, type SafeHtml } from "../render/html";
import type { ReportDocumentMeta } from "../report.types";

/** The filters of a report as header rows: the period (or month and version) and, where the type takes them, worker, project and site. */
export function headerFilters(meta: ReportDocumentMeta): [string, CellValue][] {
  const rule = REPORT_FILTER_RULES[meta.reportType];
  const { filters, names } = meta;
  const rows: [string, CellValue][] = [];
  if (filters.fromDate && filters.toDate) {
    rows.push([rd("header.period"), rd("header.periodRange", { from: formatBusinessDate(filters.fromDate), to: formatBusinessDate(filters.toDate) })]);
  }
  if (filters.yearMonth) rows.push([rd("header.month"), fmt.month(filters.yearMonth)]);
  if (meta.reportType === ReportType.PAYROLL && filters.version !== undefined) {
    rows.push([rd("header.payrollVersion"), rd("header.payrollVersionValue", { version: filters.version })]);
  }
  if (rule.workerProfileId !== "forbidden") rows.push([rd("header.worker"), filters.workerProfileId ? userText(names.workerName) : rd("header.allWorkers")]);
  if (rule.projectId !== "forbidden") rows.push([rd("header.project"), filters.projectId ? userText(names.projectName) : rd("header.allProjects")]);
  if (rule.siteId !== "forbidden") rows.push([rd("header.site"), filters.siteId ? userText(names.siteName) : rd("header.allSites")]);
  return rows;
}

export function standardHeader(meta: ReportDocumentMeta): SafeHtml {
  return reportHeader({
    title: meta.title,
    financial: meta.financial,
    organizationName: meta.names.organizationName,
    filters: headerFilters(meta),
    generatedAt: meta.generatedAt,
    generatedByName: meta.generatedByName,
    reportId: meta.reportId,
    dataHash: meta.dataHash,
  });
}

/** A shift's title as shown: an emergency call-out's generated (English) title becomes its Arabic type. */
export function shiftTitleText(title: string, shiftType: string): string {
  return isSystemShiftTitle({ title, shiftType }) ? enumLabel("ShiftType", shiftType) : title;
}

export function shiftTitle(title: string, shiftType: string): SafeHtml {
  return userText(shiftTitleText(title, shiftType));
}

export function projectText(name: string | null): string {
  return name ?? rd("common.noProject");
}

export function siteText(name: string | null): string {
  return name ?? rd("common.noSite");
}

/** "<project> / <site>". */
export function projectAndSite(projectName: string | null, siteName: string | null): SafeHtml {
  return markup`${userText(projectText(projectName))} / ${userText(siteText(siteName))}`;
}

/** A summary block: label / value pairs under a heading. */
export function summaryBlock(title: string, pairs: readonly (readonly [string, CellValue])[]): SafeHtml {
  return markup`<section class="summary">
    <h2>${title}</h2>
    ${keyValueTable(pairs)}
  </section>`;
}

/** The "operational version" notice: no amount in this file. */
export function operationalNotice(): SafeHtml {
  return markup`<p class="note">${rd("common.operationalNotice")}</p>`;
}
