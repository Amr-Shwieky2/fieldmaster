"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { EM_DASH } from "@/lib/format";
import { isNotFound } from "@/lib/errors";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { LtrText, MinutesText, Money } from "@/components/formatted";
import { ArrowStartIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

/** Outcome of the last finalize / reopen click, rendered in the current UI language. */
type ActionFeedback = { type: "finalized" } | { type: "reopened" } | { type: "error"; error: unknown } | null;

// Wide table: the worker column sticks to the inline-start edge while the figures scroll.
const STICKY_HEAD = "sticky start-0 z-10 bg-slate-50";
const STICKY_CELL = "sticky start-0 z-10 bg-white";

function BackToPayroll() {
  const t = useTranslations("payroll");
  return (
    <Link href="/payroll" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
      <ArrowStartIcon />
      {t("period.backToList")}
    </Link>
  );
}

function PayrollPeriodContent() {
  const t = useTranslations("payroll");
  const tc = useTranslations("common");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { yearMonth } = useParams<{ yearMonth: string }>();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<ActionFeedback>(null);

  const periodQuery = useQuery({ queryKey: ["payroll-period", yearMonth], queryFn: () => client.getPayrollPeriod(yearMonth) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["payroll-period", yearMonth] });

  const finalize = useMutation({
    mutationFn: () => client.finalizePayroll(yearMonth),
    onMutate: () => setFeedback(null),
    onSuccess: () => {
      setFeedback({ type: "finalized" });
      return invalidate();
    },
    onError: (err) => setFeedback({ type: "error", error: err }),
  });
  const reopen = useMutation({
    // The reason is stored as sent and shown later in the audit log, so it is sent in the Owner's language.
    mutationFn: () => client.reopenPayroll(yearMonth, t("period.reopenReason")),
    onMutate: () => setFeedback(null),
    onSuccess: () => {
      setFeedback({ type: "reopened" });
      return invalidate();
    },
    onError: (err) => setFeedback({ type: "error", error: err }),
  });

  const monthLabel = format.month(yearMonth);

  if (periodQuery.isLoading) return <LoadingState />;
  if (periodQuery.isError) {
    // 403 renders the access-denied state inside ErrorState; 404 means the month was never calculated.
    if (isNotFound(periodQuery.error)) {
      return (
        <div className="space-y-6">
          <BackToPayroll />
          <PageHeader title={t("period.title", { month: monthLabel })} />
          <Card>
            <EmptyState title={t("period.notFound.title")} description={t("period.notFound.description")} />
          </Card>
        </div>
      );
    }
    return <ErrorState error={periodQuery.error} onRetry={() => periodQuery.refetch()} />;
  }
  const period = periodQuery.data;
  if (!period) return <LoadingState />;

  const items = period.items ?? [];
  const totalNet = items.reduce((sum, i) => sum + i.netPayableAgorot, 0);

  return (
    <div className="space-y-6">
      <BackToPayroll />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t("period.title", { month: format.month(period.yearMonth) })}
            <Badge tone={statusTone(period.status)}>{enumLabel("PayrollPeriodStatus", period.status)}</Badge>
          </span>
        }
        description={t("period.version", { version: format.number(period.version) })}
        actions={
          <>
            {period.status === "REVIEW" ? (
              <Button onClick={() => finalize.mutate()} disabled={finalize.isPending}>
                {finalize.isPending ? t("period.actions.finalizing") : tc("finalize")}
              </Button>
            ) : null}
            {period.status === "FINALIZED" ? (
              <Button variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                {reopen.isPending ? t("period.actions.reopening") : tc("reopen")}
              </Button>
            ) : null}
          </>
        }
      />

      <div aria-live="polite">
        {feedback?.type === "finalized" || feedback?.type === "reopened" ? (
          <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {feedback.type === "finalized" ? t("period.messages.finalized") : t("period.messages.reopened")}
          </p>
        ) : null}
      </div>
      {feedback?.type === "error" ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage(feedback.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("period.breakdownTitle")}</CardTitle>
          <p className="text-sm text-slate-600">
            {t.rich("period.totalNet", {
              total: format.money(totalNet),
              ltr: (chunks) => <LtrText className="font-semibold text-slate-900">{chunks}</LtrText>,
            })}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState title={t("period.empty.title")} description={t("period.empty.description")} />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[56rem] text-start text-sm">
                <caption className="sr-only">{t("period.caption", { month: format.month(period.yearMonth) })}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className={`${STICKY_HEAD} px-5 py-3 text-start`}>
                      {t("period.columns.worker")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-end">
                      {t("period.columns.days")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-end">
                      {t("period.columns.regular")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-end">
                      {tc("overtime")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-end">
                      {tc("gross")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-end">
                      {t("period.columns.adjustments")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-end">
                      {tc("net")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const name = item.worker?.membership.user.fullLegalName;
                    const hasAdjustments = item.positiveAdjustmentsAgorot > 0 || item.deductionsAgorot > 0;
                    return (
                      <tr key={item.id} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className={`${STICKY_CELL} px-5 py-3 text-start font-medium text-slate-900`}>
                          {name ?? <LtrText className="font-mono text-xs">{item.workerProfileId}</LtrText>}
                        </th>
                        <td className="px-5 py-3 text-end text-slate-600">{format.number(item.standardDaysCredited)}</td>
                        <td className="px-5 py-3 text-end text-slate-600">
                          <MinutesText minutes={item.regularMinutes} />
                        </td>
                        <td className="px-5 py-3 text-end text-slate-600">
                          <MinutesText minutes={item.overtimeMinutes} />
                        </td>
                        <td className="px-5 py-3 text-end text-slate-600">
                          <Money agorot={item.grossBaseAgorot + item.overtimeAgorot} />
                        </td>
                        <td className="px-5 py-3 text-end text-slate-600">
                          {hasAdjustments ? (
                            <span className="inline-flex flex-col items-end gap-0.5">
                              {item.positiveAdjustmentsAgorot > 0 ? (
                                <span className="text-emerald-700">
                                  <span className="sr-only">{t("period.added")}</span>
                                  <LtrText>+{format.money(item.positiveAdjustmentsAgorot)}</LtrText>
                                </span>
                              ) : null}
                              {item.deductionsAgorot > 0 ? (
                                <span className="text-red-700">
                                  <span className="sr-only">{t("period.deducted")}</span>
                                  <Money agorot={-item.deductionsAgorot} />
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            EM_DASH
                          )}
                        </td>
                        <td className="px-5 py-3 text-end font-semibold text-slate-900">
                          <Money agorot={item.netPayableAgorot} />
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

export default function PayrollPeriodPage() {
  return (
    <OwnerOnly>
      <PayrollPeriodContent />
    </OwnerOnly>
  );
}
