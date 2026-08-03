"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

export default function AttendancePage() {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const pendingQuery = useQuery({ queryKey: ["attendance-approvals-pending"], queryFn: () => client.listPendingAttendanceApprovals() });
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["attendance-approvals-pending"] });

  const approve = useMutation({
    mutationFn: (id: string) => client.approveTimeEntry(id),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to approve."),
  });
  const reject = useMutation({
    mutationFn: (id: string) => client.rejectTimeEntry(id, "Rejected during review."),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to reject."),
  });
  const fullDayCredit = useMutation({
    mutationFn: (id: string) => client.applyFullDayCredit(id, "Weather stopped work"),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to apply full-day credit."),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Attendance approval</h1>
        <p className="text-sm text-slate-500">Review clocked shifts awaiting approval. No monetary figures are shown here.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {pendingQuery.isLoading && <LoadingState />}
      {pendingQuery.isError && <ErrorState message={(pendingQuery.error as Error).message} />}
      {pendingQuery.data && pendingQuery.data.length === 0 && <EmptyState title="Nothing to review" description="All clocked shifts are approved." />}

      <div className="space-y-4">
        {(pendingQuery.data ?? []).map((entry) => {
          const worker = workersQuery.data?.find((w) => w.id === entry.workerProfileId);
          const canCredit = entry.rawDurationMinutes !== null && entry.rawDurationMinutes < 540 && !entry.fullDayCredit;
          return (
            <Card key={entry.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{worker?.fullLegalName ?? entry.workerProfileId}</CardTitle>
                  <p className="text-sm text-slate-500">{entry.shift?.title}</p>
                </div>
                {entry.fullDayCredit && <Badge tone="info">Full-day credit applied</Badge>}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-slate-500">Clock-in</p>
                    <p className="font-medium">{formatDateTime(entry.clockInAt)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Clock-out</p>
                    <p className="font-medium">{formatDateTime(entry.clockOutAt)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Duration</p>
                    <p className="font-medium">{formatMinutes(entry.rawDurationMinutes)}</p>
                  </div>
                </div>
                {entry.dailySummary?.text && (
                  <div>
                    <p className="text-slate-500">Summary</p>
                    <p>{entry.dailySummary.text}</p>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => approve.mutate(entry.id)} disabled={approve.isPending}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => reject.mutate(entry.id)} disabled={reject.isPending}>
                    Reject
                  </Button>
                  {canCredit && (
                    <Button size="sm" variant="secondary" onClick={() => fullDayCredit.mutate(entry.id)} disabled={fullDayCredit.isPending}>
                      Credit as Full Day
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
