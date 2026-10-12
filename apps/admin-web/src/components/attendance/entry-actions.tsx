"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { Button } from "@/components/ui/button";
import { ReasonForm } from "./reason-form";

/** Actions that need a written reason before they are sent (the reason is stored and shown to people). */
type ReasonAction = "reject" | "fullDayCredit" | "requestCorrection";

export type EntryActionSuccess = "approved" | "rejected" | "fullDayCreditApplied" | "correctionRequested";

/** Invalidates every query that shows attendance after an action changed an entry. */
export function useInvalidateAttendance() {
  const queryClient = useQueryClient();
  return (timeEntryId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["attendance-entries"] }),
      queryClient.invalidateQueries({ queryKey: ["attendance-approvals-pending"] }),
      queryClient.invalidateQueries({ queryKey: ["forgotten-stamps"] }),
      queryClient.invalidateQueries({ queryKey: ["worker-earnings"] }),
      queryClient.invalidateQueries({ queryKey: ["emergency-callouts"] }),
      ...(timeEntryId
        ? [
            queryClient.invalidateQueries({ queryKey: ["time-entry-evidence", timeEntryId] }),
            queryClient.invalidateQueries({ queryKey: ["time-entry-cost", timeEntryId] }),
          ]
        : []),
    ]);
}

/**
 * Approve / reject / request a correction / credit as a full day, for one
 * entry, with the same rules as the API (the server refuses anything else and
 * its Arabic error is shown here). A success is announced by the page through
 * `onSuccess`, because the entry may leave the list right after it.
 */
export function EntryActions({
  entryId,
  workerName,
  allowed,
  onSuccess,
  extra,
}: {
  entryId: string;
  workerName: string;
  allowed: { approve: boolean; reject: boolean; requestCorrection?: boolean; fullDayCredit: boolean };
  onSuccess: (key: EntryActionSuccess, name: string) => void;
  /** More buttons in the same row (the detail page's manual correction). */
  extra?: ReactNode;
}) {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const invalidate = useInvalidateAttendance();
  const [prompt, setPrompt] = useState<{ action: ReasonAction; reason: string; invalid: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const succeed = (key: EntryActionSuccess) => {
    setPrompt(null);
    setError(null);
    onSuccess(key, workerName);
    void invalidate(entryId);
  };

  const approve = useMutation({ mutationFn: () => client.approveTimeEntry(entryId), onSuccess: () => succeed("approved"), onError: setError });
  const reject = useMutation({
    mutationFn: (reason: string) => client.rejectTimeEntry(entryId, reason),
    onSuccess: () => succeed("rejected"),
    onError: setError,
  });
  const fullDayCredit = useMutation({
    mutationFn: (reason: string) => client.applyFullDayCredit(entryId, reason),
    onSuccess: () => succeed("fullDayCreditApplied"),
    onError: setError,
  });
  const requestCorrection = useMutation({
    mutationFn: (notes: string) => client.requestTimeEntryCorrection(entryId, notes),
    onSuccess: () => succeed("correctionRequested"),
    onError: setError,
  });
  const busy = approve.isPending || reject.isPending || fullDayCredit.isPending || requestCorrection.isPending;
  const formId = `attendance-reason-${entryId}`;

  const openPrompt = (action: ReasonAction) => {
    setError(null);
    const defaults: Record<ReasonAction, string> = {
      reject: t("reasonPrompt.rejectDefault"),
      fullDayCredit: t("reasonPrompt.fullDayCreditDefault"),
      requestCorrection: t("reasonPrompt.requestCorrectionDefault"),
    };
    setPrompt({ action, reason: defaults[action], invalid: false });
  };

  const submitPrompt = (reason: string) => {
    if (!prompt) return;
    if (reason.length === 0) {
      setPrompt({ ...prompt, invalid: true });
      return;
    }
    setError(null);
    if (prompt.action === "reject") reject.mutate(reason);
    else if (prompt.action === "fullDayCredit") fullDayCredit.mutate(reason);
    else requestCorrection.mutate(reason);
  };

  const promptTexts: Record<ReasonAction, { label: string; hint: string; submit: string; pending: string }> = {
    reject: { label: t("reasonPrompt.rejectLabel"), hint: t("reasonPrompt.rejectHint"), submit: t("actions.confirmReject"), pending: t("actions.rejecting") },
    fullDayCredit: {
      label: t("reasonPrompt.fullDayCreditLabel"),
      hint: t("reasonPrompt.fullDayCreditHint"),
      submit: t("actions.confirmFullDayCredit"),
      pending: t("actions.applyingFullDayCredit"),
    },
    requestCorrection: {
      label: t("reasonPrompt.requestCorrectionLabel"),
      hint: t("reasonPrompt.requestCorrectionHint"),
      submit: t("actions.confirmRequestCorrection"),
      pending: t("actions.requestingCorrection"),
    },
  };
  const toggleProps = (action: ReasonAction) => ({
    "aria-expanded": prompt?.action === action,
    "aria-controls": prompt?.action === action ? formId : undefined,
  });

  const rejectToggle = toggleProps("reject");
  const requestCorrectionToggle = toggleProps("requestCorrection");
  const fullDayCreditToggle = toggleProps("fullDayCredit");

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage(error)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {allowed.approve && (
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setPrompt(null);
              approve.mutate();
            }}
            disabled={busy}
          >
            {approve.isPending ? t("actions.approving") : tc("approve")}
          </Button>
        )}
        {allowed.reject && (
          <Button size="sm" variant="danger" onClick={() => openPrompt("reject")} disabled={busy} {...rejectToggle}>
            {tc("reject")}
          </Button>
        )}
        {allowed.requestCorrection && (
          <Button size="sm" variant="secondary" onClick={() => openPrompt("requestCorrection")} disabled={busy} {...requestCorrectionToggle}>
            {t("actions.requestCorrection")}
          </Button>
        )}
        {allowed.fullDayCredit && (
          <Button size="sm" variant="secondary" onClick={() => openPrompt("fullDayCredit")} disabled={busy} {...fullDayCreditToggle}>
            {tc("creditAsFullDay")}
          </Button>
        )}
        {extra}
      </div>

      {prompt && (
        <ReasonForm
          id={formId}
          label={promptTexts[prompt.action].label}
          hint={promptTexts[prompt.action].hint}
          value={prompt.reason}
          invalid={prompt.invalid}
          onChange={(reason) => setPrompt({ ...prompt, reason, invalid: false })}
          onSubmit={submitPrompt}
          onCancel={() => setPrompt(null)}
          submitLabel={promptTexts[prompt.action].submit}
          pendingLabel={promptTexts[prompt.action].pending}
          pending={busy}
          busy={busy}
          variant={prompt.action === "reject" ? "danger" : "primary"}
        />
      )}
    </div>
  );
}
