"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ForgottenStampInfraction } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useErrorMessage } from "@/lib/use-error-message";
import { currentYearMonth } from "@/lib/business-date";
import { YEAR_MONTH_PATTERN } from "@/lib/jerusalem-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { MonthPicker } from "@/components/month-picker";
import { ArrowStartIcon } from "@/components/icons";
import { BusinessDateText, DateTimeText, Money } from "@/components/formatted";
import { ReasonForm } from "@/components/attendance/reason-form";
import { useInvalidateAttendance } from "@/components/attendance/entry-actions";
import { ChangeValue, FieldName } from "@/components/attendance/evidence-sections";

/**
 * Forgotten-stamp infractions per business month (spec section 14). Everyone
 * here (VIEW_ATTENDANCE) sees who, when, which stamp and the sequence number;
 * the API sends the deduction (`deductionAgorot`) only to a member who may see
 * money (VIEW_FINANCIALS), so only they see amounts and month totals, and only
 * with MANAGE_PAYROLL "cancel the deduction" (which adds an offsetting
 * adjustment and keeps the original).
 */
export default function ForgottenStampsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ForgottenStamps />
    </Suspense>
  );
}

interface WorkerGroup {
  workerId: string;
  name: string;
  infractions: ForgottenStampInfraction[];
}

