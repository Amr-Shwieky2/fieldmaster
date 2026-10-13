"use client";

import { Fragment, useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DashboardCostItem, FinancialDashboard } from "@fieldmaster/api-client";
import { useFormat } from "@/lib/use-format";
import { Money } from "@/components/formatted";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

interface CostBar {
  key: string;
  label: string;
  /** Second line under the label (project, shifts, overtime). */
  details: ReactNode;
  amountAgorot: number;
}

/** Highest cost first (a stable sort keeps the API order between equal amounts). */
function byCost<T extends { laborCostAgorot: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.laborCostAgorot - a.laborCostAgorot);
}

/**
 * A titled list of amounts with bars. Each bar is a block inside a
 * full-width track, so it starts at the inline-start edge (the right, since
 * the app is RTL). Widths are relative to the largest amount.
 */
function CostBarCard({ title, bars }: { title: string; bars: CostBar[] }) {
  const t = useTranslations("dashboard");
  const titleId = useId();
  const max = Math.max(0, ...bars.map((bar) => bar.amountAgorot));
  return (
    <Card>
      <CardHeader>
        <CardTitle id={titleId}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {bars.length === 0 ? (
          <EmptyState title={t("costs.emptyTitle")} description={t("costs.emptyDescription")} />
        ) : (
          <ul aria-labelledby={titleId} className="space-y-3">
            {bars.map((bar) => {
              const percent = max > 0 ? Math.max(0, Math.min(100, Math.round((bar.amountAgorot / max) * 100))) : 0;
              return (
                <li key={bar.key} className="space-y-1.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-slate-700">{bar.label}</p>
                      <p className="text-xs text-slate-500">{bar.details}</p>
                    </div>
                    <Money agorot={bar.amountAgorot} className="font-medium text-slate-900" />
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden data-testid="cost-bar-track">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** "Shifts: 12 · of which overtime: ₪ 300.00", with the site's project first when given. */
function CostDetails({ item, projectName }: { item: DashboardCostItem; projectName?: string | null }) {
  const t = useTranslations("dashboard");
  const format = useFormat();
  const parts: ReactNode[] = [];
  if (projectName) parts.push(t("costBySite.project", { name: projectName }));
  parts.push(t("costs.shifts", { count: format.number(item.approvedShifts) }));
  if (item.overtimeAgorot > 0) parts.push(t.rich("costs.overtime", { money: () => <Money agorot={item.overtimeAgorot} /> }));
  // Each part wraps as a whole when it fits on a line ("الورديات: 12" is never split).
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span aria-hidden className="mx-1.5">
              ·
            </span>
          ) : null}
          <span className="inline-block">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

/** Labor cost per project; the bucket without a project (emergency call-outs) is "بدون مشروع". */
export function CostByProject({ items }: { items: FinancialDashboard["costByProject"] }) {
  const t = useTranslations("dashboard");
  const bars = byCost(items).map((item) => ({
    key: item.id ?? "no-project",
    label: item.id === null || item.name === null ? t("costByProject.unassigned") : item.name,
    details: <CostDetails item={item} />,
    amountAgorot: item.laborCostAgorot,
  }));
  return <CostBarCard title={t("costByProject.title")} bars={bars} />;
}

/** Labor cost per site, with the site's project; the bucket without a site is "بدون موقع". */
export function CostBySite({ items }: { items: FinancialDashboard["costBySite"] }) {
  const t = useTranslations("dashboard");
  const bars = byCost(items).map((item) =>
    item.id === null || item.name === null
      ? { key: item.id ?? "no-site", label: t("costBySite.unassigned"), details: <CostDetails item={item} />, amountAgorot: item.laborCostAgorot }
      : { key: item.id, label: item.name, details: <CostDetails item={item} projectName={item.projectName} />, amountAgorot: item.laborCostAgorot },
  );
  return <CostBarCard title={t("costBySite.title")} bars={bars} />;
}
