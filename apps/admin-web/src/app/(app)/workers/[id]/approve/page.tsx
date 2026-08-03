"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export default function ApproveWorkerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { client } = useAuth();
  const queryClient = useQueryClient();

  const [compensationType, setCompensationType] = useState<"DAILY" | "HOURLY">("DAILY");
  const [dailyRate, setDailyRate] = useState("400");
  const [hourlyRate, setHourlyRate] = useState("50");
  const [overtimeRate, setOvertimeRate] = useState("60");
  const [error, setError] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: () =>
      client.approveWorker(id, {
        compensationType,
        dailyBaseRateAgorot: compensationType === "DAILY" ? Math.round(Number(dailyRate) * 100) : undefined,
        baseHourlyRateAgorot: compensationType === "HOURLY" ? Math.round(Number(hourlyRate) * 100) : undefined,
        overtimeHourlyRateAgorot: Math.round(Number(overtimeRate) * 100),
        effectiveStartDate: new Date().toISOString().slice(0, 10),
        changeReason: "Initial onboarding approval",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers-pending"] });
      queryClient.invalidateQueries({ queryKey: ["workers"] });
      router.replace("/workers");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to approve worker."),
  });

  const reject = useMutation({
    mutationFn: () => client.rejectWorker(id, "Rejected during admin review."),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers-pending"] });
      router.replace("/workers");
    },
  });

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Approve worker</h1>
        <p className="text-sm text-slate-500">Set compensation to activate this worker's account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Compensation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="type">Compensation type</Label>
            <Select id="type" value={compensationType} onChange={(e) => setCompensationType(e.target.value as "DAILY" | "HOURLY")}>
              <option value="DAILY">Daily rate</option>
              <option value="HOURLY">Hourly rate</option>
            </Select>
          </div>

          {compensationType === "DAILY" ? (
            <div>
              <Label htmlFor="daily">Daily rate (ILS)</Label>
              <Input id="daily" type="number" min={0} value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="hourly">Hourly rate (ILS)</Label>
              <Input id="hourly" type="number" min={0} value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            </div>
          )}

          <div>
            <Label htmlFor="overtime">Overtime rate (ILS/hr)</Label>
            <Input id="overtime" type="number" min={0} value={overtimeRate} onChange={(e) => setOvertimeRate(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? "Approving…" : "Approve worker"}
            </Button>
            <Button variant="danger" onClick={() => reject.mutate()} disabled={reject.isPending}>
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
