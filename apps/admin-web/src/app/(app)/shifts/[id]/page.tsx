"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/ui/states";

export default function ShiftDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const shiftQuery = useQuery({ queryKey: ["shift", id], queryFn: () => client.getShift(id) });
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });

  const assignWorker = useMutation({
    mutationFn: (workerProfileId: string) => client.assignWorkerToShift(id, workerProfileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift", id] });
      setSelectedWorkerId("");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to assign worker."),
  });

  if (shiftQuery.isLoading) return <LoadingState />;
  if (shiftQuery.isError) return <ErrorState message={(shiftQuery.error as Error).message} />;
  const shift = shiftQuery.data!;
  const assignedIds = new Set((shift.assignments ?? []).map((a) => a.workerProfileId));
  const unassignedWorkers = (workersQuery.data ?? []).filter((w) => !assignedIds.has(w.id) && w.accountStatus === "ACTIVE");

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{shift.title}</h1>
        <Badge tone={statusTone(shift.status)}>{shift.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Type">{shift.shiftType.replace("_", " ")}</Row>
          <Row label="Check-in method">{shift.checkInMethod}</Row>
          <Row label="Start">{formatDateTime(shift.scheduledStart)}</Row>
          <Row label="End">{formatDateTime(shift.scheduledEnd)}</Row>
          {shift.site && <Row label="Site">{shift.site.name}</Row>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned workers ({shift.assignments?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {shift.assignments && shift.assignments.length > 0 ? (
            <ul className="space-y-1 text-sm text-slate-700">
              {shift.assignments.map((a) => {
                const worker = workersQuery.data?.find((w) => w.id === a.workerProfileId);
                return <li key={a.id}>{worker?.fullLegalName ?? a.workerProfileId}</li>;
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No workers assigned yet.</p>
          )}

          <div className="flex items-end gap-3 border-t border-slate-100 pt-4">
            <div className="flex-1">
              <Select value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)}>
                <option value="">Select a worker to assign…</option>
                {unassignedWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.fullLegalName}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              disabled={!selectedWorkerId || assignWorker.isPending}
              onClick={() => assignWorker.mutate(selectedWorkerId)}
            >
              Assign
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{children}</span>
    </div>
  );
}
