"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

function currentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function ReportsPage() {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ downloadUrl: string; includesFinancials: boolean } | null>(null);

  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const reportsQuery = useQuery({ queryKey: ["reports"], queryFn: () => client.listReports() });

  const [workerProfileId, setWorkerProfileId] = useState("");
  const range = currentMonthRange();
  const [fromDate, setFromDate] = useState(range.from);
  const [toDate, setToDate] = useState(range.to);

  const generate = useMutation({
    mutationFn: () => client.generateWorkerLedger({ workerProfileId, fromDate, toDate }, `web-report-${Date.now()}`),
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to generate report."),
  });

  const download = useMutation({
    mutationFn: (id: string) => client.getReportDownloadUrl(id),
    onSuccess: (result) => {
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to get download link."),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">
          Worker Attendance Ledger — tamper-evident PDF with GPS evidence, corrections, and approvals. Financial figures
          only appear for Owners generating for any worker, or a worker generating their own.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate a report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="report-worker">Worker</Label>
            <Select id="report-worker" value={workerProfileId} onChange={(e) => setWorkerProfileId(e.target.value)}>
              <option value="">Select a worker…</option>
              {(workersQuery.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.fullLegalName}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="report-from">From</Label>
              <Input id="report-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="report-to">To</Label>
              <Input id="report-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button onClick={() => generate.mutate()} disabled={generate.isPending || !workerProfileId}>
            {generate.isPending ? "Generating…" : "Generate PDF"}
          </Button>

          {lastResult && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <p className="font-medium text-emerald-800">
                Report ready {lastResult.includesFinancials ? "(includes financial figures)" : "(operational only — no financial figures)"}
              </p>
              <a href={lastResult.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">
                Open PDF
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Past reports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {reportsQuery.isLoading && <LoadingState />}
          {reportsQuery.isError && <ErrorState message={(reportsQuery.error as Error).message} />}
          {reportsQuery.data && reportsQuery.data.length === 0 && <EmptyState title="No reports generated yet" />}
          {reportsQuery.data && reportsQuery.data.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Generated</th>
                  <th className="px-5 py-3">Financials</th>
                  <th className="px-5 py-3">Hash</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {reportsQuery.data.map((r) => {
                  const worker = workersQuery.data?.find((w) => w.id === r.subjectWorkerProfileId);
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-900">{worker?.fullLegalName ?? r.subjectWorkerProfileId}</td>
                      <td className="px-5 py-3 text-slate-600">{formatDateTime(r.generatedAt)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={r.includesFinancials ? "info" : "neutral"}>{r.includesFinancials ? "Included" : "Operational only"}</Badge>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-400">{r.sha256Hash.slice(0, 16)}…</td>
                      <td className="px-5 py-3">
                        <Button size="sm" variant="secondary" onClick={() => download.mutate(r.id)} disabled={download.isPending}>
                          Download
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
