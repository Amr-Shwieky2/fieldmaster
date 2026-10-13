"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { GeneratedReport } from "@fieldmaster/api-client";
import { ReportStatus } from "@fieldmaster/shared-types";
import { getCodeMessage } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { DateTimeText, LtrText } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { clampProgress, isReportRunning } from "./report-model";
import { REPORT_POLL_MS, reportKeys, useReportFileActions } from "./report-queries";
import { ReportActionResults, ReportFileButtons } from "./report-file-actions";

/** The Arabic reason a report failed (its API error code), or a generic one. */
export function useReportFailure(): (report: Pick<GeneratedReport, "errorCode">) => string {
  const t = useTranslations("reports");
  const tErrors = useTranslations("errors");
  return (report) => (report.errorCode ? getCodeMessage(tErrors, report.errorCode) : null) ?? t("status.failedFallback");
}

/** A queued or running report: its state and a progress bar. */
export function ReportProgress({ report }: { report: GeneratedReport }) {
  const t = useTranslations("reports");
  const percent = clampProgress(report.progress);
  return (
    <div className="space-y-2">
      <div
        role="progressbar"
        aria-label={t("status.progressLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t("status.percent", { percent })}
        className="h-2.5 w-full overflow-hidden rounded-full bg-blue-100"
      >
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <LtrText className="text-sm font-semibold">{t("status.percent", { percent })}</LtrText>
    </div>
  );
}

/**
 * The report just requested: its progress while the background job runs
 * (polled about every second), then the files and the integrity check, or
 * the reason it failed with a way to request it again.
 */
export function CurrentReport({ reportId, onRetry, retrying }: { reportId: string; onRetry: (report: GeneratedReport) => void; retrying: boolean }) {
  const t = useTranslations("reports");
  const enumLabel = useEnumLabel();
  const failure = useReportFailure();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const key = reportKeys.detail(reportId);
  const actions = useReportFileActions(reportId);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<GeneratedReport>(key);
      const report = await client.getReport(reportId);
      // It just finished: the list shows its new state too.
      if (isReportRunning(previous) && !isReportRunning(report)) void queryClient.invalidateQueries({ queryKey: reportKeys.list });
      return report;
    },
    refetchInterval: (current) => (isReportRunning(current.state.data) ? REPORT_POLL_MS : false),
  });

  const report = query.data;
  if (!report) {
    return query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <LoadingState />;
  }

  const typeLabel = enumLabel("ReportType", report.reportType);

  if (isReportRunning(report)) {
    return (
      <section aria-label={typeLabel} className="space-y-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <p className="font-semibold">{typeLabel}</p>
        <p role="status">{report.status === ReportStatus.QUEUED ? t("status.queued") : t("status.running")}</p>
        <ReportProgress report={report} />
        <p className="text-xs">{t("status.leaveHint")}</p>
      </section>
    );
  }

  if (report.status === ReportStatus.FAILED) {
    return (
      <section aria-label={typeLabel} className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <div role="alert" className="space-y-1">
          <p className="font-semibold">{t("status.failedTitle", { type: typeLabel })}</p>
          <p>{failure(report)}</p>
        </div>
        <Button size="sm" onClick={() => onRetry(report)} disabled={retrying}>
          {retrying ? t("status.retrying") : t("status.retry")}
        </Button>
      </section>
    );
  }

  return (
    <section aria-label={typeLabel} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
      <div className="space-y-1">
        <p role="status" className="flex flex-wrap items-center gap-2 font-semibold">
          <Badge tone="success">{enumLabel("ReportStatus", report.status)}</Badge>
          {typeLabel}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{report.includesFinancials ? t("copy.financial") : t("copy.operational")}</span>
          {report.pageCount !== null ? <span>{t("status.pages", { count: report.pageCount })}</span> : null}
        </p>
        {report.finishedAt ? <p className="text-xs">{t.rich("status.finishedAt", { date: () => <DateTimeText value={report.finishedAt} /> })}</p> : null}
      </div>
      <ReportFileButtons actions={actions} />
      <ReportActionResults actions={actions} />
    </section>
  );
}
