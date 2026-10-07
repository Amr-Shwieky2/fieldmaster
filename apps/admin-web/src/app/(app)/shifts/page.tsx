"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { useShiftTitle } from "@/lib/shift-title";
import { DateTimeText } from "@/components/formatted";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

/** Primary-button look for a link (a <button> inside an <a> is invalid HTML). */
const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export default function ShiftsPage() {
  const { client } = useAuth();
  const t = useTranslations("shifts");
  const enumLabel = useEnumLabel();
  const shiftTitle = useShiftTitle();
  const shiftsQuery = useQuery({ queryKey: ["shifts"], queryFn: () => client.listShifts() });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <Link href="/shifts/new" className={PRIMARY_LINK_CLASSES}>
            {t("list.newShift")}
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("list.cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {shiftsQuery.isLoading && <LoadingState />}
          {shiftsQuery.isError && <ErrorState error={shiftsQuery.error} onRetry={() => void shiftsQuery.refetch()} />}
          {shiftsQuery.data && shiftsQuery.data.length === 0 && (
            <EmptyState title={t("list.empty.title")} description={t("list.empty.description")} />
          )}
          {shiftsQuery.data && shiftsQuery.data.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">{t("list.caption")}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-5 py-3 text-start font-medium">
                      {t("list.columns.title")}
                    </th>
                    <th scope="col" className="whitespace-nowrap px-5 py-3 text-start font-medium">
                      {t("list.columns.type")}
                    </th>
                    <th scope="col" className="whitespace-nowrap px-5 py-3 text-start font-medium">
                      {t("list.columns.start")}
                    </th>
                    <th scope="col" className="whitespace-nowrap px-5 py-3 text-start font-medium">
                      {t("list.columns.end")}
                    </th>
                    <th scope="col" className="whitespace-nowrap px-5 py-3 text-start font-medium">
                      {t("list.columns.assigned")}
                    </th>
                    <th scope="col" className="whitespace-nowrap px-5 py-3 text-start font-medium">
                      {t("list.columns.status")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shiftsQuery.data.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/shifts/${s.id}`} className="font-medium text-brand-700 hover:underline">
                          {shiftTitle(s)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{enumLabel("ShiftType", s.shiftType)}</td>
                      <td className="px-5 py-3 text-slate-600">
                        <DateTimeText value={s.scheduledStart} />
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        <DateTimeText value={s.scheduledEnd} />
                      </td>
                      <td className="px-5 py-3 text-slate-600">{s.assignments?.length ?? 0}</td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(s.status)} className="whitespace-nowrap">
                          {enumLabel("ShiftStatus", s.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
