"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { AttendanceListItem } from "@fieldmaster/api-client";
import { AttendanceListTab, DEFAULT_WORK_RULES, TimeEntryStatus } from "@fieldmaster/shared-types";
import { splitWorkedMinutes, type DayRules } from "@fieldmaster/shared-validation";
import { useAuth } from "@/lib/auth-context";
import { useShiftTitle } from "@/lib/shift-title";
import { useEnumLabel } from "@/i18n/enums";
import { monthDateRange } from "@/lib/jerusalem-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { MonthPicker } from "@/components/month-picker";
import { BusinessDateText, MinutesText, Money, TimeText } from "@/components/formatted";
import { FlagBadges } from "@/components/attendance/flag-badges";

/** At most this many entries a month (about two a day); the page says so if a month ever has more. */
const MONTH_PAGE_SIZE = 100;

/** Table columns (keys of `workers.attendanceTab.columns`). */
const COLUMNS = ["date", "shift", "clockIn", "clockOut", "worked", "regular", "overtime", "status", "flags"] as const;

/** A list row may carry the day rules in force on its business date; without them the default rules apply. */
type AttendanceRow = AttendanceListItem & { dayRules?: DayRules };

/** The standard day and overtime threshold of the entry's own business date (the work rules are versioned by date). */
function dayRulesOf(entry: AttendanceRow): DayRules {
  return entry.dayRules ?? DEFAULT_WORK_RULES;
}

/**
 * Worked / regular / overtime minutes of a row: as approved, or as approval
 * would split them (shared rule, with the entry's own day rules). A rejected
 * entry keeps its worked minutes as evidence but has no split.
 */
function minutesOf(entry: AttendanceRow): { worked: number; regular: number | null; overtime: number | null } | null {
  if (entry.rawDurationMinutes === null) return null;
  const split = splitWorkedMinutes(
    {
      rawDurationMinutes: entry.rawDurationMinutes,
      unpaidBreakMinutes: entry.unpaidBreakMinutes,
      fullDayCredit: entry.fullDayCredit,
    },
    dayRulesOf(entry),
  );
  if (entry.status === TimeEntryStatus.APPROVED) {
    return { worked: split.workedMinutes, regular: entry.approvedRegularMinutes ?? 0, overtime: entry.approvedOvertimeMinutes ?? 0 };
  }
  if (entry.status === TimeEntryStatus.REJECTED) return { worked: split.workedMinutes, regular: null, overtime: null };
  return { worked: split.workedMinutes, regular: split.regularMinutes, overtime: split.overtimeMinutes };
}

/**
 * A worker's attendance by business month (Step 5): status, minutes and flags
 * of every entry, each linking to its evidence page. No money for anyone in
 * the list; a member who may see pay (`showEarnings`: VIEW_FINANCIALS with
 * VIEW_COMPENSATION) also gets the month's estimated earnings from
 * `GET /workers/:id/estimated-earnings` (anyone else's page never asks).
 */
