"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatAgorot, formatMinutes } from "@/lib/format";
import { OwnerOnly } from "@/components/owner-only";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/ui/states";

function PayrollPeriodContent() {
  const { yearMonth } = useParams<{ yearMonth: string }>();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const periodQuery = useQuery({ queryKey: ["payroll-period", yearMonth], queryFn: () => client.getPayrollPeriod(yearMonth) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["payroll-period", yearMonth] });

  const finalize = useMutation({
    mutationFn: () => client.finalizePayroll(yearMonth),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to finalize."),
  });
  const reopen = useMutation({
    mutationFn: () => client.reopenPayroll(yearMonth, "Correction needed after review"),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to reopen."),
  });

  if (periodQuery.isLoading) return <LoadingState />;
  if (periodQuery.isError) return <ErrorState message={(periodQuery.error as Error).message} />;
  const period = periodQuery.data!;
  const totalNet = (period.items ?? []).reduce((sum, i) => sum + i.netPayableAgorot, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Payroll — {period.yearMonth}</h1>
          <Badge tone={statusTone(period.status)}>{period.status}</Badge>
        </div>
        <div className="flex gap-2">
          {period.status === "REVIEW" && (
            <Button onClick={() => finalize.mutate()} disabled={finalize.isPending}>
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </Button>
          )}
          {period.status === "FINALIZED" && (
            <Button variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              {reopen.isPending ? "Reopening…" : "Reopen"}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Worker breakdown — total {formatAgorot(totalNet)}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(period.items?.length ?? 0) === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No payroll items yet. Run "Calculate" from the Payroll list.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Days</th>
                  <th className="px-5 py-3">Regular</th>
                  <th className="px-5 py-3">Overtime</th>
                  <th className="px-5 py-3">Gross</th>
                  <th className="px-5 py-3">Adjustments</th>
                  <th className="px-5 py-3">Net</th>
                </tr>
              </thead>
              <tbody>
                {(period.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{item.worker?.membership.user.fullLegalName ?? item.workerProfileId}</td>
                    <td className="px-5 py-3 text-slate-600">{item.standardDaysCredited}</td>
                    <td className="px-5 py-3 text-slate-600">{formatMinutes(item.regularMinutes)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatMinutes(item.overtimeMinutes)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatAgorot(item.grossBaseAgorot + item.overtimeAgorot)}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {item.positiveAdjustmentsAgorot > 0 && <span className="text-emerald-700">+{formatAgorot(item.positiveAdjustmentsAgorot)} </span>}
                      {item.deductionsAgorot > 0 && <span className="text-red-700">-{formatAgorot(item.deductionsAgorot)}</span>}
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-900">{formatAgorot(item.netPayableAgorot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PayrollPeriodPage() {
  return (
    <OwnerOnly>
      <PayrollPeriodContent />
    </OwnerOnly>
  );
}
