"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CompensationType } from "@fieldmaster/shared-types";
import { toBusinessDay } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { BusinessDateText } from "@/components/formatted";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { ReasonForm } from "@/components/attendance/reason-form";
import { parseShekelsToAgorot, type ShekelsParseError } from "@/components/payroll/parse-shekels";
import { invitationKeys } from "./create-invitation-card";

type RateType = typeof CompensationType.DAILY | typeof CompensationType.HOURLY;
type RateField = "base" | "overtime";
type Failure = { action: "approve" | "reject"; error: unknown };

/**
 * The Owner's decision on a pending application. Approving requires the
 * compensation: a daily or hourly base rate and an overtime rate, typed in
 * shekels and sent as integer agorot (parsed as text, never through a
 * floating-point number), effective today (Asia/Jerusalem). Rejecting
 * requires a reason. Either way the page returns to the workers list.
 */
export function WorkerApprovalForm({ workerProfileId }: { workerProfileId: string }) {
  const t = useTranslations("onboardingReview");
  const tWorkers = useTranslations("workers");
  const label = useEnumLabel();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { client } = useAuth();
  const id = useId();

  const [compensationType, setCompensationType] = useState<RateType>(CompensationType.DAILY);
  const [dailyRate, setDailyRate] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonInvalid, setReasonInvalid] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const base = parseShekelsToAgorot(compensationType === CompensationType.DAILY ? dailyRate : hourlyRate);
  const overtime = parseShekelsToAgorot(overtimeRate);
  const problems: Partial<Record<RateField, ShekelsParseError>> = {};
  if (!base.ok) problems.base = base.error;
  if (!overtime.ok) problems.overtime = overtime.error;
  const visible: Partial<Record<RateField, ShekelsParseError>> = showErrors ? problems : {};
  const inputId = (field: RateField) => `${id}-${field}`;
  const describedBy = (field: RateField) => [`${id}-hint`, visible[field] ? `${id}-${field}-error` : undefined].filter(Boolean).join(" ");

  const afterDecision = () => {
    void queryClient.invalidateQueries({ queryKey: ["workers-pending"] });
    void queryClient.invalidateQueries({ queryKey: ["workers"] });
    void queryClient.invalidateQueries({ queryKey: invitationKeys.list });
    router.replace("/workers");
  };

  const approve = useMutation({
    mutationFn: (compensationProfile: Record<string, unknown>) => client.approveWorker(workerProfileId, compensationProfile),
    onMutate: () => setFailure(null),
    onSuccess: afterDecision,
    onError: (error) => setFailure({ action: "approve", error }),
  });

  const reject = useMutation({
    mutationFn: (why: string) => client.rejectWorker(workerProfileId, why),
    onMutate: () => setFailure(null),
    onSuccess: afterDecision,
    onError: (error) => setFailure({ action: "reject", error }),
  });

  // Stay disabled after success too, while the page navigates back to the list.
  const busy = approve.isPending || reject.isPending || approve.isSuccess || reject.isSuccess;
  const success = approve.isSuccess ? t("approval.approved") : reject.isSuccess ? t("rejection.rejected") : null;

  const submitApproval = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!base.ok || !overtime.ok) {
      setShowErrors(true);
      document.getElementById(inputId(!base.ok ? "base" : "overtime"))?.focus();
      return;
    }
    approve.mutate({
      compensationType,
      dailyBaseRateAgorot: compensationType === CompensationType.DAILY ? base.agorot : undefined,
      baseHourlyRateAgorot: compensationType === CompensationType.HOURLY ? base.agorot : undefined,
      overtimeHourlyRateAgorot: overtime.agorot,
      effectiveStartDate: toBusinessDay(new Date()),
      // Reasons are stored as sent and shown later in the audit log, so they are sent in Arabic.
      changeReason: tWorkers("approve.reasons.initialApproval"),
    });
  };

  const rateInput = (field: RateField, value: string, onChange: (value: string) => void, text: string) => (
    <div>
      <Label htmlFor={inputId(field)}>{text}</Label>
      <Input
        id={inputId(field)}
        type="text"
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        className="text-start"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={visible[field] ? true : undefined}
        aria-describedby={describedBy(field)}
      />
      {visible[field] ? (
        <p id={`${id}-${field}-error`} className="mt-1 text-xs text-red-600">
          {t(`approval.errors.${visible[field]}`)}
        </p>
      ) : null}
    </div>
  );
  const baseInput =
    compensationType === CompensationType.DAILY
      ? rateInput("base", dailyRate, setDailyRate, t("approval.dailyRate"))
      : rateInput("base", hourlyRate, setHourlyRate, t("approval.hourlyRate"));
  const overtimeInput = rateInput("overtime", overtimeRate, setOvertimeRate, t("approval.overtimeRate"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("approval.title")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">{t("approval.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form noValidate onSubmit={submitApproval} className="space-y-4">
          <div>
            <Label htmlFor={`${id}-type`}>{t("approval.compensationType")}</Label>
            <Select id={`${id}-type`} value={compensationType} onChange={(event) => setCompensationType(event.target.value as RateType)}>
              <option value={CompensationType.DAILY}>{label("CompensationType", CompensationType.DAILY)}</option>
              <option value={CompensationType.HOURLY}>{label("CompensationType", CompensationType.HOURLY)}</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {baseInput}
            {overtimeInput}
          </div>
          <p id={`${id}-hint`} className="text-xs text-slate-500">
            {t("approval.hint")}
          </p>
          <p className="text-sm text-slate-600">{t.rich("approval.effectiveFrom", { date: () => <BusinessDateText value={toBusinessDay(new Date())} /> })}</p>
          <Button type="submit" disabled={busy}>
            {approve.isPending ? t("approval.approving") : t("approval.approve")}
          </Button>
        </form>

        <div className="border-t border-slate-200 pt-4">
          {rejectOpen ? (
            <ReasonForm
              id={`${id}-reject`}
              label={t("rejection.label")}
              hint={t("rejection.hint")}
              value={reason}
              invalid={reasonInvalid}
              onChange={(value) => {
                setReason(value);
                setReasonInvalid(false);
              }}
              onSubmit={(why) => (why.length === 0 ? setReasonInvalid(true) : reject.mutate(why))}
              onCancel={() => {
                setRejectOpen(false);
                setReason("");
                setReasonInvalid(false);
              }}
              submitLabel={t("rejection.submit")}
              pendingLabel={t("rejection.rejecting")}
              pending={reject.isPending}
              busy={busy}
              variant="danger"
            />
          ) : (
            <Button variant="danger" onClick={() => setRejectOpen(true)} disabled={busy}>
              {t("rejection.open")}
            </Button>
          )}
        </div>

        {failure ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <p className="font-medium">{failure.action === "approve" ? t("approval.approveFailed") : t("rejection.rejectFailed")}</p>
            <p>{errorMessage(failure.error)}</p>
          </div>
        ) : null}
        {success ? (
          <p role="status" className="text-sm text-emerald-700">
            {success}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