export function WorkerAttendanceTab({
  workerId,
  month,
  onMonthChange,
  showEarnings,
}: {
  workerId: string;
  month: string;
  onMonthChange: (month: string) => void;
  showEarnings: boolean;
}) {
  const t = useTranslations("workers.attendanceTab");
  const label = useEnumLabel();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const range = monthDateRange(month);
  const entriesQuery = useQuery({
    queryKey: ["attendance-entries", { workerProfileId: workerId, month }],
    queryFn: () =>
      client.listAttendanceEntries({ tab: AttendanceListTab.ALL, workerProfileId: workerId, from: range.from, to: range.to, pageSize: MONTH_PAGE_SIZE }),
  });

  const entries = entriesQuery.data?.items ?? [];
  // The month's totals leave rejected entries out (they are not paid, as in the Owner's earnings).
  const counted = entries.filter((entry) => entry.status !== TimeEntryStatus.REJECTED);
  const totals = counted.reduce(
    (sum, entry) => {
      const minutes = minutesOf(entry);
      return minutes
        ? { worked: sum.worked + minutes.worked, regular: sum.regular + (minutes.regular ?? 0), overtime: sum.overtime + (minutes.overtime ?? 0) }
        : sum;
    },
    { worked: 0, regular: 0, overtime: 0 },
  );

  return (
    <div className="space-y-6">
      <MonthPicker value={month} onChange={onMonthChange} label={t("month")} />
      {showEarnings ? <EarningsCard workerId={workerId} month={month} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {entriesQuery.isPending && <LoadingState />}
          {entriesQuery.isError && <ErrorState error={entriesQuery.error} onRetry={() => void entriesQuery.refetch()} />}
          {entriesQuery.isSuccess && entries.length === 0 ? <EmptyState title={t("empty.title")} description={t("empty.description")} /> : null}
          {entries.length > 0 ? (
            <>
              <p className="text-sm text-slate-600">
                {t.rich("totals", {
                  count: counted.length,
                  worked: () => <MinutesText minutes={totals.worked} />,
                  regular: () => <MinutesText minutes={totals.regular} />,
                  overtime: () => <MinutesText minutes={totals.overtime} />,
                })}
              </p>
              {counted.length < entries.length ? <p className="text-xs text-slate-500">{t("rejectedNotCounted")}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("caption")}</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      {COLUMNS.map((column) => (
                        <th key={column} scope="col" className="px-2 py-2 text-start font-medium">
                          {t(`columns.${column}`)}
                        </th>
                      ))}
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        <span className="sr-only">{t("columns.details")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const minutes = minutesOf(entry);
                      return (
                        <tr key={entry.id} className="border-b border-slate-100 align-top last:border-0">
                          <td className="px-2 py-2">
                            <BusinessDateText value={entry.businessDate} />
                          </td>
                          <td className="px-2 py-2">
                            <bdi>{shiftTitle(entry.shift)}</bdi>
                          </td>
                          <td className="px-2 py-2">
                            <TimeText value={entry.clockInAt} />
                          </td>
                          <td className="px-2 py-2">
                            <TimeText value={entry.clockOutAt} />
                          </td>
                          <td className="px-2 py-2">
                            <MinutesText minutes={minutes?.worked ?? null} />
                          </td>
                          <td className="px-2 py-2">
                            <MinutesText minutes={minutes?.regular ?? null} />
                          </td>
                          <td className="px-2 py-2">
                            <MinutesText minutes={minutes?.overtime ?? null} />
                          </td>
                          <td className="px-2 py-2">
                            <Badge tone={statusTone(entry.status)}>{label("TimeEntryStatus", entry.status)}</Badge>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap gap-1">
                              <FlagBadges flags={entry.flags} />
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <Link href={`/attendance/${entry.id}`} className="font-medium text-brand-700 hover:underline">
                              {t("viewDetails")}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {entriesQuery.data && entriesQuery.data.total > entries.length ? (
                <p className="text-xs text-slate-500">{t("truncated", { shown: entries.length, total: entriesQuery.data.total })}</p>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** Money: the month's estimated earnings, from its own endpoint (VIEW_COMPENSATION). */
function EarningsCard({ workerId, month }: { workerId: string; month: string }) {
  const tEarnings = useTranslations("workers.attendanceTab.earnings");
  const { client } = useAuth();
  const earningsQuery = useQuery({ queryKey: ["worker-earnings", workerId, month], queryFn: () => client.getWorkerEstimatedEarnings(workerId, month) });
  const earnings = earningsQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{tEarnings("title")}</CardTitle>
        <Badge tone="info">{tEarnings("ownerOnly")}</Badge>
      </CardHeader>
      <CardContent className="text-sm">
        {earningsQuery.isPending && <LoadingState />}
        {earningsQuery.isError && <ErrorState error={earningsQuery.error} onRetry={() => void earningsQuery.refetch()} />}
        {earnings ? (
          <div className="space-y-2">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">{tEarnings("approved", { count: earnings.approvedEntries })}</dt>
                <dd className="font-semibold">
                  <Money agorot={earnings.approvedAgorot} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{tEarnings("pending", { count: earnings.pendingEntries })}</dt>
                <dd className="font-semibold">
                  <Money agorot={earnings.pendingEstimateAgorot} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{tEarnings("adjustments")}</dt>
                <dd className="font-semibold">
                  <Money agorot={earnings.adjustmentsAgorot} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{tEarnings("total")}</dt>
                <dd className="text-base font-bold">
                  <Money agorot={earnings.totalEstimatedAgorot} />
                </dd>
              </div>
            </dl>
            {earnings.openEntries > 0 ? <p className="text-xs text-slate-500">{tEarnings("open", { count: earnings.openEntries })}</p> : null}
            {earnings.entriesWithoutCompensationProfile > 0 ? (
              <p className="text-xs text-amber-800">{tEarnings("noProfile", { count: earnings.entriesWithoutCompensationProfile })}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
