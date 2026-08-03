"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { ShiftType, CheckInMethod } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function NewShiftPage() {
  const router = useRouter();
  const { client } = useAuth();
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => client.listProjects() });
  const [projectId, setProjectId] = useState("");
  const sitesQuery = useQuery({ queryKey: ["sites", projectId], queryFn: () => client.listSites(projectId), enabled: !!projectId });

  const [title, setTitle] = useState("");
  const [shiftType, setShiftType] = useState<ShiftType>(ShiftType.STANDARD);
  const [siteId, setSiteId] = useState("");
  const [checkInMethod, setCheckInMethod] = useState<CheckInMethod>(CheckInMethod.GEOFENCED);
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60_000);
  const inNineHours = new Date(now.getTime() + 9 * 60 * 60_000);
  const [start, setStart] = useState(toLocalInputValue(inOneHour));
  const [end, setEnd] = useState(toLocalInputValue(inNineHours));
  const [error, setError] = useState<string | null>(null);

  const selectedSite = sitesQuery.data?.find((s) => s.id === siteId);
  const geofenceId = selectedSite?.geofences?.[0]?.id;

  const createShift = useMutation({
    mutationFn: () =>
      client.createShift({
        title,
        shiftType,
        projectId: projectId || undefined,
        siteId: siteId || undefined,
        geofenceId: checkInMethod === CheckInMethod.GEOFENCED ? geofenceId : undefined,
        checkInMethod,
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
      }),
    onSuccess: (shift) => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      router.replace(`/shifts/${(shift as { id: string }).id}`);
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to create shift."),
  });

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">New shift</h1>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning traffic control" />
          </div>

          <div>
            <Label htmlFor="type">Shift type</Label>
            <Select id="type" value={shiftType} onChange={(e) => setShiftType(e.target.value as ShiftType)}>
              {Object.values(ShiftType)
                .filter((t) => t !== ShiftType.EMERGENCY_CALLOUT)
                .map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="project">Project</Label>
            <Select id="project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setSiteId(""); }}>
              <option value="">— None —</option>
              {(projectsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          {projectId && (
            <div>
              <Label htmlFor="site">Site</Label>
              <Select id="site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">— None —</option>
                {(sitesQuery.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="checkin">Check-in method</Label>
            <Select id="checkin" value={checkInMethod} onChange={(e) => setCheckInMethod(e.target.value as CheckInMethod)}>
              <option value={CheckInMethod.GEOFENCED}>Geofenced</option>
              <option value={CheckInMethod.FLEXI_CHECK}>Flexi-Check</option>
            </Select>
            {checkInMethod === CheckInMethod.GEOFENCED && siteId && !geofenceId && (
              <p className="mt-1 text-xs text-amber-600">This site has no geofence configured yet.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start">Start</Label>
              <Input id="start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="end">End</Label>
              <Input id="end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button onClick={() => createShift.mutate()} disabled={createShift.isPending || !title}>
            {createShift.isPending ? "Creating…" : "Create shift"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
