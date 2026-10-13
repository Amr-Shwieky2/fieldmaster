"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { PayrollVersionSummary } from "@fieldmaster/api-client";
import { EM_DASH } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useAuditReason } from "@/lib/use-audit-reason";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { Badge, statusTone } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { DateTimeText, Money } from "@/components/formatted";
import { payrollKeys } from "./payroll-queries";
import { ROW, TABLE_WRAPPER, TD, TD_NUMBER, TH, TH_NUMBER, THEAD } from "./payroll-ui";

type VersionOriginFields = Pick<PayrollVersionSummary, "createdAt" | "createdByName" | "reopenedAt" | "reopenedByName" | "reopenReason">;

/** How a version started: version 1 by its first calculation, later ones by a reopen (by whom, when, why). */
export function VersionOrigin({ version }: { version: VersionOriginFields }) {
  const tOrigin = useTranslations("payroll.origin");
  const auditReason = useAuditReason();

  if (version.reopenedAt) {
    const date = () => <DateTimeText value={version.reopenedAt} />;
    // Reopens made before the web app was Arabic only stored a fixed English reason; it is shown in Arabic.
    const reason = version.reopenReason ? auditReason(version.reopenReason) : null;
    if (version.reopenedByName) {
      return reason
        ? tOrigin.rich("reopened", { name: version.reopenedByName, reason, date })
        : tOrigin.rich("reopenedNoReason", { name: version.reopenedByName, date });
    }
    return reason ? tOrigin.rich("reopenedUnknown", { reason, date }) : tOrigin.rich("reopenedUnknownNoReason", { date });
  }
  const date = () => <DateTimeText value={version.createdAt} />;
  return version.createdByName ? tOrigin.rich("created", { name: version.createdByName, date }) : tOrigin.rich("createdUnknown", { date });
}

/** "<date> بواسطة <name>", or the date alone; a dash when it did not happen. */
export function DoneBy({ at, by }: { at: string | null; by: string | null }) {
  const tOrigin = useTranslations("payroll.origin");
  if (!at) return <>{EM_DASH}</>;
  return by ? <>{tOrigin.rich("by", { name: by, date: () => <DateTimeText value={at} /> })}</> : <DateTimeText value={at} />;
}

/** The month's version history: who started each version, when and why, its calculation and finalization. */
export function VersionsTab({ yearMonth, monthLabel, viewedVersion }: { yearMonth: string; monthLabel: string; viewedVersion: number }) {
  const t = useTranslations("payroll.versions");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const { client } = useAuth();
  const query = useQuery({ queryKey: payrollKeys.versions(yearMonth), queryFn: () => client.listPayrollVersions(yearMonth) });
  const versions = [...(query.data ?? [])].sort((a, b) => b.version - a.version);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {query.isPending ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isSuccess && versions.length === 0 ? <EmptyState title={t("empty")} /> : null}
        {versions.length > 0 ? (
          <div className={TABLE_WRAPPER}>
            <table className="w-full min-w-[64rem] text-start text-sm">
              <caption className="sr-only">{t("caption", { month: monthLabel })}</caption>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className={TH}>
                    {t("columns.version")}
                  </th>
                  <th scope="col" className={TH}>
                    {t("columns.status")}
                  </th>
                  <th scope="col" className={TH}>
                    {t("columns.origin")}
                  </th>
                  <th scope="col" className={TH}>
                    {t("columns.calculated")}
                  </th>
                  <th scope="col" className={TH}>
                    {t("columns.finalized")}
                  </th>
                  <th scope="col" className={TH_NUMBER}>
                    {t("columns.workers")}
                  </th>
                  <th scope="col" className={TH_NUMBER}>
                    {t("columns.net")}
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">{t("columns.view")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id} className={`${ROW} align-top`}>
                    <th scope="row" className="px-4 py-3 text-start font-semibold text-slate-900">
                      <span className="flex flex-wrap items-center gap-1">
                        <span>{format.number(version.version)}</span>
                        {version.isCurrent ? <Badge tone="info">{t("current")}</Badge> : null}
                        {version.legacy ? <Badge tone="neutral">{t("legacy")}</Badge> : null}
                      </span>
                    </th>
                    <td className={TD}>
                      <Badge tone={statusTone(version.status)}>{enumLabel("PayrollPeriodStatus", version.status)}</Badge>
                    </td>
                    <td className={TD}>
                      <VersionOrigin version={version} />
                    </td>
                    <td className={TD}>
                      <DoneBy at={version.calculatedAt} by={version.calculatedByName} />
                    </td>
                    <td className={TD}>
                      <DoneBy at={version.finalizedAt} by={version.finalizedByName} />
                    </td>
                    <td className={TD_NUMBER}>{format.number(version.workers)}</td>
                    <td className={`${TD_NUMBER} font-semibold text-slate-900`}>
                      <Money agorot={version.netPayableAgorot} />
                    </td>
                    <td className={TD}>
                      {version.version === viewedVersion ? (
                        <span aria-current="page" className="text-slate-500">
                          {t("viewing")}
                        </span>
                      ) : (
                        <Link
                          href={version.isCurrent ? `/payroll/${yearMonth}` : `/payroll/${yearMonth}?version=${version.version}`}
                          aria-label={t("viewVersion", { version: version.version })}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {t("view")}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
