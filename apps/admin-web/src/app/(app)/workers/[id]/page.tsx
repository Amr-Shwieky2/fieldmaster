"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { formatAgorot, formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/ui/states";

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { client } = useAuth();
  const workerQuery = useQuery({ queryKey: ["worker", id], queryFn: () => client.getWorker(id) });

  if (workerQuery.isLoading) return <LoadingState />;
  if (workerQuery.isError) return <ErrorState message={(workerQuery.error as Error).message} />;
  const worker = workerQuery.data!;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{worker.fullLegalName}</h1>
        <p className="text-sm text-slate-500">{worker.phoneNumber}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Status">
            <Badge tone={statusTone(worker.accountStatus)}>{worker.accountStatus}</Badge>
          </Row>
          <Row label="Role">{worker.role.replace("_", " ")}</Row>
          <Row label="Joined">{formatDateTime(worker.createdAt)}</Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compensation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {worker.compensation ? (
            <div className="space-y-3">
              <Row label="Type">{worker.compensation.compensationType}</Row>
              {worker.compensation.compensationType === "DAILY" ? (
                <Row label="Daily rate">{formatAgorot(worker.compensation.dailyBaseRateAgorot)}</Row>
              ) : (
                <Row label="Hourly rate">{formatAgorot(worker.compensation.baseHourlyRateAgorot)}</Row>
              )}
              <Row label="Overtime rate">{formatAgorot(worker.compensation.overtimeHourlyRateAgorot)}/hr</Row>
              <Row label="Effective from">{worker.compensation.effectiveStartDate}</Row>
            </div>
          ) : (
            <p className="text-slate-500">
              {worker.accountStatus === "ACTIVE"
                ? "No compensation profile visible."
                : "Compensation is not visible to your role, or this worker has none on file."}
            </p>
          )}
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
