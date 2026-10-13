"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { EM_DASH, getErrorCode } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, MonthText, Money } from "@/components/formatted";
import { ChevronEndIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { newIdempotencyKey, payrollKeys, useStartPayrollCalculation } from "@/components/payroll/payroll-queries";

const TH = "px-5 py-3 text-start";
const TH_NUMBER = "px-5 py-3 text-end";

/**
 * Payroll per month (Owner only): each month's latest version, its status,
 * workers, net and dates. "احسب رواتب <month>" starts the current month's
 * background calculation and opens the month, where its progress is shown.
 */
function PayrollPageContent() {
  const t = useTranslations("payroll");
  const tList = useTranslations("payroll.list");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const router = useRouter();
  const periodsQuery = useQuery({ queryKey: payrollKeys.periods, queryFn: () => client.listPayrollPeriods() });

  const yearMonth = currentYearMonth();
  const monthLabel = format.month(yearMonth);
  const calculate = useStartPayrollCalculation(yearMonth);
  const startCalculation = () => calculate.mutate(newIdempotencyKey(), { onSuccess: () => router.push(`/payroll/${yearMonth}`) });

  const periods = periodsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={startCalculation} disabled={calculate.isPending}>
            {calculate.isPending ? t("calculating") : t("calculateMonth", { month: monthLabel })}
          </Button>
        }
      />

      {calculate.isError ? (
        <div role="alert" className="space-y-1 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{errorMessage(calculate.error)}</p>
          {getErrorCode(calculate.error) === "PAYROLL_CALCULATION_IN_PROGRESS" ? (
            <Link href={`/payroll/${yearMonth}`} className="font-medium text-brand-700 underline hover:no-underline">
              {t("viewMonth", { month: monthLabel })}
            </Link>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{tList("title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {periodsQuery.isLoading ? <LoadingState /> : null}
          {periodsQuery.isError ? <ErrorState error={periodsQuery.error} onRetry={() => periodsQuery.refetch()} /> : null}
          {periods && periods.length === 0 ? <EmptyState title={tList("empty.title")} description={tList("empty.description")} /> : null}
          {periods && periods.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[56rem] text-start text-sm">
                <caption className="sr-only">{tList("caption")}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className={TH}>
                      {tList("columns.month")}
                    </th>
                    <th scope="col" className={TH_NUMBER}>
                      {tList("columns.version")}
                    </th>
                    <th scope="col" className={TH_NUMBER}>
                      {tList("columns.versionCount")}
                    </th>
                    <th scope="col" className={TH}>
                      {tList("columns.status")}
                    </th>
                    <th scope="col" className={TH_NUMBER}>
                      {tList("columns.workers")}
                    </th>
                    <th scope="col" className={TH_NUMBER}>
                      {tList("columns.net")}
                    </th>
                    <th scope="col" className={TH}>
                      {tList("columns.calculatedAt")}
                    </th>
                    <th scope="col" className={TH}>
                      {tList("columns.finalizedAt")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/payroll/${p.yearMonth}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                          <MonthText yearMonth={p.yearMonth} />
                          <ChevronEndIcon className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-end text-slate-600">{format.number(p.version)}</td>
                      <td className="px-5 py-3 text-end text-slate-600">{format.number(p.versionCount)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(p.status)}>{enumLabel("PayrollPeriodStatus", p.status)}</Badge>
                      </td>
                      <td className="px-5 py-3 text-end text-slate-600">{format.number(p.workers)}</td>
                      <td className="px-5 py-3 text-end font-semibold text-slate-900">
                        <Money agorot={p.netPayableAgorot} />
                      </td>
                      <td className="px-5 py-3 text-slate-600">{p.calculatedAt ? <DateTimeText value={p.calculatedAt} /> : EM_DASH}</td>
                      <td className="px-5 py-3 text-slate-600">{p.finalizedAt ? <DateTimeText value={p.finalizedAt} /> : EM_DASH}</td>
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
