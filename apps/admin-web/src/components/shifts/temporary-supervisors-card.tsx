"use client";

import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Shift, TemporarySupervisorListItem } from "@fieldmaster/api-client";
import { ShiftStatus, TemporarySupervisorState } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { fromJerusalemInputValue, toJerusalemInputValue } from "@/lib/jerusalem-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { DateTimeText } from "@/components/formatted";

const STATE_TONE: Record<TemporarySupervisorState, "success" | "info" | "neutral" | "danger"> = {
  ACTIVE: "success",
  UPCOMING: "info",
  EXPIRED: "neutral",
  REVOKED: "danger",
};

/** Assignments that can still be revoked. */
const REVOCABLE: TemporarySupervisorState[] = [TemporarySupervisorState.ACTIVE, TemporarySupervisorState.UPCOMING];

/**
 * A shift's temporary supervisors (Step 6): who, when, and whether they may
 * open temporary check-in points; assign a worker of this shift, or revoke.
 * Access is checked live by the API, so a revoked or expired assignment, or
 * a closed shift, ends it at once.
 */
export function TemporarySupervisorsCard({ shift, workerNames }: { shift: Shift; workerNames: Map<string, string> }) {
  const t = useTranslations("shifts.supervisors");
  const label = useEnumLabel();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const listQuery = useQuery({ queryKey: ["temporary-supervisors", shift.id], queryFn: () => client.listShiftTemporarySupervisors(shift.id) });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: (assignment: TemporarySupervisorListItem) => client.revokeTemporarySupervisor(assignment.id),
    onSuccess: (_result, assignment) => {
      setConfirming(null);
      setAnnouncement(t("revoked", { name: assignment.worker.fullLegalName }));
      void queryClient.invalidateQueries({ queryKey: ["temporary-supervisors", shift.id] });
    },
  });

  const shiftOpen = shift.status !== ShiftStatus.CLOSED && shift.status !== ShiftStatus.CANCELLED;
  const assignments = listQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-slate-500">{t("description")}</p>
        <div role="status" aria-live="polite">
          {announcement ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{announcement}</p> : null}
        </div>

        {listQuery.isPending && <LoadingState />}
        {listQuery.isError && <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />}
        {listQuery.isSuccess && assignments.length === 0 ? <p className="text-slate-500">{t("empty")}</p> : null}
        {assignments.length > 0 ? (
          <ul className="space-y-3">
            {assignments.map((assignment) => (
              <li key={assignment.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{assignment.worker.fullLegalName}</p>
                  <Badge tone={STATE_TONE[assignment.state]}>{label("TemporarySupervisorState", assignment.state)}</Badge>
                </div>
                <p className="mt-1 text-slate-600">
                  {t.rich("window", { from: () => <DateTimeText value={assignment.activatedAt} />, to: () => <DateTimeText value={assignment.expiresAt} /> })}
                </p>
                <p className="text-slate-600">{assignment.canOpenCheckInPoints ? t("mayOpenPoints") : t("mayNotOpenPoints")}</p>
                <p className="text-xs text-slate-500">
                  {t.rich("assignedBy", { name: assignment.assignedByName ?? t("unknownActor"), time: () => <DateTimeText value={assignment.createdAt} /> })}
                </p>
                {assignment.revokedAt ? (
                  <p className="text-xs text-slate-500">
                    {t.rich("revokedBy", { name: assignment.revokedByName ?? t("unknownActor"), time: () => <DateTimeText value={assignment.revokedAt} /> })}
                  </p>
                ) : null}
                {REVOCABLE.includes(assignment.state) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {confirming === assignment.id ? (
                      <>
                        <span className="text-slate-700">{t("confirmRevoke", { name: assignment.worker.fullLegalName })}</span>
                        <Button size="sm" variant="danger" onClick={() => revoke.mutate(assignment)} disabled={revoke.isPending}>
                          {revoke.isPending ? t("revoking") : t("confirmRevokeAction")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            revoke.reset();
                            setConfirming(null);
                          }}
                          disabled={revoke.isPending}
                        >
                          {t("cancel")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          revoke.reset();
                          setAnnouncement(null);
                          setConfirming(assignment.id);
                        }}
                        aria-label={t("revokeFor", { name: assignment.worker.fullLegalName })}
                      >
                        {t("revoke")}
                      </Button>
                    )}
                  </div>
                ) : null}
                {revoke.isError && revoke.variables?.id === assignment.id ? (
                  <p role="alert" className="mt-2 text-red-600">
                    {errorMessage(revoke.error)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {shiftOpen ? (
          <AssignForm shift={shift} workerNames={workerNames} onAssigned={(name) => setAnnouncement(t("assigned", { name }))} />
        ) : (
          <p className="border-t border-slate-100 pt-4 text-slate-500">{t("shiftNotOpen")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function AssignForm({ shift, workerNames, onAssigned }: { shift: Shift; workerNames: Map<string, string>; onAssigned: (name: string) => void }) {
  const tForm = useTranslations("shifts.supervisors.form");
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [workerProfileId, setWorkerProfileId] = useState("");
  const [activatedAt, setActivatedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => toJerusalemInputValue(shift.scheduledEnd));
  const [canOpenCheckInPoints, setCanOpenCheckInPoints] = useState(true);
  const [showErrors, setShowErrors] = useState(false);

  const candidates = (shift.assignments ?? []).map((assignment) => ({
    id: assignment.workerProfileId,
    name: workerNames.get(assignment.workerProfileId) ?? null,
  }));
  const activation = activatedAt ? fromJerusalemInputValue(activatedAt) : null;
  const expiry = fromJerusalemInputValue(expiresAt);
  const problems = {
    worker: workerProfileId === "" ? tForm("errors.workerRequired") : null,
    // The API's rule: after the start (if any) and in the future.
    expiresAt: !expiry
      ? tForm("errors.expiryRequired")
      : expiry <= new Date() || (activation !== null && expiry <= activation)
        ? tForm("errors.expiryBeforeStart")
        : null,
  };

  const assign = useMutation({
    mutationFn: () =>
      client.assignTemporarySupervisor(shift.id, {
        workerProfileId,
        ...(activation ? { activatedAt: activation.toISOString() } : {}),
        expiresAt: expiry!.toISOString(),
        canOpenCheckInPoints,
      }),
    onSuccess: () => {
      onAssigned(workerNames.get(workerProfileId) ?? "");
      setWorkerProfileId("");
      setActivatedAt("");
      setShowErrors(false);
      void queryClient.invalidateQueries({ queryKey: ["temporary-supervisors", shift.id] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (problems.worker || problems.expiresAt) return;
    assign.mutate();
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-3 border-t border-slate-100 pt-4" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-semibold text-slate-900">
        {tForm("title")}
      </h3>
      {candidates.length === 0 ? <p className="text-slate-500">{tForm("noWorkers")}</p> : null}
      <div>
        <Label htmlFor={`${id}-worker`}>{tForm("worker")}</Label>
        <Select
          id={`${id}-worker`}
          value={workerProfileId}
          onChange={(event) => setWorkerProfileId(event.target.value)}
          aria-invalid={(showErrors && !!problems.worker) || undefined}
          aria-describedby={showErrors && problems.worker ? `${id}-worker-error` : undefined}
        >
          <option value="">{tForm("workerPlaceholder")}</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name ?? tForm("unnamedWorker")}
            </option>
          ))}
        </Select>
        {showErrors && problems.worker ? (
          <p id={`${id}-worker-error`} role="alert" className="mt-1 text-xs text-red-600">
            {problems.worker}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-slate-500">{tForm("workerHint")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-from`}>{tForm("activatedAt")}</Label>
          <Input id={`${id}-from`} type="datetime-local" dir="ltr" value={activatedAt} onChange={(event) => setActivatedAt(event.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{tForm("activatedAtHint")}</p>
        </div>
        <div>
          <Label htmlFor={`${id}-to`}>{tForm("expiresAt")}</Label>
          <Input
            id={`${id}-to`}
            type="datetime-local"
            dir="ltr"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            aria-invalid={(showErrors && !!problems.expiresAt) || undefined}
            aria-describedby={showErrors && problems.expiresAt ? `${id}-to-error` : undefined}
          />
          {showErrors && problems.expiresAt ? (
            <p id={`${id}-to-error`} role="alert" className="mt-1 text-xs text-red-600">
              {problems.expiresAt}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">{tForm("expiresAtHint")}</p>
          )}
        </div>
      </div>
      <label className="flex items-center gap-2 text-slate-800">
        <input type="checkbox" checked={canOpenCheckInPoints} onChange={(event) => setCanOpenCheckInPoints(event.target.checked)} />
        {tForm("canOpenCheckInPoints")}
      </label>
      {assign.isError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">
          {errorMessage(assign.error)}
        </p>
      ) : null}
      <Button type="submit" disabled={assign.isPending || candidates.length === 0}>
        {assign.isPending ? tForm("submitting") : tForm("submit")}
      </Button>
    </form>
  );
}
