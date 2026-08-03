"use client";

import { useQuery } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { formatAgorot } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState, ErrorState } from "@/components/ui/states";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
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

  if (workersQuery.isLoading || pendingQuery.isLoading) return <LoadingState />;
  if (workersQuery.isError) return <ErrorState message={(workersQuery.error as Error).message} />;

  const activeWorkers = (workersQuery.data ?? []).filter((w) => w.accountStatus === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">{isOwner ? "Owner view" : "Field Manager view"} — {yearMonth}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Active workers" value={String(activeWorkers)} />
        <StatCard label="Pending approvals" value={String(pendingQuery.data?.length ?? 0)} />
        {isOwner && dashboardQuery.data && (
          <>
            <StatCard label="Payroll this month" value={formatAgorot(dashboardQuery.data.totalCurrentMonthPayrollAgorot)} hint={`vs. ${formatAgorot(dashboardQuery.data.totalPreviousMonthPayrollAgorot)} last month`} />
            <StatCard label="Overtime cost" value={formatAgorot(dashboardQuery.data.overtimeTotalAgorot)} />
          </>
        )}
      </div>

      {isOwner && dashboardQuery.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cost by project</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboardQuery.data.costByProject.length === 0 ? (
                <p className="text-sm text-slate-500">No approved, costed shifts yet this month.</p>
              ) : (
                <ul className="space-y-2">
                  {dashboardQuery.data.costByProject.map((p) => (
                    <li key={p.projectId ?? "unassigned"} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{p.projectName}</span>
                      <span className="font-medium text-slate-900">{formatAgorot(p.totalAgorot)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Financial exposure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Pending-approval estimate</span>
                <span className="font-medium text-slate-900">{formatAgorot(dashboardQuery.data.pendingApprovalFinancialExposureAgorot)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Forgotten-stamp deductions</span>
                <span className="font-medium text-slate-900">{formatAgorot(dashboardQuery.data.forgottenStampDeductionsAgorot)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!isOwner && (
        <Card>
          <CardContent className="py-5 text-sm text-slate-500">
            Financial figures are visible to Owners only.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
