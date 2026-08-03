"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { TuranType } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TuranPage() {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const assignmentsQuery = useQuery({ queryKey: ["turan-assignments"], queryFn: () => client.listTuranAssignments() });
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });

  const [turanType, setTuranType] = useState<TuranType>(TuranType.NIGHT_TURAN);
  const [workerProfileId, setWorkerProfileId] = useState("");
  const now = new Date();
  const [startAt, setStartAt] = useState(toLocalInputValue(now));
  const [endAt, setEndAt] = useState(toLocalInputValue(new Date(now.getTime() + 8 * 3_600_000)));
  const [notes, setNotes] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["turan-assignments"] });

  const create = useMutation({
    mutationFn: () =>
      client.createTuranAssignment({
        turanType,
        assignedWorkerProfileId: workerProfileId,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        notes: notes || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setWorkerProfileId("");
      setNotes("");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to create assignment."),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => client.cancelTuranAssignment(id),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to cancel assignment."),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Turan &amp; Emergency</h1>
        <p className="text-sm text-slate-500">
          Day/Night Turan on-call scheduling. Emergency call-outs started from a Night Turan assignment appear in{" "}
          <span className="font-medium">Scheduling</span> as their own shift.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New assignment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="turan-type">Type</Label>
              <Select id="turan-type" value={turanType} onChange={(e) => setTuranType(e.target.value as TuranType)}>
                <option value={TuranType.DAY_TURAN}>Day Turan</option>
                <option value={TuranType.NIGHT_TURAN}>Night Turan</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="turan-worker">Worker</Label>
              <Select id="turan-worker" value={workerProfileId} onChange={(e) => setWorkerProfileId(e.target.value)}>
                <option value="">Select a worker…</option>
                {(workersQuery.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.fullLegalName}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="turan-start">Start</Label>
              <Input id="turan-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="turan-end">End</Label>
              <Input id="turan-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="turan-notes">Notes (optional)</Label>
            <Input id="turan-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button onClick={() => create.mutate()} disabled={create.isPending || !workerProfileId}>
            {create.isPending ? "Creating…" : "Create assignment"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {assignmentsQuery.isLoading && <LoadingState />}
          {assignmentsQuery.isError && <ErrorState message={(assignmentsQuery.error as Error).message} />}
          {assignmentsQuery.data && assignmentsQuery.data.length === 0 && <EmptyState title="No Turan assignments yet" />}
          {assignmentsQuery.data && assignmentsQuery.data.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Start</th>
                  <th className="px-5 py-3">End</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {assignmentsQuery.data.map((a) => {
                  const worker = workersQuery.data?.find((w) => w.id === a.assignedWorkerProfileId);
                  return (
                    <tr key={a.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 text-slate-600">{a.turanType.replace("_", " ")}</td>
                      <td className="px-5 py-3 font-medium text-slate-900">{worker?.fullLegalName ?? a.assignedWorkerProfileId}</td>
                      <td className="px-5 py-3 text-slate-600">{formatDateTime(a.startAt)}</td>
                      <td className="px-5 py-3 text-slate-600">{formatDateTime(a.endAt)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        {a.status === "SCHEDULED" && (
                          <Button size="sm" variant="danger" onClick={() => cancel.mutate(a.id)} disabled={cancel.isPending}>
                            Cancel
                          </Button>
                        )}
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
