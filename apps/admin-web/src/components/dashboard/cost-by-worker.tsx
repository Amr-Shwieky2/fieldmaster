"use client";

import { useId } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { DashboardWorkerCost } from "@fieldmaster/api-client";
import { useFormat } from "@/lib/use-format";
import { MinutesText, Money } from "@/components/formatted";
import { ChevronEndIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** How many workers the dashboard lists; the payroll page has them all. */
export const TOP_WORKERS = 10;

/** Highest net payable first (a stable sort keeps the API order between equal amounts). */
function byNetPayable(workers: DashboardWorkerCost[]): DashboardWorkerCost[] {
  return [...workers].sort((a, b) => b.netPayableAgorot - a.netPayableAgorot);
}

/** The 10 workers with the highest pay this month, with a link to the month's payroll for everyone. */
export function CostByWorker({ workers, yearMonth }: { workers: DashboardWorkerCost[]; yearMonth: string }) {
  const t = useTranslations("dashboard");
  const format = useFormat();
  const top = byNetPayable(workers).slice(0, TOP_WORKERS);
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{t("costByWorker.title")}</CardTitle>
          {workers.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500">{t("costByWorker.description", { shown: top.length, total: workers.length })}</p>
          ) : null}
        </div>
        <Link href={`/payroll/${yearMonth}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          {t("costByWorker.viewAll")}
          <ChevronEndIcon className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {top.length === 0 ? (
          <EmptyState title={t("costByWorker.emptyTitle")} description={t("costByWorker.emptyDescription")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t("costByWorker.caption", { month: format.month(yearMonth) })}</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th scope="col" className="py-3 pe-3 ps-5 text-start">
                    {t("costByWorker.columns.worker")}
                  </th>
                  <th scope="col" className="px-3 py-3 text-start">
                    {t("costByWorker.columns.shifts")}
                  </th>
                  <th scope="col" className="px-3 py-3 text-start">
                    {t("costByWorker.columns.overtime")}
                  </th>
                  <th scope="col" className="px-3 py-3 text-start">
                    {t("costByWorker.columns.laborCost")}
                  </th>
                  <th scope="col" className="py-3 pe-5 ps-3 text-start">
                    {t("costByWorker.columns.net")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {top.map((worker) => (
                  <tr key={worker.workerProfileId} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="py-3 pe-3 ps-5 text-start font-medium text-slate-900">
                      {worker.fullLegalName}
                    </th>
                    <td className="px-3 py-3 text-slate-600">{format.number(worker.approvedShifts)}</td>
                    <td className="px-3 py-3 text-slate-600">
                      <MinutesText minutes={worker.overtimeMinutes} />
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <Money agorot={worker.laborCostAgorot} />
                    </td>
                    <td className="py-3 pe-5 ps-3">
                      <Money agorot={worker.netPayableAgorot} className="font-medium text-slate-900" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The month's top earners (the API's first five by net payable), ranked. */
export function TopEarners({ workers }: { workers: DashboardWorkerCost[] }) {
  const t = useTranslations("dashboard");
  const format = useFormat();
  const titleId = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle id={titleId}>{t("topEarners.title")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">{t("topEarners.description")}</p>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <EmptyState title={t("costByWorker.emptyTitle")} description={t("costByWorker.emptyDescription")} />
        ) : (
          <ol aria-labelledby={titleId} className="space-y-3">
            {workers.map((worker, index) => (
              <li key={worker.workerProfileId} className="flex items-center gap-3 text-sm">
                <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                  {format.number(index + 1)}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{worker.fullLegalName}</span>
                <Money agorot={worker.netPayableAgorot} className="font-medium text-slate-900" />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
