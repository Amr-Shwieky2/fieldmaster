"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { OrgRole } from "@fieldmaster/shared-types";
import type { FinancialDashboard } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { LtrText, Money } from "@/components/formatted";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Cost per project as a bar list. Each bar is a block inside a full-width
 * track, so it starts at the inline-start edge: the right in Arabic, the left
 * in English. Widths are relative to the most expensive project.
 */
function CostByProject({ items }: { items: FinancialDashboard["costByProject"] }) {
  const t = useTranslations("dashboard");
  if (items.length === 0) {
    return <EmptyState title={t("costByProject.emptyTitle")} description={t("costByProject.emptyDescription")} />;
  }
  const max = Math.max(0, ...items.map((p) => p.totalAgorot));
  return (
    <ul className="space-y-3">
      {items.map((p) => {
        const percent = max > 0 ? Math.max(0, Math.min(100, Math.round((p.totalAgorot / max) * 100))) : 0;
        return (
          <li key={p.projectId ?? "unassigned"} className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-slate-700">{p.projectId === null ? t("costByProject.unassigned") : p.projectName}</span>
              <Money agorot={p.totalAgorot} className="font-medium text-slate-900" />
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden data-testid="cost-bar-track">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const fmt = useFormat();
  const enumLabel = useEnumLabel();
  const { client, session } = useAuth();
  const isOwner = session?.role === OrgRole.OWNER;
  const yearMonth = currentYearMonth();

  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const pendingQuery = useQuery({ queryKey: ["attendance-approvals-pending"], queryFn: () => client.listPendingAttendanceApprovals() });
  const dashboardQuery = useQuery({
    queryKey: ["financial-dashboard", yearMonth],
    queryFn: () => client.getFinancialDashboard(yearMonth),
    enabled: isOwner,
  });

  // Financial figures exist only for an Owner; a Field Manager never gets them
  // (the query is disabled and the API answers 403 anyway).
  const financials = isOwner ? dashboardQuery.data : undefined;

  const header = (
    <PageHeader
      title={t("title")}
      description={t("description", { month: fmt.month(yearMonth) })}
      actions={session ? <Badge tone="info">{enumLabel("OrgRole", session.role)}</Badge> : null}
    />
  );

  if (workersQuery.isLoading || pendingQuery.isLoading) {
    return (
      <div>
        {header}
        <LoadingState />
      </div>
    );
  }

  if (workersQuery.isError || pendingQuery.isError) {
    return (
      <div>
        {header}
        <Card>
          <ErrorState
            error={workersQuery.error ?? pendingQuery.error}
            onRetry={() => {
              if (workersQuery.isError) void workersQuery.refetch();
              if (pendingQuery.isError) void pendingQuery.refetch();
            }}
          />
        </Card>
      </div>
    );
  }

  const activeWorkers = (workersQuery.data ?? []).filter((w) => w.accountStatus === "ACTIVE").length;

  return (
    <div className="space-y-6">
      {header}

      {/* Two columns until xl: four columns next to the sidebar are too narrow for "₪ 123,456.78". */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("stats.activeWorkers")} value={fmt.number(activeWorkers)} />
        <StatCard label={t("stats.pendingApprovals")} value={fmt.number(pendingQuery.data?.length ?? 0)} />
        {financials && (
          <>
            <StatCard
              label={t("stats.payrollThisMonth")}
              value={<Money agorot={financials.totalCurrentMonthPayrollAgorot} />}
              hint={t.rich("stats.previousMonth", {
                amount: fmt.money(financials.totalPreviousMonthPayrollAgorot),
                ltr: (chunks) => <LtrText>{chunks}</LtrText>,
              })}
            />
            <StatCard label={t("stats.overtimeCost")} value={<Money agorot={financials.overtimeTotalAgorot} />} />
          </>
        )}
      </div>

      {isOwner && dashboardQuery.isLoading && (
        <Card>
          <LoadingState label={t("financial.loading")} />
        </Card>
      )}

      {isOwner && dashboardQuery.isError && (
        <Card>
          <ErrorState error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} />
        </Card>
      )}

      {financials && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("costByProject.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <CostByProject items={financials.costByProject} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("exposure.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">{t("exposure.pendingApprovalEstimate")}</dt>
                  <dd>
                    <Money agorot={financials.pendingApprovalFinancialExposureAgorot} className="font-medium text-slate-900" />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">{t("exposure.forgottenStampDeductions")}</dt>
                  <dd>
                    <Money agorot={financials.forgottenStampDeductionsAgorot} className="font-medium text-slate-900" />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      )}

      {!isOwner && (
        <Card>
          <CardContent className="py-5 text-sm text-slate-600">{t("financial.ownersOnly")}</CardContent>
        </Card>
      )}
    </div>
  );
}
