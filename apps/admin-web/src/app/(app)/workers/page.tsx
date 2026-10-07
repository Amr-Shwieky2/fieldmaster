"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CompensationType } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { isForbidden } from "@/lib/errors";
import { EM_DASH } from "@/lib/format";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { Phone } from "@/components/formatted";
import { ArrowEndIcon } from "@/components/icons";
import { RateText } from "./_components/rate-text";

export default function WorkersPage() {
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const label = useEnumLabel();
  const { client } = useAuth();
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const pendingQuery = useQuery({ queryKey: ["workers-pending"], queryFn: () => client.listPendingApproval() });
  const pending = pendingQuery.data ?? [];
  const workers = workersQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {/* The pending list only appears when there is something to review; a 403 hides it. */}
      {pendingQuery.isError && !isForbidden(pendingQuery.error) && (
        <Card>
          <CardHeader>
            <CardTitle>{tc("pendingApproval")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorState error={pendingQuery.error} onRetry={() => void pendingQuery.refetch()} />
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("pending.title", { count: pending.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {pending.map((p) => (
                <li key={p.membershipId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-slate-200 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{p.fullLegalName}</p>
                    <p className="text-xs text-slate-500">
                      <Phone value={p.phoneNumber} />
                    </p>
                  </div>
                  <Link
                    href={`/workers/${p.workerProfileId}/approve`}
                    aria-label={t("pending.reviewLabel", { name: p.fullLegalName })}
                    className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
                  >
                    {t("pending.review")}
                    <ArrowEndIcon />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("list.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {workersQuery.isPending && <LoadingState />}
          {workersQuery.isError && <ErrorState error={workersQuery.error} onRetry={() => void workersQuery.refetch()} />}
          {workers && workers.length === 0 && <EmptyState title={t("list.empty.title")} description={t("list.empty.description")} />}
          {workers && workers.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">{t("list.title")}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {tc("name")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {tc("phone")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {tc("status")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {tc("compensation")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/workers/${w.id}`} className="font-medium text-brand-700 hover:underline">
                          {w.fullLegalName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                        <Phone value={w.phoneNumber} />
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(w.accountStatus)}>{label("AccountStatus", w.accountStatus)}</Badge>
                      </td>
                      {/* Compensation is Owner-only: the API omits it for a Field Manager, who sees an em dash. */}
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                        {w.compensation ? (
                          w.compensation.compensationType === CompensationType.DAILY ? (
                            <RateText per="day" agorot={w.compensation.dailyBaseRateAgorot} />
                          ) : (
                            <RateText per="hour" agorot={w.compensation.baseHourlyRateAgorot} />
                          )
                        ) : (
                          EM_DASH
                        )}
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
