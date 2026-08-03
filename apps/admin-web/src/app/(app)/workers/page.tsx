"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { formatAgorot } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

export default function WorkersPage() {
  const { client } = useAuth();
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const pendingQuery = useQuery({ queryKey: ["workers-pending"], queryFn: () => client.listPendingApproval() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Workers</h1>
        <p className="text-sm text-slate-500">Roster, onboarding approvals, and compensation.</p>
      </div>

      {pendingQuery.data && pendingQuery.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending approval ({pendingQuery.data.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingQuery.data.map((p) => (
              <div key={p.membershipId} className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{p.fullLegalName}</p>
                  <p className="text-xs text-slate-500">{p.phoneNumber}</p>
                </div>
                <Link href={`/workers/${p.workerProfileId}/approve`} className="text-sm font-medium text-brand-600 hover:underline">
                  Review application →
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All workers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {workersQuery.isLoading && <LoadingState />}
          {workersQuery.isError && <ErrorState message={(workersQuery.error as Error).message} />}
          {workersQuery.data && workersQuery.data.length === 0 && <EmptyState title="No workers yet" description="Invite a worker to get started." />}
          {workersQuery.data && workersQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Phone</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Compensation</th>
                  </tr>
                </thead>
                <tbody>
                  {workersQuery.data.map((w) => (
                    <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/workers/${w.id}`} className="font-medium text-brand-700 hover:underline">
                          {w.fullLegalName}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{w.phoneNumber}</td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(w.accountStatus)}>{w.accountStatus}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {w.compensation
                          ? w.compensation.compensationType === "DAILY"
                            ? `${formatAgorot(w.compensation.dailyBaseRateAgorot)}/day`
                            : `${formatAgorot(w.compensation.baseHourlyRateAgorot)}/hr`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