function groupByWorker(rows: ForgottenStampInfraction[]): WorkerGroup[] {
  const groups = new Map<string, WorkerGroup>();
  for (const row of rows) {
    const group = groups.get(row.worker.id) ?? { workerId: row.worker.id, name: row.worker.fullLegalName, infractions: [] };
    group.infractions.push(row);
    groups.set(row.worker.id, group);
  }
  for (const group of groups.values()) group.infractions.sort((a, b) => a.monthlySequenceNumber - b.monthlySequenceNumber);
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** Deductions that still apply (not cancelled). */
const activeDeduction = (row: ForgottenStampInfraction) => (row.reversedAt ? 0 : (row.deductionAgorot ?? 0));

function ForgottenStamps() {
  const t = useTranslations("forgottenStamps");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const monthParam = searchParams?.get("month") ?? "";
  const month = YEAR_MONTH_PATTERN.test(monthParam) ? monthParam : currentYearMonth();
  const { client } = useAuth();
  const { can } = useAccess();
  const money: MoneyAccess = { see: can(Permission.VIEW_FINANCIALS), reverse: can(Permission.VIEW_FINANCIALS) && can(Permission.MANAGE_PAYROLL) };
  const listQuery = useQuery({ queryKey: ["forgotten-stamps", { month }], queryFn: () => client.listForgottenStampInfractions({ month }) });
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const rows = listQuery.data ?? [];
  const groups = groupByWorker(rows);
  const totals = {
    deductions: rows.reduce((sum, row) => sum + (row.deductionAgorot ?? 0), 0),
    reversed: rows.reduce((sum, row) => sum + (row.reversedAt ? (row.deductionAgorot ?? 0) : 0), 0),
  };

  return (
    <div className="space-y-6">
      <Link href="/attendance" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {t("backToAttendance")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />
      <MonthPicker
        value={month}
        onChange={(next) => {
          setAnnouncement(null);
          router.replace(`${pathname}?month=${next}`);
        }}
        label={t("month")}
      />

      <div role="status" aria-live="polite">
        {announcement ? <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{announcement}</p> : null}
      </div>

      {listQuery.isPending && <LoadingState />}
      {listQuery.isError && <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />}
      {listQuery.isSuccess && rows.length === 0 ? <EmptyState title={t("empty.title")} description={t("empty.description")} /> : null}

      {rows.length > 0 ? (
        <>
          <p className="text-sm text-slate-600">{t("summary", { workers: groups.length, infractions: rows.length })}</p>
          {/* Money: only for a member who may see it. */}
          {money.see ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("totals.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-slate-500">{t("totals.deductions")}</dt>
                    <dd className="font-semibold">
                      <Money agorot={totals.deductions} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">{t("totals.reversed")}</dt>
                    <dd className="font-semibold">
                      <Money agorot={totals.reversed} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">{t("totals.net")}</dt>
                    <dd className="font-semibold">
                      <Money agorot={totals.deductions - totals.reversed} />
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ) : null}
          <ul className="space-y-4" aria-label={t("listLabel")}>
            {groups.map((group) => (
              <li key={group.workerId}>
                <WorkerInfractions group={group} money={money} onReversed={setAnnouncement} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** What the member may do with the money of an infraction: see the amounts, and cancel a deduction. */
interface MoneyAccess {
  see: boolean;
  reverse: boolean;
}

function WorkerInfractions({ group, money, onReversed }: { group: WorkerGroup; money: MoneyAccess; onReversed: (message: string) => void }) {
  const t = useTranslations("forgottenStamps");
  const workerTotal = group.infractions.reduce((sum, row) => sum + activeDeduction(row), 0);
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>
            <Link href={`/workers/${group.workerId}`} className="hover:underline">
              {group.name}
            </Link>
          </CardTitle>
          <Badge tone="warning">{t("infractionsCount", { count: group.infractions.length })}</Badge>
        </div>
        {money.see ? <p className="text-sm font-medium text-slate-700">{t.rich("workerDeduction", { money: () => <Money agorot={workerTotal} /> })}</p> : null}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption", { name: group.name })}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("columns.sequence")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("columns.date")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("columns.type")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("columns.correction")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("columns.reversal")}
              </th>
              {money.see ? (
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t("columns.deduction")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {group.infractions.map((row) => (
              <InfractionRow key={row.id} row={row} money={money} onReversed={onReversed} />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function InfractionRow({ row, money, onReversed }: { row: ForgottenStampInfraction; money: MoneyAccess; onReversed: (message: string) => void }) {
  const t = useTranslations("forgottenStamps");
  const tHistory = useTranslations("attendance.detail.history");
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const invalidate = useInvalidateAttendance();
  const [prompt, setPrompt] = useState<{ reason: string; invalid: boolean } | null>(null);
  const reverse = useMutation({
    mutationFn: (reason: string) => client.reverseForgottenStampInfraction(row.id, reason),
    onSuccess: () => {
      setPrompt(null);
      onReversed(t("reverse.success", { number: row.monthlySequenceNumber, name: row.worker.fullLegalName }));
      void invalidate(row.timeEntryId);
    },
  });
  const canReverse = money.reverse && (row.deductionAgorot ?? 0) > 0 && !row.reversedAt;
  const formId = `reverse-${row.id}`;

  return (
    <>
      <tr className="border-b border-slate-100 align-top last:border-0">
        <td className="px-2 py-2 font-medium">{t("sequenceValue", { number: row.monthlySequenceNumber })}</td>
        <td className="px-2 py-2">
          <BusinessDateText value={row.timeEntry.businessDate} />
        </td>
        <td className="px-2 py-2">{t.has(`types.${row.correction.reason}`) ? t(`types.${row.correction.reason}`) : row.correction.reason}</td>
        <td className="px-2 py-2">
          <p>
            {tHistory.rich("change", {
              field: () => <FieldName field={row.correction.field} />,
              old: () => <ChangeValue field={row.correction.field} value={row.correction.oldValue} />,
              new: () => <ChangeValue field={row.correction.field} value={row.correction.newValue} />,
            })}
          </p>
          <p className="text-xs text-slate-500">
            {tHistory.rich("by", {
              name: row.correction.editedByName ?? tHistory("unknownActor"),
              time: () => <DateTimeText value={row.correction.createdAt} />,
            })}
          </p>
          <Link href={`/attendance/${row.timeEntryId}`} className="text-xs font-medium text-brand-700 hover:underline">
            {t("viewEntry")}
          </Link>
        </td>
        <td className="px-2 py-2">
          {row.reversedAt ? (
            <>
              <p className="text-emerald-800">{t.rich("reversed", { time: () => <DateTimeText value={row.reversedAt} /> })}</p>
              <p className="text-xs text-slate-600">
                {t("reversedBy", { name: row.reversedByName ?? tHistory("unknownActor"), reason: row.reversalReason ?? "" })}
              </p>
            </>
          ) : (
            <span className="text-slate-400">{t("notReversed")}</span>
          )}
        </td>
        {money.see ? (
          <td className="px-2 py-2">
            {(row.deductionAgorot ?? 0) > 0 ? <Money agorot={row.deductionAgorot} /> : <span className="text-slate-500">{t("noDeduction")}</span>}
            {canReverse && !prompt ? (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    reverse.reset();
                    setPrompt({ reason: "", invalid: false });
                  }}
                  aria-label={t("reverse.actionFor", { number: row.monthlySequenceNumber, name: row.worker.fullLegalName })}
                >
                  {t("reverse.action")}
                </Button>
              </div>
            ) : null}
          </td>
        ) : null}
      </tr>
      {prompt ? (
        <tr>
          <td colSpan={6} className="px-2 pb-3">
            {reverse.isError ? (
              <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage(reverse.error)}
              </p>
            ) : null}
            <ReasonForm
              id={formId}
              label={t("reverse.label")}
              hint={t("reverse.hint")}
              value={prompt.reason}
              invalid={prompt.invalid}
              onChange={(reason) => setPrompt({ reason, invalid: false })}
              onSubmit={(reason) => (reason.length === 0 ? setPrompt({ ...prompt, invalid: true }) : reverse.mutate(reason))}
              onCancel={() => {
                reverse.reset();
                setPrompt(null);
              }}
              submitLabel={t("reverse.confirm")}
              pendingLabel={t("reverse.pending")}
              pending={reverse.isPending}
              busy={reverse.isPending}
              variant="danger"
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}
