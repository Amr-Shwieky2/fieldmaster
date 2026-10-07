"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CompensationType } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { ArrowStartIcon } from "@/components/icons";

type Failure = { action: "approve" | "reject"; error: unknown };

export default function ApproveWorkerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const label = useEnumLabel();
  const errorMessage = useErrorMessage();

  const [compensationType, setCompensationType] = useState<"DAILY" | "HOURLY">("DAILY");
  const [dailyRate, setDailyRate] = useState("400");
  const [hourlyRate, setHourlyRate] = useState("50");
  const [overtimeRate, setOvertimeRate] = useState("60");
  const [failure, setFailure] = useState<Failure | null>(null);

  // Amounts are typed in shekels and sent as integer agorot.
  const approve = useMutation({
    mutationFn: () =>
      client.approveWorker(id, {
        compensationType,
        dailyBaseRateAgorot: compensationType === "DAILY" ? Math.round(Number(dailyRate) * 100) : undefined,
        baseHourlyRateAgorot: compensationType === "HOURLY" ? Math.round(Number(hourlyRate) * 100) : undefined,
        overtimeHourlyRateAgorot: Math.round(Number(overtimeRate) * 100),
        effectiveStartDate: new Date().toISOString().slice(0, 10),
        // Reasons are stored as sent and shown later in the audit log, so they are sent in the user's language.
        changeReason: t("approve.reasons.initialApproval"),
      }),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers-pending"] });
      queryClient.invalidateQueries({ queryKey: ["workers"] });
      router.replace("/workers");
    },
    onError: (error) => setFailure({ action: "approve", error }),
  });

  const reject = useMutation({
    mutationFn: () => client.rejectWorker(id, t("approve.reasons.rejected")),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers-pending"] });
      router.replace("/workers");
    },
    onError: (error) => setFailure({ action: "reject", error }),
  });

  // Stay disabled after success too, while the page navigates back to the list.
  const busy = approve.isPending || reject.isPending || approve.isSuccess || reject.isSuccess;
  const success = approve.isSuccess ? t("approve.messages.approved") : reject.isSuccess ? t("approve.messages.rejected") : null;

  return (
    <div className="max-w-lg space-y-6">
      <Link href="/workers" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {t("backToList")}
      </Link>

      <PageHeader title={t("approve.title")} description={t("approve.description")} />

      <Card>
        <CardHeader>
          <CardTitle>{tc("compensation")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="type">{t("approve.form.compensationType")}</Label>
            <Select id="type" value={compensationType} onChange={(e) => setCompensationType(e.target.value as "DAILY" | "HOURLY")}>
              <option value={CompensationType.DAILY}>{label("CompensationType", CompensationType.DAILY)}</option>
              <option value={CompensationType.HOURLY}>{label("CompensationType", CompensationType.HOURLY)}</option>
            </Select>
          </div>

          {compensationType === "DAILY" ? (
            <div>
              <Label htmlFor="daily">{t("approve.form.dailyRate")}</Label>
              <Input
                id="daily"
                type="number"
                min={0}
                dir="ltr"
                inputMode="decimal"
                aria-describedby="amount-hint"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="hourly">{t("approve.form.hourlyRate")}</Label>
              <Input
                id="hourly"
                type="number"
                min={0}
                dir="ltr"
                inputMode="decimal"
                aria-describedby="amount-hint"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
              />
            </div>
          )}

          <div>
            <Label htmlFor="overtime">{t("approve.form.overtimeRate")}</Label>
            <Input
              id="overtime"
              type="number"
              min={0}
              dir="ltr"
              inputMode="decimal"
              aria-describedby="amount-hint"
              value={overtimeRate}
              onChange={(e) => setOvertimeRate(e.target.value)}
            />
          </div>

          <p id="amount-hint" className="text-xs text-slate-500">
            {t("approve.form.hint")}
          </p>

          {failure && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <p className="font-medium">{failure.action === "approve" ? t("approve.messages.approveFailed") : t("approve.messages.rejectFailed")}</p>
              <p>{errorMessage(failure.error)}</p>
            </div>
          )}
          {success && (
            <p role="status" className="text-sm text-emerald-700">
              {success}
            </p>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button onClick={() => approve.mutate()} disabled={busy}>
              {approve.isPending ? t("approve.actions.approving") : t("approve.actions.approve")}
            </Button>
            <Button variant="danger" onClick={() => reject.mutate()} disabled={busy}>
              {reject.isPending ? t("approve.actions.rejecting") : tc("reject")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
