"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { DashboardDay } from "@fieldmaster/api-client";
import { useFormat } from "@/lib/use-format";
import { BusinessDateText, MinutesText, Money } from "@/components/formatted";
import { SPIKE_MARKER, TREND_COLORS } from "./trend-colors";

/**
 * One bar of the chart: the day's labor cost as stacked parts. An ordinary
 * day fills `base` + `overtime`; a spike day fills `spikeBase` +
 * `spikeOvertime` instead, so the whole bar is drawn in the spike colors.
 */
export interface TrendRow {
  date: string;
  base: number;
  overtime: number;
  spikeBase: number;
  spikeOvertime: number;
  /**
   * SPIKE_MARKER above a spike day's bar. It is attached to the top part of
   * the bar (a part with no height gets no label): the overtime part, or the
   * base part when the day's overtime cost is 0.
   */
  overtimeMarker: string | null;
  baseMarker: string | null;
  day: DashboardDay;
}

export function toTrendRows(days: DashboardDay[]): TrendRow[] {
  return days.map((day) => {
    const overtime = Math.max(0, day.overtimeAgorot);
    const base = Math.max(0, day.laborCostAgorot - overtime);
    const spike = day.isOvertimeSpike;
    return {
      date: day.date,
      base: spike ? 0 : base,
      overtime: spike ? 0 : overtime,
      spikeBase: spike ? base : 0,
      spikeOvertime: spike ? overtime : 0,
      overtimeMarker: spike && overtime > 0 ? SPIKE_MARKER : null,
      baseMarker: spike && overtime === 0 ? SPIKE_MARKER : null,
      day,
    };
  });
}

/**
 * Axis label for an amount, from the app's money format: `₪ 3,000` (a `.00`
 * only adds noise on an axis). The space is non-breaking so the SVG text
 * never wraps the symbol onto its own line.
 */
export function moneyTick(formattedMoney: string): string {
  return formattedMoney.replace(/\.00$/, "").replace(" ", "\u00a0");
}

/** Day-of-month axis label for a business date (`2026-10-07` -> `7`). */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** The tooltip: the day and its amounts in Arabic (the chart area itself is laid out left-to-right, so the tooltip sets RTL again). */
export function TrendTooltip({ active, payload }: Pick<TooltipContentProps<number, string>, "active" | "payload">) {
  const t = useTranslations("dashboard");
  const row = payload?.[0]?.payload as TrendRow | undefined;
  if (!active || !row) return null;
  const { day } = row;
  return (
    <div dir="rtl" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-md" data-testid="trend-tooltip">
      <p className="font-medium text-slate-900">
        <BusinessDateText value={day.date} />
      </p>
      <dl className="mt-1 space-y-0.5">
        <div className="flex justify-between gap-4">
          <dt>{t("trend.columns.laborCost")}</dt>
          <dd>
            <Money agorot={day.laborCostAgorot} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{t("trend.columns.overtimeCost")}</dt>
          <dd>
            <Money agorot={day.overtimeAgorot} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{t("trend.columns.overtimeMinutes")}</dt>
          <dd>
            <MinutesText minutes={day.overtimeMinutes} />
          </dd>
        </div>
      </dl>
      {day.isOvertimeSpike ? <p className="mt-1 font-medium text-red-700">{t("trend.legend.spike")}</p> : null}
    </div>
  );
}

const AXIS_TICK = { fill: "#64748b", fontSize: 12 };
const BAR_SIZE = 28;

/**
 * Daily labor cost as stacked bars (base pay + overtime), spike days in their
 * own colors with a mark above the bar.
 *
 * RTL: an SVG inside an RTL page anchors axis text from the wrong side, so the
 * chart is drawn in a left-to-right box (`dir="ltr"` on its container) and
 * mirrored explicitly: the X axis is reversed (the first day of the month is
 * on the right) and the amounts axis is on the right. Ticks use the app's
 * formatters (Western digits, `₪`), and the tooltip is RTL Arabic.
 *
 * It fills its container (ResponsiveContainer measures it with a
 * ResizeObserver), so the parent must give it a height.
 */
export function DailyTrendChart({ days, label }: { days: DashboardDay[]; label: string }) {
  const format = useFormat();
  const rows = toTrendRows(days);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} role="img" aria-label={label} accessibilityLayer={false} margin={{ top: 20, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke="#e2e8f0" />
        <XAxis
          dataKey="date"
          reversed
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
          interval="preserveStartEnd"
          minTickGap={8}
          tickFormatter={(date: string) => format.number(dayOfMonth(date))}
        />
        <YAxis
          orientation="right"
          width={84}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={(agorot: number) => moneyTick(format.money(agorot))}
        />
        <Tooltip content={TrendTooltip} cursor={{ fill: "#f1f5f9" }} />
        <Bar dataKey="base" stackId="cost" fill={TREND_COLORS.base} maxBarSize={BAR_SIZE} />
        <Bar dataKey="overtime" stackId="cost" fill={TREND_COLORS.overtime} maxBarSize={BAR_SIZE} />
        <Bar dataKey="spikeBase" stackId="cost" fill={TREND_COLORS.spikeBase} maxBarSize={BAR_SIZE}>
          <LabelList dataKey="baseMarker" position="top" fill={TREND_COLORS.spikeOvertime} fontSize={12} />
        </Bar>
        <Bar dataKey="spikeOvertime" stackId="cost" fill={TREND_COLORS.spikeOvertime} maxBarSize={BAR_SIZE}>
          <LabelList dataKey="overtimeMarker" position="top" fill={TREND_COLORS.spikeOvertime} fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
