"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { FieldMasterClient } from "@fieldmaster/api-client";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { useShiftTitle } from "@/lib/shift-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { DateTimeText, TimeText } from "@/components/formatted";
import { FlagBadges } from "@/components/attendance/flag-badges";
import type { SessionLogEntry } from "./types";

/**
 * "مشرف مؤقت" (Step 6): what the simulated worker sees as a temporary
 * supervisor, through the same API the mobile app will use (Step 9) and with
 * the worker's own session: their active assignments, the supervised
 * shift's workers (operational only), closing temporary points, and a
 * free-text issue report to management. The API checks the assignment live,
 * so a revoked or expired assignment, or a closed shift, answers 403 here.
 */
export function SupervisorPanel({
  client,
  queryClient,
  memberKey,
  onLog,
}: {
  client: FieldMasterClient;
  queryClient: QueryClient;
  memberKey: string;
  onLog: (entry: Omit<SessionLogEntry, "id" | "at">) => void;
}) {
  const t = useTranslations("workerSimulator.supervisor");
  const label = useEnumLabel();
  const shiftTitle = useShiftTitle();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const supervisionsQuery = useQuery({ queryKey: ["sim", memberKey, "supervisions"], queryFn: () => client.myTemporarySupervisions() }, queryClient);
  const supervisions = supervisionsQuery.data ?? [];

  // Keep a valid selection: the first active assignment, or none.
  useEffect(() => {
    if (supervisions.length === 0) setAssignmentId(null);
    else if (!assignmentId || !supervisions.some((supervision) => supervision.id === assignmentId)) setAssignmentId(supervisions[0].id);
  }, [supervisions, assignmentId]);

  const shiftQuery = useQuery(
    {
      queryKey: ["sim", memberKey, "supervised", assignmentId],
      queryFn: () => client.getSupervisedShift(assignmentId as string),
      enabled: assignmentId !== null,
    },
    queryClient,
  );
  const view = shiftQuery.data;

  const refresh = async () => {
    setNotice(null);
    await queryClient.invalidateQueries({ queryKey: ["sim", memberKey, "supervisions"] });
    const refreshed = assignmentId ? await shiftQuery.refetch() : null;
    onLog({
      action: "supervisorView",
      outcome: refreshed?.isError ? "error" : "success",
      message: refreshed?.isError ? errorMessage(refreshed.error) : undefined,
    });
  };

  // Mutations also use the worker's own QueryClient: nothing of the simulated session goes into the admin's cache.
  const report = useMutation(
    {
      mutationFn: (issue: string) => client.reportSupervisorIssue(assignmentId as string, issue),
      onSuccess: (result) => {
        setText("");
        setNotice(t("reported", { count: result.notifiedCount }));
        onLog({ action: "supervisorReport", outcome: "success" });
      },
      onError: (error) => onLog({ action: "supervisorReport", outcome: "error", message: errorMessage(error) }),
    },
    queryClient,
  );
  const closePoint = useMutation(
    {
      mutationFn: (pointId: string) => client.closeTemporaryCheckInPoint(pointId),
      onSuccess: (point) => {
        setNotice(t("pointClosed", { name: point.name }));
        onLog({ action: "closePoint", params: { name: point.name }, outcome: "success" });
        void shiftQuery.refetch();
      },
      onError: (error) => onLog({ action: "closePoint", outcome: "error", message: errorMessage(error) }),
    },
    queryClient,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    const issue = text.trim();
    if (issue === "") {
      setInvalid(true);
      return;
    }
    report.mutate(issue);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          {t("refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-slate-500">{t("description")}</p>
        {supervisionsQuery.isPending && <LoadingState />}
        {supervisionsQuery.isError && <ErrorState error={supervisionsQuery.error} onRetry={() => void supervisionsQuery.refetch()} />}
        {supervisionsQuery.isSuccess && supervisions.length === 0 ? <p className="text-slate-600">{t("none")}</p> : null}

        {supervisions.length > 1 ? (
          <div>
            <Label htmlFor={`${id}-assignment`}>{t("assignment")}</Label>
            <Select id={`${id}-assignment`} value={assignmentId ?? ""} onChange={(event) => setAssignmentId(event.target.value)}>
              {supervisions.map((supervision) => (
                <option key={supervision.id} value={supervision.id}>
                  {shiftTitle(supervision.shift)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div role="status" aria-live="polite">
          {notice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{notice}</p> : null}
        </div>

        {assignmentId && shiftQuery.isPending ? <LoadingState /> : null}
        {shiftQuery.isError ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">
            {errorMessage(shiftQuery.error)}
          </p>
        ) : null}
        {view ? (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-slate-900">
                <bdi>{shiftTitle(view.shift)}</bdi>
              </p>
              <p className="text-slate-600">
                {t.rich("window", {
                  from: () => <DateTimeText value={view.assignment.activatedAt} />,
                  to: () => <DateTimeText value={view.assignment.expiresAt} />,
                })}
              </p>
              <p className="text-slate-600">{view.assignment.canOpenCheckInPoints ? t("mayOpenPoints") : t("mayNotOpenPoints")}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("workersCaption")}</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th scope="col" className="px-2 py-1 text-start font-medium">
                      {t("columns.worker")}
                    </th>
                    <th scope="col" className="px-2 py-1 text-start font-medium">
                      {t("columns.presence")}
                    </th>
                    <th scope="col" className="px-2 py-1 text-start font-medium">
                      {t("columns.times")}
                    </th>
                    <th scope="col" className="px-2 py-1 text-start font-medium">
                      {t("columns.location")}
                    </th>
                    <th scope="col" className="px-2 py-1 text-start font-medium">
                      {t("columns.flags")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.workers.map((worker) => (
                    <tr key={worker.workerProfileId} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-2 py-1 font-medium">{worker.fullLegalName}</td>
                      <td className="px-2 py-1">{label("ShiftWorkerPresence", worker.presence)}</td>
                      <td className="px-2 py-1">
                        {worker.clockInAt ? (
                          t.rich("times", {
                            from: () => <TimeText value={worker.clockInAt} />,
                            to: () => (worker.clockOutAt ? <TimeText value={worker.clockOutAt} /> : t("open")),
                          })
                        ) : (
                          <span className="text-slate-500">{t("noTimes")}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">{worker.locationOutcome ? label("LocationValidationStatus", worker.locationOutcome) : t("noLocation")}</td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap gap-1">
                          <FlagBadges flags={worker.flags} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <p className="font-medium text-slate-900">{t("points")}</p>
              {view.temporaryCheckInPoints.length === 0 ? (
                <p className="text-slate-500">{t("noPoints")}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {view.temporaryCheckInPoints.map((point) => (
                    <li key={point.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{t("point", { name: point.name, radius: point.radiusMeters })}</span>
                      {view.assignment.canOpenCheckInPoints ? (
                        <Button size="sm" variant="secondary" onClick={() => closePoint.mutate(point.id)} disabled={closePoint.isPending}>
                          {t("closePoint")}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-slate-500">{t("openPointHint")}</p>
              {closePoint.isError ? (
                <p role="alert" className="mt-1 text-red-600">
                  {errorMessage(closePoint.error)}
                </p>
              ) : null}
            </div>

            <form noValidate onSubmit={submit} className="space-y-2 border-t border-slate-100 pt-3">
              <Label htmlFor={`${id}-issue`}>{t("issueLabel")}</Label>
              <textarea
                id={`${id}-issue`}
                dir="auto"
                rows={3}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setInvalid(false);
                }}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${id}-issue-error` : `${id}-issue-hint`}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              {invalid ? (
                <p id={`${id}-issue-error`} role="alert" className="text-xs text-red-600">
                  {t("issueRequired")}
                </p>
              ) : (
                <p id={`${id}-issue-hint`} className="text-xs text-slate-500">
                  {t("issueHint")}
                </p>
              )}
              {report.isError ? (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">
                  {errorMessage(report.error)}
                </p>
              ) : null}
              <Button type="submit" size="sm" disabled={report.isPending}>
                {report.isPending ? t("reporting") : t("report")}
              </Button>
            </form>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
