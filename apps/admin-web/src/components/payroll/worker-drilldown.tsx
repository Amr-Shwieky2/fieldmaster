"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { PayrollEntryLine, PayrollWorkerLine } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { useShiftTitle } from "@/lib/shift-title";
import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { BusinessDateText, LtrText, MinutesText, Money, TimeText } from "@/components/formatted";
import { AdjustmentsTable } from "./adjustments-table";
import { payrollKeys } from "./payroll-queries";
import { ROW, TABLE_WRAPPER, TD, TD_NUMBER, TH, TH_NUMBER, THEAD } from "./payroll-ui";

/**
 * One worker of a version, as its calculation saw and paid it: every
 * approved entry (with the project, site, times, approved minutes, full-day
 * credit, emergency minutes and the pay) and the worker's adjustments.
 * Versions from before Step 7 did not store the entries.
 */
export function WorkerDrilldown({ yearMonth, version, line }: { yearMonth: string; version: number; line: PayrollWorkerLine }) {
  const t = useTranslations("payroll.drill");
  const { client } = useAuth();
  const query = useQuery({
    queryKey: payrollKeys.worker(yearMonth, version, line.workerProfileId),
    queryFn: () => client.getPayrollWorker(yearMonth, version, line.workerProfileId),
  });

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { entries, adjustments } = query.data;
  const name = line.fullLegalName;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">{t("entriesTitle")}</h3>
        {entries === null ? (
          <p className="text-sm text-slate-600">{t("notAvailable")}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noEntries")}</p>
        ) : (
          <EntriesTable entries={entries} caption={t("entriesCaption", { name })} />
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">{t("adjustmentsTitle")}</h3>
        {adjustments.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noAdjustments")}</p>
        ) : (
          <div className="rounded-md border border-slate-200 bg-white">
            <AdjustmentsTable adjustments={adjustments} yearMonth={yearMonth} caption={t("adjustmentsCaption", { name })} showWorker={false} />
          </div>
        )}
      </section>
    </div>
  );
}

function EntriesTable({ entries, caption }: { entries: PayrollEntryLine[]; caption: string }) {
  const t = useTranslations("payroll.drill");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const shiftTitle = useShiftTitle();

  return (
    <div className={`${TABLE_WRAPPER} rounded-md border border-slate-200 bg-white`}>
      <table className="w-full min-w-[72rem] text-start text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className={THEAD}>
          <tr>
            <th scope="col" className={TH}>
              {t("columns.date")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.shift")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.project")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.site")}
            </th>
            <th scope="col" className={TH}>
              {tc("clockIn")}
            </th>
            <th scope="col" className={TH}>
              {tc("clockOut")}
            </th>
            <th scope="col" className={TH_NUMBER}>
              {t("columns.approvedRegular")}
            </th>
            <th scope="col" className={TH_NUMBER}>
              {t("columns.approvedOvertime")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.notes")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.compensation")}
            </th>
            <th scope="col" className={TH_NUMBER}>
              {t("columns.base")}
            </th>
            <th scope="col" className={TH_NUMBER}>
              {t("columns.overtimePay")}
            </th>
            <th scope="col" className={TH_NUMBER}>
              {t("columns.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.timeEntryId} className={ROW}>
              <th scope="row" className="px-4 py-3 text-start font-medium">
                <Link href={`/attendance/${entry.timeEntryId}`} className="text-brand-700 hover:underline">
                  <BusinessDateText value={entry.businessDate} />
                </Link>
              </th>
              <td className={TD}>{shiftTitle(entry.shift)}</td>
              <td className={TD}>{entry.projectName ?? <span className="text-slate-500">{t("noProject")}</span>}</td>
              <td className={TD}>{entry.siteName ?? <span className="text-slate-500">{t("noSite")}</span>}</td>
              <td className={TD}>
                <TimeText value={entry.clockInAt} />
              </td>
              <td className={TD}>
                <TimeText value={entry.clockOutAt} />
              </td>
              <td className={TD_NUMBER}>
                <MinutesText minutes={entry.approvedRegularMinutes} />
              </td>
              <td className={TD_NUMBER}>
                <MinutesText minutes={entry.approvedOvertimeMinutes} />
              </td>
              <td className={TD}>
                <span className="flex flex-wrap gap-1">
                  {entry.fullDayCredit ? <Badge tone="info">{tc("creditAsFullDay")}</Badge> : null}
                  {entry.isEmergency ? (
                    <Badge tone="danger">
                      {t.rich("emergency", {
                        before: entry.emergencyRetroactiveMinutes,
                        after: entry.emergencyReturnMinutes,
                        ltr: (chunks) => <LtrText className="mx-1">{chunks}</LtrText>,
                      })}
                    </Badge>
                  ) : null}
                </span>
              </td>
              <td className={TD}>
                {entry.compensationType ? (
                  enumLabel("CompensationType", entry.compensationType)
                ) : (
                  <span className="font-medium text-amber-800">{t("noCompensation")}</span>
                )}
              </td>
              <td className={TD_NUMBER}>
                <Money agorot={entry.baseAgorot} />
              </td>
              <td className={TD_NUMBER}>
                <Money agorot={entry.overtimeAgorot} />
              </td>
              <td className={`${TD_NUMBER} font-semibold text-slate-900`}>
                <Money agorot={entry.totalAgorot} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
