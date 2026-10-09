"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth-context";
import { getErrorCode } from "@fieldmaster/i18n";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { useShiftTitle } from "@/lib/shift-title";
import { DateTimeText, LtrText } from "@/components/formatted";
import { ArrowStartIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/ui/states";

function BackToShifts() {
  const t = useTranslations("shifts");
  return (
    <Link href="/shifts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
      <ArrowStartIcon />
      {t("backToList")}
    </Link>
  );
}

export default function ShiftDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { client } = useAuth();
  const t = useTranslations("shifts");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const shiftTitle = useShiftTitle();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [selectedWorkerId, setSelectedWorkerId] = useState("");

  const shiftQuery = useQuery({ queryKey: ["shift", id], queryFn: () => client.getShift(id) });
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });

  const assignWorker = useMutation({
    mutationFn: (workerProfileId: string) => client.assignWorkerToShift(id, workerProfileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift", id] });
      setSelectedWorkerId("");
    },
  });

  if (shiftQuery.isLoading) return <LoadingState />;
  if (shiftQuery.isError) {
    return (
      <div className="max-w-2xl space-y-4">
        <BackToShifts />
        <ErrorState error={shiftQuery.error} onRetry={() => void shiftQuery.refetch()} />
      </div>
    );
  }
  const shift = shiftQuery.data;
  if (!shift) return <LoadingState />;

  const assignments = shift.assignments ?? [];
  const assignedIds = new Set(assignments.map((a) => a.workerProfileId));
  const unassignedWorkers = (workersQuery.data ?? []).filter((w) => !assignedIds.has(w.id) && w.accountStatus === "ACTIVE");
  const canAssign = !!selectedWorkerId && !assignWorker.isPending;

  function submitAssignment(event: FormEvent) {
    event.preventDefault();
    if (canAssign) assignWorker.mutate(selectedWorkerId);
  }

  // The API answers CONFLICT here only when the worker already has an overlapping shift.
  const assignError = assignWorker.error
    ? getErrorCode(assignWorker.error) === "CONFLICT"
      ? t("detail.assign.overlap")
      : errorMessage(assignWorker.error)
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <BackToShifts />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-2xl font-bold text-slate-900">{shiftTitle(shift)}</h1>
          <Badge tone={statusTone(shift.status)}>{enumLabel("ShiftStatus", shift.status)}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("detail.details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label={t("detail.fields.type")}>{enumLabel("ShiftType", shift.shiftType)}</Row>
            <Row label={t("detail.fields.checkInMethod")}>{enumLabel("CheckInMethod", shift.checkInMethod)}</Row>
            <Row label={t("detail.fields.start")}>
              <DateTimeText value={shift.scheduledStart} />
            </Row>
            <Row label={t("detail.fields.end")}>
              <DateTimeText value={shift.scheduledEnd} />
            </Row>
            {shift.site && <Row label={t("detail.fields.site")}>{shift.site.name}</Row>}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("detail.assigned.title", { count: assignments.length })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {assignments.length > 0 ? (
            <ul className="space-y-1 text-sm text-slate-700">
              {assignments.map((a) => {
                const worker = workersQuery.data?.find((w) => w.id === a.workerProfileId);
                return <li key={a.id}>{worker ? worker.fullLegalName : <LtrText>{a.workerProfileId}</LtrText>}</li>;
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{t("detail.assigned.empty")}</p>
          )}

          <form noValidate onSubmit={submitAssignment} className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Label htmlFor="assign-worker">{t("detail.assign.label")}</Label>
                <Select
                  id="assign-worker"
                  value={selectedWorkerId}
                  onChange={(e) => setSelectedWorkerId(e.target.value)}
                  disabled={workersQuery.isLoading}
                >
                  <option value="">{workersQuery.isLoading ? t("detail.assign.loadingWorkers") : t("detail.assign.placeholder")}</option>
                  {unassignedWorkers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.fullLegalName}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" disabled={!canAssign}>
                {assignWorker.isPending ? t("detail.assign.submitting") : t("detail.assign.submit")}
              </Button>
            </div>
            {workersQuery.isError && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-600">
                <span>{errorMessage(workersQuery.error)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void workersQuery.refetch()}>
                  {tc("retry")}
                </Button>
              </div>
            )}
            {workersQuery.isSuccess && unassignedWorkers.length === 0 && <p className="text-xs text-slate-500">{t("detail.assign.noneAvailable")}</p>}
            <div aria-live="polite">
              {assignError ? (
                <p role="alert" className="text-sm text-red-600">
                  {assignError}
                </p>
              ) : null}
              {!assignError && assignWorker.isSuccess ? <p className="text-sm text-emerald-700">{t("detail.assign.success")}</p> : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-end font-medium text-slate-900">{children}</dd>
    </div>
  );
}
