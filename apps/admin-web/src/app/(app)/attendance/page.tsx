"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { TimeEntry } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useShiftTitle } from "@/lib/shift-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/input";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, LtrText, MinutesText } from "@/components/formatted";

/** Actions that need a written reason before they are sent (the reason is stored and shown to people). */
type ReasonAction = "reject" | "fullDayCredit";

interface ReasonPrompt {
  entryId: string;
  action: ReasonAction;
  reason: string;
  invalid: boolean;
}

interface ActionTarget {
  id: string;
  name: string;
}

type SuccessMessageKey = "approved" | "rejected" | "fullDayCreditApplied";

/** Kept as data and translated while rendering. */
type Feedback =
  | { entryId: string; tone: "success"; messageKey: SuccessMessageKey; name: string }
  | { entryId: string; tone: "error"; error: unknown };

export default function AttendancePage() {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const pendingQuery = useQuery({ queryKey: ["attendance-approvals-pending"], queryFn: () => client.listPendingAttendanceApprovals() });
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["attendance-approvals-pending"] });
  const fail = (target: ActionTarget, err: unknown) => setFeedback({ entryId: target.id, tone: "error", error: err });
  const succeed = (target: ActionTarget, messageKey: SuccessMessageKey) => {
    setPrompt(null);
    setFeedback({ entryId: target.id, tone: "success", messageKey, name: target.name });
    void invalidate();
  };

  const approve = useMutation({
    mutationFn: (target: ActionTarget) => client.approveTimeEntry(target.id),
    onSuccess: (_data, target) => succeed(target, "approved"),
    onError: (err, target) => fail(target, err),
  });
  const reject = useMutation({
    mutationFn: (target: ActionTarget & { reason: string }) => client.rejectTimeEntry(target.id, target.reason),
    onSuccess: (_data, target) => succeed(target, "rejected"),
    onError: (err, target) => fail(target, err),
  });
  const fullDayCredit = useMutation({
    mutationFn: (target: ActionTarget & { reason: string }) => client.applyFullDayCredit(target.id, target.reason),
    onSuccess: (_data, target) => succeed(target, "fullDayCreditApplied"),
    onError: (err, target) => fail(target, err),
  });

  const workerName = (entry: TimeEntry) => workersQuery.data?.find((w) => w.id === entry.workerProfileId)?.fullLegalName ?? null;

  const runApprove = (target: ActionTarget) => {
    setFeedback(null);
    setPrompt(null);
    approve.mutate(target);
  };

  const openPrompt = (entry: TimeEntry, action: ReasonAction) => {
    setFeedback(null);
    setPrompt({
      entryId: entry.id,
      action,
      reason: action === "reject" ? t("reasonPrompt.rejectDefault") : t("reasonPrompt.fullDayCreditDefault"),
      invalid: false,
    });
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>, target: ActionTarget) => {
    event.preventDefault();
    if (!prompt) return;
    const reason = prompt.reason.trim();
    if (reason.length === 0) {
      setPrompt({ ...prompt, invalid: true });
      return;
    }
    setFeedback(null);
    if (prompt.action === "reject") reject.mutate({ ...target, reason });
    else fullDayCredit.mutate({ ...target, reason });
  };

  const entries = pendingQuery.data ?? [];
  const successMessage = feedback?.tone === "success" ? t(`messages.${feedback.messageKey}`, { name: feedback.name }) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={entries.length > 0 ? <Badge tone="warning">{t("pendingCount", { count: entries.length })}</Badge> : null}
      />

      <div role="status" aria-live="polite">
        {successMessage ? <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</p> : null}
      </div>

      {pendingQuery.isLoading && <LoadingState />}
      {pendingQuery.isError && <ErrorState error={pendingQuery.error} onRetry={() => void pendingQuery.refetch()} />}
      {pendingQuery.data && pendingQuery.data.length === 0 && <EmptyState title={t("empty.title")} description={t("empty.description")} />}

      {entries.length > 0 && (
        <ul className="space-y-4" aria-label={t("listLabel")}>
          {entries.map((entry) => {
            const name = workerName(entry);
            const target: ActionTarget = { id: entry.id, name: name ?? entry.workerProfileId };
            const canCredit = entry.rawDurationMinutes !== null && entry.rawDurationMinutes < 540 && !entry.fullDayCredit;
            const approving = approve.isPending && approve.variables?.id === entry.id;
            const rejecting = reject.isPending && reject.variables?.id === entry.id;
            const crediting = fullDayCredit.isPending && fullDayCredit.variables?.id === entry.id;
            const busy = approving || rejecting || crediting;
            const openReason = prompt?.entryId === entry.id ? prompt : null;
            const entryError = feedback?.entryId === entry.id && feedback.tone === "error" ? errorMessage(feedback.error) : null;
            const reasonId = `attendance-reason-${entry.id}`;

            return (
              <li key={entry.id}>
                <Card>
                  <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>{name ?? <LtrText>{entry.workerProfileId}</LtrText>}</CardTitle>
                      {entry.shift?.title ? (
                        <p className="text-sm text-slate-500">
                          <bdi>{shiftTitle(entry.shift)}</bdi>
                        </p>
                      ) : null}
                    </div>
                    {entry.fullDayCredit && <Badge tone="info">{t("fullDayCreditApplied")}</Badge>}
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <dt className="text-slate-500">{tc("clockIn")}</dt>
                        <dd className="font-medium">
                          <DateTimeText value={entry.clockInAt} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">{tc("clockOut")}</dt>
                        <dd className="font-medium">
                          <DateTimeText value={entry.clockOutAt} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">{t("fields.duration")}</dt>
                        <dd className="font-medium">
                          <MinutesText minutes={entry.rawDurationMinutes} />
                        </dd>
                      </div>
                    </dl>
                    {entry.dailySummary?.text && (
                      <div>
                        <p className="text-slate-500">{tc("dailySummary")}</p>
                        <p className="whitespace-pre-line" dir="auto">
                          {entry.dailySummary.text}
                        </p>
                      </div>
                    )}

                    {entryError && (
                      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                        {entryError}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button size="sm" onClick={() => runApprove(target)} disabled={busy || approve.isPending}>
                        {approving ? t("actions.approving") : tc("approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => openPrompt(entry, "reject")}
                        disabled={busy || reject.isPending}
                        aria-expanded={openReason?.action === "reject"}
                        aria-controls={openReason?.action === "reject" ? reasonId : undefined}
                      >
                        {tc("reject")}
                      </Button>
                      {canCredit && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openPrompt(entry, "fullDayCredit")}
                          disabled={busy || fullDayCredit.isPending}
                          aria-expanded={openReason?.action === "fullDayCredit"}
                          aria-controls={openReason?.action === "fullDayCredit" ? reasonId : undefined}
                        >
                          {tc("creditAsFullDay")}
                        </Button>
                      )}
                    </div>

                    {openReason && (
                      <form id={reasonId} noValidate onSubmit={(event) => submitPrompt(event, target)} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <Label htmlFor={`${reasonId}-input`}>
                          {openReason.action === "reject" ? t("reasonPrompt.rejectLabel") : t("reasonPrompt.fullDayCreditLabel")}
                        </Label>
                        <textarea
                          id={`${reasonId}-input`}
                          dir="auto"
                          rows={2}
                          value={openReason.reason}
                          onChange={(event) => setPrompt({ ...openReason, reason: event.target.value, invalid: false })}
                          aria-invalid={openReason.invalid || undefined}
                          aria-describedby={`${reasonId}-hint${openReason.invalid ? ` ${reasonId}-error` : ""}`}
                          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        <p id={`${reasonId}-hint`} className="text-xs text-slate-500">
                          {openReason.action === "reject" ? t("reasonPrompt.rejectHint") : t("reasonPrompt.fullDayCreditHint")}
                        </p>
                        {openReason.invalid && (
                          <p id={`${reasonId}-error`} role="alert" className="text-xs text-red-600">
                            {t("reasonPrompt.required")}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {openReason.action === "reject" ? (
                            <Button type="submit" size="sm" variant="danger" disabled={busy}>
                              {rejecting ? t("actions.rejecting") : t("actions.confirmReject")}
                            </Button>
                          ) : (
                            <Button type="submit" size="sm" disabled={busy}>
                              {crediting ? t("actions.applyingFullDayCredit") : t("actions.confirmFullDayCredit")}
                            </Button>
                          )}
                          <Button type="button" size="sm" variant="ghost" onClick={() => setPrompt(null)} disabled={busy}>
                            {tc("cancel")}
                          </Button>
                        </div>
                      </form>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
