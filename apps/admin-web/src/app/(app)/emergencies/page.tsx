"use client";

import { Suspense, useId } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { EmergencyCalloutFilters } from "@fieldmaster/api-client";
import { Permission, TimeEntryStatus } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useEnumLabel } from "@/i18n/enums";
import { EMERGENCY_DEFAULTS, filtersToQuery, parseEmergencyFilters } from "@/lib/attendance-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { Pagination, useLastPageFallback } from "@/components/pagination";
import { DateTimeText, MinutesText, Money } from "@/components/formatted";

const PAGE_SIZE = 20;

/**
 * Emergency call-outs (spec section 16) with their actual and compensated
 * times. The API builds a different DTO per viewer: only the items of a
 * member who may see money (VIEW_FINANCIALS) have `estimatedCostAgorot`, so
 * only their table has a cost column.
 */
export default function EmergenciesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <EmergencyList />
    </Suspense>
  );
}

function EmergencyList() {
  const t = useTranslations("emergencies");
  const tFilters = useTranslations("emergencies.filters");
  const tc = useTranslations("emergencies.list.columns");
  const label = useEnumLabel();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseEmergencyFilters(new URLSearchParams(searchParams?.toString() ?? ""));
  const { client } = useAuth();
  const { can } = useAccess();
  const showCost = can(Permission.VIEW_FINANCIALS);
  const id = useId();
  const listQuery = useQuery({
    queryKey: ["emergency-callouts", filters],
    queryFn: () => client.listEmergencyCallouts({ ...filters, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  // The worker filter's names (a member without MANAGE_WORKERS filters by none).
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers(), enabled: can(Permission.MANAGE_WORKERS) });

  const update = (changes: Partial<EmergencyCalloutFilters>) => {
    const next = { ...filters, ...changes };
    if (!("page" in changes)) next.page = 1;
    router.replace(`${pathname}${filtersToQuery({ ...next }, EMERGENCY_DEFAULTS)}`);
  };
  const active = Boolean(filters.workerProfileId || filters.from || filters.to || filters.status);
  const pastEnd = useLastPageFallback(listQuery.data, (page) => update({ page }));
  const data = pastEnd ? undefined : listQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{tFilters("title")}</CardTitle>
          {active ? (
            <Button size="sm" variant="ghost" onClick={() => update({ workerProfileId: undefined, from: undefined, to: undefined, status: undefined })}>
              {tFilters("clear")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor={`${id}-worker`}>{tFilters("worker")}</Label>
            <Select
              id={`${id}-worker`}
              value={filters.workerProfileId ?? ""}
              onChange={(event) => update({ workerProfileId: event.target.value || undefined })}
            >
              <option value="">{tFilters("allWorkers")}</option>
              {(workersQuery.data ?? []).map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.fullLegalName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-from`}>{tFilters("from")}</Label>
            <Input
              id={`${id}-from`}
              type="date"
              dir="ltr"
              value={filters.from ?? ""}
              max={filters.to}
              onChange={(event) => update({ from: event.target.value || undefined })}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-to`}>{tFilters("to")}</Label>
            <Input
              id={`${id}-to`}
              type="date"
              dir="ltr"
              value={filters.to ?? ""}
              min={filters.from}
              onChange={(event) => update({ to: event.target.value || undefined })}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-status`}>{tFilters("status")}</Label>
            <Select
              id={`${id}-status`}
              value={filters.status ?? ""}
              onChange={(event) => update({ status: (event.target.value || undefined) as TimeEntryStatus | undefined })}
            >
              <option value="">{tFilters("allStatuses")}</option>
              {Object.values(TimeEntryStatus).map((status) => (
                <option key={status} value={status}>
                  {label("TimeEntryStatus", status)}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {(listQuery.isPending || pastEnd) && <LoadingState />}
      {listQuery.isError && <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />}
      {data && data.items.length === 0 ? <EmptyState title={t("empty.title")} description={t("empty.description")} /> : null}
      {data && data.items.length > 0 ? (
        <Card>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("list.caption")}</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("worker")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("authorization")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("actualStart")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("compensatedStart")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("actualEnd")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("compensatedEnd")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("actualWorked")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("totalCompensated")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tc("status")}
                    </th>
                    {showCost ? (
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {tc("cost")}
                      </th>
                    ) : null}
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      <span className="sr-only">{tc("details")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((callout) => (
                    <tr key={callout.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2 font-medium">{callout.worker.fullLegalName}</td>
                      <td className="px-2 py-2">{label("EmergencyAuthorizationSource", callout.authorizationSource)}</td>
                      <td className="px-2 py-2">
                        <DateTimeText value={callout.actualStartClick} />
                      </td>
                      <td className="px-2 py-2">
                        <DateTimeText value={callout.compensatedStart} />
                      </td>
                      <td className="px-2 py-2">
                        {callout.actualEndClick ? <DateTimeText value={callout.actualEndClick} /> : <span className="text-slate-500">{t("notEnded")}</span>}
                      </td>
                      <td className="px-2 py-2">
                        {callout.compensatedEnd ? <DateTimeText value={callout.compensatedEnd} /> : <span className="text-slate-500">{t("notEnded")}</span>}
                      </td>
                      <td className="px-2 py-2">
                        <MinutesText minutes={callout.actualWorkedMinutes} />
                      </td>
                      <td className="px-2 py-2">
                        <MinutesText minutes={callout.compensatedDurationMinutes} />
                      </td>
                      <td className="px-2 py-2">
                        {callout.status ? <Badge tone={statusTone(callout.status)}>{label("TimeEntryStatus", callout.status)}</Badge> : null}
                      </td>
                      {showCost ? (
                        <td className="px-2 py-2">
                          <Money agorot={callout.estimatedCostAgorot} />
                        </td>
                      ) : null}
                      <td className="px-2 py-2">
                        <Link
                          href={`/emergencies/${callout.id}`}
                          aria-label={t("list.viewDetailsFor", { name: callout.worker.fullLegalName })}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {t("list.viewDetails")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => update({ page })} label={t("paginationLabel")} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
