"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { OwnerOnly } from "@/components/owner-only";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

function PayrollPageContent() {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const periodsQuery = useQuery({ queryKey: ["payroll-periods"], queryFn: () => client.listPayrollPeriods() });

  const calculateCurrent = useMutation({
    mutationFn: () => client.calculatePayroll(currentYearMonth(), `web-calc-${Date.now()}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll-periods"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to calculate payroll."),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payroll</h1>
          <p className="text-sm text-slate-500">Owner-only. Calculate, review, and finalize monthly payroll.</p>
        </div>
        <Button onClick={() => calculateCurrent.mutate()} disabled={calculateCurrent.isPending}>
          {calculateCurrent.isPending ? "Calculating…" : `Calculate ${currentYearMonth()}`}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Payroll periods</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {periodsQuery.isLoading && <LoadingState />}
          {periodsQuery.isError && <ErrorState message={(periodsQuery.error as Error).message} />}
          {periodsQuery.data && periodsQuery.data.length === 0 && (
            <EmptyState title="No payroll periods yet" description="Calculate the current month to get started." />
          )}
          {periodsQuery.data && periodsQuery.data.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Month</th>
                  <th className="px-5 py-3">Version</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {periodsQuery.data.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/payroll/${p.yearMonth}`} className="font-medium text-brand-700 hover:underline">
                        {p.yearMonth}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">v{p.version}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </td>
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

export default function PayrollPage() {
  return (
    <OwnerOnly>
      <PayrollPageContent />
    </OwnerOnly>
  );
}
