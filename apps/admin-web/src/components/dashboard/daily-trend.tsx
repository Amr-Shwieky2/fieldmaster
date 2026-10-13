"use client";

import { useId } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { DashboardDay } from "@fieldmaster/api-client";
import { useFormat } from "@/lib/use-format";
import { BusinessDateText, MinutesText, Money } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { SPIKE_MARKER, TREND_COLORS } from "./trend-colors";

function ChartLoading() {
  const t = useTranslations("dashboard");
  return (
    <div role="status" className="flex h-full items-center justify-center text-sm text-slate-500">
      {t("trend.loadingChart")}
    </div>
  );
}

// Recharts is large and only an Owner sees this chart: it loads in the browser, outside the page's first bundle.
const DailyTrendChart = dynamic(() => import("./daily-trend-chart").then((m) => m.DailyTrendChart), {
  ssr: false,
  loading: () => <ChartLoading />,
});

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />;
}

/**
 * The month's labor cost per business day: a bar chart (base pay and
 * overtime stacked, spike days highlighted) with an HTML legend, and the same
 * figures as a table for screen readers and exact values.
 */
export function DailyTrend({ days, yearMonth }: { days: DashboardDay[]; yearMonth: string }) {
  const t = useTranslations("dashboard");
  const format = useFormat();
  const titleId = useId();
  const legendId = useId();
  const month = format.month(yearMonth);
  const hasSpikes = days.some((day) => day.isOvertimeSpike);

  return (
    <Card>
      <CardHeader>
        <CardTitle id={titleId}>{t("trend.title")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">{t("trend.description", { month })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {days.length === 0 ? (
          <EmptyState title={t("trend.emptyTitle")} description={t("trend.emptyDescription")} />
        ) : (
          <>
            <figure aria-labelledby={titleId} aria-describedby={legendId} className="space-y-3">
              {/* A left-to-right box: the chart mirrors itself for RTL (see DailyTrendChart). */}
              <div dir="ltr" className="h-72 w-full" data-testid="daily-trend-chart">
                <DailyTrendChart days={days} label={t("trend.chartLabel", { month })} />
              </div>
              <figcaption id={legendId} className="space-y-1 text-xs text-slate-600">
                <ul aria-label={t("trend.legend.label")} className="flex flex-wrap gap-x-4 gap-y-1">
                  <li className="flex items-center gap-1.5">
                    <Swatch color={TREND_COLORS.base} />
                    {t("trend.legend.base")}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Swatch color={TREND_COLORS.overtime} />
                    {t("trend.legend.overtime")}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Swatch color={TREND_COLORS.spikeBase} />
                    <Swatch color={TREND_COLORS.spikeOvertime} />
                    <span aria-hidden style={{ color: TREND_COLORS.spikeOvertime }}>
                      {SPIKE_MARKER}
                    </span>
                    {t("trend.legend.spike")}
                  </li>
                </ul>
                {hasSpikes ? <p>{t("trend.spikeNote")}</p> : null}
              </figcaption>
            </figure>

            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">{t("trend.showTable")}</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <caption className="sr-only">{t("trend.caption", { month })}</caption>
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start">
                        {t("trend.columns.date")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start">
                        {t("trend.columns.laborCost")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start">
                        {t("trend.columns.overtimeCost")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start">
                        {t("trend.columns.overtimeMinutes")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start">
                        {t("trend.columns.note")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day.date} className={day.isOvertimeSpike ? "border-b border-red-100 bg-red-50" : "border-b border-slate-100 last:border-0"}>
                        <th scope="row" className="px-3 py-2 text-start font-normal text-slate-700">
                          <BusinessDateText value={day.date} />
                        </th>
                        <td className="px-3 py-2">
                          <Money agorot={day.laborCostAgorot} />
                        </td>
                        <td className="px-3 py-2">
                          <Money agorot={day.overtimeAgorot} />
                        </td>
                        <td className="px-3 py-2">
                          <MinutesText minutes={day.overtimeMinutes} />
                        </td>
                        <td className="px-3 py-2">{day.isOvertimeSpike ? <Badge tone="danger">{t("trend.spike")}</Badge> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
