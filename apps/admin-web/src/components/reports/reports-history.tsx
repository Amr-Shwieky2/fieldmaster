"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { GeneratedReport } from "@fieldmaster/api-client";
import { ReportStatus } from "@fieldmaster/shared-types";
import { EM_DASH } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { BusinessDateText, DateTimeText, LtrText, MonthText } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useReportFailure } from "./current-report";
import { clampProgress, isReportRunning, reportStatusTone } from "./report-model";
import { REPORT_LIST_POLL_MS, reportKeys, useReportFileActions } from "./report-queries";
import { ReportActionResults, ReportFileButtons, hasActionResults } from "./report-file-actions";

/** Names for the ids in the reports' filters (workers, projects, sites). */
interface NameLookup {
  worker: (id: string) => string | undefined;
  project: (id: string) => string | undefined;
  site: (id: string) => string | undefined;
}

const COLUMNS = ["type", "scope", "subject", "requested", "status", "copy", "actions"] as const;

const TH = "px-4 py-3 text-start font-medium";
const TD = "px-4 py-3 align-top text-start text-slate-700";

/** A name, or the raw id (left-to-right) when it is not in the lists. */
function NameOrId({ name, id }: { name: string | undefined; id: string }) {
  return name ? <>{name}</> : <LtrText className="font-mono text-xs">{id}</LtrText>;
}

/** What a report covers: the payroll month and version, or the dates and the worker, project and site it was narrowed to. */
function ReportScope({ report, names }: { report: GeneratedReport; names: NameLookup }) {
  const t = useTranslations("reports");
  const filters = report.filters;
  const parts: ReactNode[] = [];
  if (filters.yearMonth) {
    parts.push(
      t.rich("history.payrollScope", {
        version: filters.version ?? EM_DASH,
        month: () => <MonthText yearMonth={filters.yearMonth} />,
      }),
    );
  }
  if (filters.fromDate || filters.toDate) {
    parts.push(
      t.rich("history.range", {
        from: () => <BusinessDateText value={filters.fromDate} />,
        to: () => <BusinessDateText value={filters.toDate} />,
      }),
    );
  }
  const workerId = filters.workerProfileId;
  if (workerId) {
    const name = workerId === report.subjectWorkerProfileId && report.subjectWorkerName ? report.subjectWorkerName : names.worker(workerId);
    parts.push(t.rich("history.worker", { name: () => <NameOrId name={name} id={workerId} /> }));
  }
  const projectId = filters.projectId;
  if (projectId) parts.push(t.rich("history.project", { name: () => <NameOrId name={names.project(projectId)} id={projectId} /> }));
  const siteId = filters.siteId;
  if (siteId) parts.push(t.rich("history.site", { name: () => <NameOrId name={names.site(siteId)} id={siteId} /> }));

  if (parts.length === 0) return <>{EM_DASH}</>;
  return (
    <ul className="space-y-0.5">
      {parts.map((part, index) => (
        <li key={index}>{part}</li>
      ))}
    </ul>
  );
}

function ReportRow({ report, names }: { report: GeneratedReport; names: NameLookup }) {
  const t = useTranslations("reports");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const failure = useReportFailure();
  const actions = useReportFileActions(report.id);
  const typeLabel = enumLabel("ReportType", report.reportType);
  const running = isReportRunning(report);
  const finishedAt = () => <DateTimeText value={report.finishedAt} />;

  return (
    <>
      <tr className="border-b border-slate-100 last:border-0">
        <td className={`${TD} font-medium text-slate-900`}>{typeLabel}</td>
        <td className={`${TD} text-xs`}>
          <ReportScope report={report} names={names} />
        </td>
        <td className={TD}>{report.subjectWorkerName ?? EM_DASH}</td>
        <td className={TD}>
          <p>{report.requestedByName ?? EM_DASH}</p>
          <p className="text-xs text-slate-500">
            <DateTimeText value={report.generatedAt} />
          </p>
        </td>
        <td className={TD}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={reportStatusTone(report.status)}>{enumLabel("ReportStatus", report.status)}</Badge>
            {running ? <LtrText className="text-xs font-semibold">{t("status.percent", { percent: clampProgress(report.progress) })}</LtrText> : null}
          </div>
          {report.status === ReportStatus.FAILED ? <p className="mt-1 text-xs text-red-700">{failure(report)}</p> : null}
          {report.finishedAt && !running ? (
            <p className="mt-1 text-xs text-slate-500">
              {report.status === ReportStatus.FAILED ? t.rich("history.stoppedAt", { date: finishedAt }) : t.rich("history.finishedAt", { date: finishedAt })}
            </p>
          ) : null}
          {report.pageCount !== null ? <p className="text-xs text-slate-500">{t("history.pages", { count: report.pageCount })}</p> : null}
        </td>
        <td className={TD}>
          <Badge tone={report.includesFinancials ? "info" : "neutral"}>{report.includesFinancials ? t("copy.financial") : t("copy.operational")}</Badge>
        </td>
        <td className={TD}>
          {report.status === ReportStatus.READY ? (
            <ReportFileButtons actions={actions} stacked context={t("history.rowContext", { type: typeLabel, date: format.dateTime(report.generatedAt) })} />
          ) : null}
        </td>
      </tr>
      {hasActionResults(actions) ? (
        <tr className="border-b border-slate-100">
          <td colSpan={COLUMNS.length} className="px-4 pb-4">
            <ReportActionResults actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * «التقارير السابقة»: every report of the organization the caller may see,
 * newest first, refetched while one of them is still being generated.
 */
export function ReportsHistory() {
  const t = useTranslations("reports");
  const { client } = useAuth();
  const query = useQuery({
    queryKey: reportKeys.list,
    queryFn: () => client.listReports(),
    refetchInterval: (current) => (current.state.data?.some((report) => isReportRunning(report)) ? REPORT_LIST_POLL_MS : false),
  });
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => client.listProjects() });
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: () => client.listSites() });

  const names = useMemo<NameLookup>(() => {
    const workers = new Map((workersQuery.data ?? []).map((worker) => [worker.id, worker.fullLegalName]));
    const projects = new Map((projectsQuery.data ?? []).map((project) => [project.id, project.name]));
    const sites = new Map((sitesQuery.data ?? []).map((site) => [site.id, site.name]));
    return { worker: (id) => workers.get(id), project: (id) => projects.get(id), site: (id) => sites.get(id) };
  }, [workersQuery.data, projectsQuery.data, sitesQuery.data]);

  const reports = useMemo(() => [...(query.data ?? [])].sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)), [query.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("history.title")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {query.isPending ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isSuccess && reports.length === 0 ? <EmptyState title={t("history.empty.title")} description={t("history.empty.description")} /> : null}
        {reports.length > 0 ? (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[52rem] text-start text-sm">
              <caption className="sr-only">{t("history.caption")}</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className={TH}>
                      {t(`history.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <ReportRow key={report.id} report={report} names={names} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
