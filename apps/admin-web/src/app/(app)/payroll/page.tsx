"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { MonthText } from "@/components/formatted";
import { ChevronEndIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

/** Result of the last "Calculate" click; the text is built at render time so it follows the UI language. */
type CalculateFeedback = { type: "success"; yearMonth: string } | { type: "error"; error: unknown } | null;

function PayrollPageContent() {
  const t = useTranslations("payroll");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<CalculateFeedback>(null);
  const periodsQuery = useQuery({ queryKey: ["payroll-periods"], queryFn: () => client.listPayrollPeriods() });

  const yearMonth = currentYearMonth();
  const calculateCurrent = useMutation({
    mutationFn: () => client.calculatePayroll(yearMonth, `web-calc-${Date.now()}`),
    onMutate: () => setFeedback(null),
    onSuccess: (period) => {
      setFeedback({ type: "success", yearMonth: period?.yearMonth ?? yearMonth });
      return queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
    onError: (err) => setFeedback({ type: "error", error: err }),
  });

  const periods = periodsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => calculateCurrent.mutate()} disabled={calculateCurrent.isPending}>
            {calculateCurrent.isPending ? t("actions.calculating") : t("actions.calculateMonth", { month: format.month(yearMonth) })}
          </Button>
        }
      />

      <div aria-live="polite">
        {feedback?.type === "success" ? (
          <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {t("messages.calculated", { month: format.month(feedback.yearMonth) })}
          </p>
        ) : null}
      </div>
      {feedback?.type === "error" ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage(feedback.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("list.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {periodsQuery.isLoading ? <LoadingState /> : null}
          {periodsQuery.isError ? <ErrorState error={periodsQuery.error} onRetry={() => periodsQuery.refetch()} /> : null}
          {periods && periods.length === 0 ? <EmptyState title={t("list.empty.title")} description={t("list.empty.description")} /> : null}
          {periods && periods.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">{t("list.caption")}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 text-start">
                      {t("list.columns.month")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start">
                      {t("list.columns.version")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start">
                      {t("list.columns.status")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/payroll/${p.yearMonth}`}
                          className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                        >
                          <MonthText yearMonth={p.yearMonth} />
                          <ChevronEndIcon className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{format.number(p.version)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(p.status)}>{enumLabel("PayrollPeriodStatus", p.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PayrollPage() {
  return (
    <OwnerOnly>
      <PayrollPageContent />
    </OwnerOnly>
  );
}
