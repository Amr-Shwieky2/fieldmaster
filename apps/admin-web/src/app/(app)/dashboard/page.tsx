"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
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

      {financials && <NetPayableHeadline data={financials} />}

      {/* Up to three columns: narrower cards next to the sidebar are too tight for "₪ 123,456.78". */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label={t("stats.activeWorkers")} value={fmt.number(activeWorkers)} />
        <StatCard label={t("stats.pendingApprovals")} value={fmt.number(pendingQuery.data?.length ?? 0)} />
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

      {!isOwner && (
        <Card>
          <CardContent className="py-5 text-sm text-slate-600">{t("financial.ownersOnly")}</CardContent>
        </Card>
      )}
    </div>
  );
}
