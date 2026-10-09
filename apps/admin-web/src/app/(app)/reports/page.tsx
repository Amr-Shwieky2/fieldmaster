"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { useErrorMessage } from "@/lib/use-error-message";
import { EM_DASH } from "@fieldmaster/i18n";
import { useFormat } from "@/lib/use-format";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, LtrText } from "@/components/formatted";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

/**
 * First and last day (YYYY-MM-DD) of the current month in the business time
 * zone (Asia/Jerusalem). Built from the calendar month directly instead of
 * `Date#toISOString()`, which converts to UTC and shifted the default range
 * back by a day for anyone east of UTC.
 */
function currentMonthRange(yearMonth: string = currentYearMonth()) {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

export default function ReportsPage() {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<{ downloadUrl: string; includesFinancials: boolean } | null>(null);

  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const reportsQuery = useQuery({ queryKey: ["reports"], queryFn: () => client.listReports() });

  const [workerProfileId, setWorkerProfileId] = useState("");
  const [fromDate, setFromDate] = useState(() => currentMonthRange().from);
  const [toDate, setToDate] = useState(() => currentMonthRange().to);

  const generate = useMutation({
    mutationFn: () => client.generateWorkerLedger({ workerProfileId, fromDate, toDate }, `web-report-${Date.now()}`),
    onMutate: () => setLastResult(null),
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const download = useMutation({
    mutationFn: (id: string) => client.getReportDownloadUrl(id),
    onSuccess: (result) => {
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    },
  });

  const workers = workersQuery.data ?? [];
  const findWorker = (id: string | null) => (id ? workers.find((w) => w.id === id) : undefined);
  const workerPlaceholder = workersQuery.isLoading
    ? t("generate.workersLoading")
    : workersQuery.isSuccess && workers.length === 0
      ? t("generate.noWorkers")
      : t("generate.workerPlaceholder");
  const reports = reportsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("generate.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="report-worker">{t("generate.worker")}</Label>
            <Select
              id="report-worker"
              value={workerProfileId}
              onChange={(e) => setWorkerProfileId(e.target.value)}
              disabled={workersQuery.isLoading}
            >
              <option value="">{workerPlaceholder}</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.fullLegalName}
                </option>
              ))}
            </Select>
            {workersQuery.isError ? (
              <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700">
                <span>{t("generate.workersError", { message: errorMessage(workersQuery.error) })}</span>
                <Button size="sm" variant="secondary" onClick={() => workersQuery.refetch()}>
                  {tc("retry")}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="report-from">{t("generate.from")}</Label>
              <Input id="report-from" type="date" dir="ltr" className="text-start" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="report-to">{t("generate.to")}</Label>
              <Input id="report-to" type="date" dir="ltr" className="text-start" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          {generate.isError ? (
            <p role="alert" className="text-sm text-red-700">
              {errorMessage(generate.error)}
            </p>
          ) : null}
          <Button onClick={() => generate.mutate()} disabled={generate.isPending || !workerProfileId}>
            {generate.isPending ? t("generate.submitting") : t("generate.submit")}
          </Button>

          <div aria-live="polite">
            {lastResult ? (
              <div role="status" className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <p className="font-medium text-emerald-800">
                  {lastResult.includesFinancials ? t("generate.readyWithFinancials") : t("generate.readyOperationalOnly")}
                </p>
                <a href={lastResult.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">
                  {t("generate.openPdf")}
                </a>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("past.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {download.isError ? (
            <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
              {t("past.downloadFailed", { message: errorMessage(download.error) })}
            </p>
          ) : null}
          {reportsQuery.isLoading ? <LoadingState /> : null}
          {reportsQuery.isError ? <ErrorState error={reportsQuery.error} onRetry={() => reportsQuery.refetch()} /> : null}
          {reports && reports.length === 0 ? <EmptyState title={t("past.empty.title")} description={t("past.empty.description")} /> : null}
          {reports && reports.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">{t("past.caption")}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 text-start">
                      {t("past.columns.worker")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start">
                      {t("past.columns.generatedAt")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start">
                      {t("past.columns.financials")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start">
                      {t("past.columns.hash")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start">
                      <span className="sr-only">{tc("actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const isDownloading = download.isPending && download.variables === r.id;
                    const worker = findWorker(r.subjectWorkerProfileId);
                    return (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          {worker ? worker.fullLegalName : <LtrText className="font-mono text-xs">{r.subjectWorkerProfileId ?? EM_DASH}</LtrText>}
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          <DateTimeText value={r.generatedAt} />
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={r.includesFinancials ? "info" : "neutral"}>
                            {r.includesFinancials ? t("past.financialsIncluded") : t("past.operationalOnly")}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500" title={r.sha256Hash}>
                          <LtrText>{`${r.sha256Hash.slice(0, 16)}…`}</LtrText>
                        </td>
                        <td className="px-5 py-3 text-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => download.mutate(r.id)}
                            disabled={download.isPending}
                            aria-label={
                              isDownloading
                                ? undefined
                                : t("past.downloadLabel", {
                                    worker: worker?.fullLegalName ?? r.subjectWorkerProfileId ?? EM_DASH,
                                    date: format.dateTime(r.generatedAt),
                                  })
                            }
                          >
                            {isDownloading ? t("past.downloading") : tc("download")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
