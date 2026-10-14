"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Permission } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useAccess, useRoleLabel } from "@/lib/use-access";
import { currentYearMonth } from "@/lib/business-date";
import { useFormat } from "@/lib/use-format";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { CostByProject, CostBySite } from "@/components/dashboard/cost-bars";
import { CostByWorker, TopEarners } from "@/components/dashboard/cost-by-worker";
import { DailyTrend } from "@/components/dashboard/daily-trend";
import { FinancialStatCards } from "@/components/dashboard/financial-stat-cards";
import { NetPayableHeadline } from "@/components/dashboard/net-payable-headline";
import { OvertimeSpikes } from "@/components/dashboard/overtime-spikes";
import { StatCard } from "@/components/dashboard/stat-card";
import { WorkersWithoutCompensation } from "@/components/dashboard/workers-without-compensation";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const fmt = useFormat();
  const { client } = useAuth();
  const { can, restricted } = useAccess();
  const roleLabel = useRoleLabel();
  const canSeeFinancials = can(Permission.VIEW_FINANCIALS) && can(Permission.VIEW_FINANCIAL_DASHBOARD);
  const canSeeWorkers = can(Permission.MANAGE_WORKERS);
  const canSeePending = can(Permission.APPROVE_ATTENDANCE);
  const yearMonth = currentYearMonth();

  // Each count only for a member whose permissions open its list (the API refuses the others).
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers(), enabled: canSeeWorkers });
  const pendingQuery = useQuery({ queryKey: ["attendance-approvals-pending"], queryFn: () => client.listPendingAttendanceApprovals(), enabled: canSeePending });
  const dashboardQuery = useQuery({
    queryKey: ["financial-dashboard", yearMonth],
    queryFn: () => client.getFinancialDashboard(yearMonth),
    enabled: canSeeFinancials,
  });

  // Financial figures exist only for a member with the financial dashboard (VIEW_FINANCIAL_DASHBOARD);
  // anyone else never gets them (the query is disabled and the API answers 403 anyway).
  const financials = canSeeFinancials ? dashboardQuery.data : undefined;

  const header = (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", { month: fmt.month(yearMonth) })}
        actions={roleLabel ? <Badge tone="info">{roleLabel}</Badge> : null}
      />
      {restricted ? <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("restrictedScope")}</p> : null}
    </>
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

      {canSeeFinancials && dashboardQuery.isLoading && (
        <Card>
          <LoadingState label={t("financial.loading")} />
        </Card>
      )}

      {canSeeFinancials && dashboardQuery.isError && (
        <Card>
          <ErrorState error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} />
        </Card>
      )}

      {financials && <NetPayableHeadline data={financials} />}

      {/* Up to three columns: narrower cards next to the sidebar are too tight for "₪ 123,456.78". */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {canSeeWorkers ? <StatCard label={t("stats.activeWorkers")} value={fmt.number(activeWorkers)} /> : null}
        {canSeePending ? <StatCard label={t("stats.pendingApprovals")} value={fmt.number(pendingQuery.data?.length ?? 0)} /> : null}
        {financials && <FinancialStatCards data={financials} />}
      </div>

      {financials && (
        <>
          <WorkersWithoutCompensation workers={financials.workersWithoutCompensation} />
          <DailyTrend days={financials.dailyTrend} yearMonth={financials.yearMonth} />
          <div className="grid gap-4 lg:grid-cols-2">
            <CostByProject items={financials.costByProject} />
            <CostBySite items={financials.costBySite} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <CostByWorker workers={financials.costByWorker} yearMonth={financials.yearMonth} />
            </div>
            <TopEarners workers={financials.topEarners} />
          </div>
          <OvertimeSpikes overtime={financials.overtime} />
        </>
      )}

      {!canSeeFinancials && (
        <Card>
          <CardContent className="py-5 text-sm text-slate-600">{t("financial.ownersOnly")}</CardContent>
        </Card>
      )}
    </div>
  );
}
