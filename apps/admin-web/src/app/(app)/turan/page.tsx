"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { TuranType } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { getErrorCode } from "@fieldmaster/i18n";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, LtrText } from "@/components/formatted";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The API answers 409 CONFLICT with `details.conflictingAssignmentId` when the
 * worker already has an overlapping SCHEDULED/ACTIVE assignment; the request
 * can then be repeated with `confirmOverlap: true`.
 */
function conflictingAssignmentId(error: unknown): string | null {
  if (getErrorCode(error) !== "CONFLICT") return null;
  const details = (error as { body?: { details?: unknown } }).body?.details;
  if (typeof details !== "object" || details === null) return null;
  const id = (details as Record<string, unknown>).conflictingAssignmentId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

type FormProblem = { key: "timesRequired" | "endBeforeStart" } | { cause: unknown };

export default function TuranPage() {
  const t = useTranslations("turan");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  // Messages are kept as keys or error causes and translated while rendering.
  const [formProblem, setFormProblem] = useState<FormProblem | null>(null);
  const [listFailure, setListFailure] = useState<{ cause: unknown } | null>(null);
  const [success, setSuccess] = useState<"created" | "cancelled" | null>(null);
  const formError = formProblem ? ("key" in formProblem ? t(`form.${formProblem.key}`) : errorMessage(formProblem.cause)) : null;
  const listError = listFailure ? errorMessage(listFailure.cause) : null;
  const successMessage = success ? t(`messages.${success}`) : null;
  const [overlapWith, setOverlapWith] = useState<string | null>(null);

  const assignmentsQuery = useQuery({ queryKey: ["turan-assignments"], queryFn: () => client.listTuranAssignments() });
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });

  const [turanType, setTuranType] = useState<TuranType>(TuranType.NIGHT_TURAN);
  const [workerProfileId, setWorkerProfileId] = useState("");
  const now = new Date();
  const [startAt, setStartAt] = useState(toLocalInputValue(now));
  const [endAt, setEndAt] = useState(toLocalInputValue(new Date(now.getTime() + 8 * 3_600_000)));
  const [notes, setNotes] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["turan-assignments"] });

  /** Any edit invalidates a pending overlap confirmation and a stale error. */
  const edited = () => {
    setOverlapWith(null);
    setFormProblem(null);
    setSuccess(null);
  };

  const create = useMutation({
    mutationFn: (confirmOverlap: boolean) =>
      client.createTuranAssignment({
        turanType,
        assignedWorkerProfileId: workerProfileId,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        notes: notes || undefined,
        ...(confirmOverlap ? { confirmOverlap: true } : {}),
      }),
    onSuccess: () => {
      void invalidate();
      setWorkerProfileId("");
      setNotes("");
      setOverlapWith(null);
      setSuccess("created");
    },
    onError: (err) => {
      const conflictId = conflictingAssignmentId(err);
      if (conflictId) {
        setOverlapWith(conflictId);
        return;
      }
      setOverlapWith(null);
      setFormProblem({ cause: err });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => client.cancelTuranAssignment(id),
    onSuccess: () => {
      void invalidate();
      setSuccess("cancelled");
    },
    onError: (err) => setListFailure({ cause: err }),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormProblem(null);
    setSuccess(null);
    setOverlapWith(null);
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setFormProblem({ key: "timesRequired" });
      return;
    }
    if (end <= start) {
      setFormProblem({ key: "endBeforeStart" });
      return;
    }
    create.mutate(false);
  };

  const workerName = (id: string) => workersQuery.data?.find((w) => w.id === id)?.fullLegalName ?? null;
  const conflicting = overlapWith ? assignmentsQuery.data?.find((a) => a.id === overlapWith) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t.rich("description", {
          scheduling: (chunks) => (
            <Link href="/shifts" className="font-medium text-brand-700 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      />

      <div role="status" aria-live="polite">
        {successMessage ? <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</p> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("form.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="turan-type">{t("form.type")}</Label>
                <Select
                  id="turan-type"
                  value={turanType}
                  onChange={(e) => {
                    edited();
                    setTuranType(e.target.value as TuranType);
                  }}
                >
                  <option value={TuranType.DAY_TURAN}>{enumLabel("TuranType", TuranType.DAY_TURAN)}</option>
                  <option value={TuranType.NIGHT_TURAN}>{enumLabel("TuranType", TuranType.NIGHT_TURAN)}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="turan-worker">{t("form.worker")}</Label>
                <Select
                  id="turan-worker"
                  value={workerProfileId}
                  aria-describedby={workersQuery.isError ? "turan-worker-error" : undefined}
                  onChange={(e) => {
                    edited();
                    setWorkerProfileId(e.target.value);
                  }}
                >
                  <option value="">{workersQuery.isLoading ? t("form.workersLoading") : t("form.workerPlaceholder")}</option>
                  {(workersQuery.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.fullLegalName}
                    </option>
                  ))}
                </Select>
                {workersQuery.isError && (
                  <p id="turan-worker-error" role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-600">
                    {errorMessage(workersQuery.error)}
                    <Button type="button" size="sm" variant="ghost" onClick={() => void workersQuery.refetch()}>
                      {tc("retry")}
                    </Button>
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="turan-start">{t("form.start")}</Label>
                <Input
                  id="turan-start"
                  type="datetime-local"
                  dir="ltr"
                  className="text-start"
                  value={startAt}
                  onChange={(e) => {
                    edited();
                    setStartAt(e.target.value);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="turan-end">{t("form.end")}</Label>
                <Input
                  id="turan-end"
                  type="datetime-local"
                  dir="ltr"
                  className="text-start"
                  value={endAt}
                  onChange={(e) => {
                    edited();
                    setEndAt(e.target.value);
                  }}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="turan-notes">{t("form.notes")}</Label>
              <Input
                id="turan-notes"
                dir="auto"
                value={notes}
                onChange={(e) => {
                  edited();
                  setNotes(e.target.value);
                }}
              />
            </div>

            {formError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            )}

            {overlapWith ? (
              <div role="alert" className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
                <p className="font-semibold text-amber-900">{t("overlap.title")}</p>
                <p className="text-amber-900">
                  {conflicting
                    ? t("overlap.description", {
                        type: enumLabel("TuranType", conflicting.turanType),
                        start: format.dateTime(conflicting.startAt),
                        end: format.dateTime(conflicting.endAt),
                      })
                    : t("overlap.descriptionUnknown")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => create.mutate(true)} disabled={create.isPending}>
                    {create.isPending ? t("form.submitting") : t("overlap.confirm")}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setOverlapWith(null)} disabled={create.isPending}>
                    {tc("cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="submit" disabled={create.isPending || !workerProfileId}>
                {create.isPending ? t("form.submitting") : t("form.submit")}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("list.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {listError && (
            <p role="alert" className="mx-5 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {listError}
            </p>
          )}
          {assignmentsQuery.isLoading && <LoadingState />}
          {assignmentsQuery.isError && <ErrorState error={assignmentsQuery.error} onRetry={() => void assignmentsQuery.refetch()} />}
          {assignmentsQuery.data && assignmentsQuery.data.length === 0 && <EmptyState title={t("empty.title")} description={t("empty.description")} />}
          {assignmentsQuery.data && assignmentsQuery.data.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">{t("list.caption")}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("list.columns.type")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("list.columns.worker")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("list.columns.start")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("list.columns.end")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("list.columns.status")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      <span className="sr-only">{t("list.columns.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assignmentsQuery.data.map((a) => {
                    const name = workerName(a.assignedWorkerProfileId);
                    const cancelling = cancel.isPending && cancel.variables === a.id;
                    return (
                      <tr key={a.id} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap px-5 py-3 text-slate-600">{enumLabel("TuranType", a.turanType)}</td>
                        <td className="px-5 py-3 font-medium text-slate-900">{name ?? <LtrText>{a.assignedWorkerProfileId}</LtrText>}</td>
                        <td className="px-5 py-3 text-slate-600">
                          <DateTimeText value={a.startAt} />
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          <DateTimeText value={a.endAt} />
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={statusTone(a.status)}>{enumLabel("TuranStatus", a.status)}</Badge>
                        </td>
                        <td className="px-5 py-3 text-end">
                          {a.status === "SCHEDULED" && (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setListFailure(null);
                                setSuccess(null);
                                cancel.mutate(a.id);
                              }}
                              disabled={cancel.isPending}
                              aria-label={cancelling ? undefined : t("actions.cancelAssignmentFor", { name: name ?? a.assignedWorkerProfileId })}
                            >
                              {cancelling ? t("actions.cancelling") : tc("cancel")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
