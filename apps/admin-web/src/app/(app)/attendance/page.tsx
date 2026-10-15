"use client";

import { Suspense, useId, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { AttendanceListFilters, AttendanceListItem } from "@fieldmaster/api-client";
import { AttendanceFlag, AttendanceListTab, DEFAULT_WORK_RULES, Permission, ShiftType, TimeEntryStatus } from "@fieldmaster/shared-types";
import { isForbidden } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useShiftTitle } from "@/lib/shift-title";
import { useEnumLabel } from "@/i18n/enums";
import { ATTENDANCE_DEFAULTS, ATTENDANCE_PAGE_SIZE, filtersToQuery, parseAttendanceFilters } from "@/lib/attendance-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { Pagination, useLastPageFallback } from "@/components/pagination";
import { BusinessDateText, DateTimeText, MinutesText } from "@/components/formatted";
import { FlagBadges } from "@/components/attendance/flag-badges";
import { EntryActions, type EntryActionSuccess } from "@/components/attendance/entry-actions";
import { CorrectionDialog } from "@/components/attendance/correction-dialog";

/**
 * The attendance list: tabs by status, filters kept in the URL, pagination.
 * Every row opens the entry's evidence page; entries waiting for a decision
 * keep the quick approve / reject (APPROVE_ATTENDANCE) and full-day credit
 * (APPLY_FULL_DAY_CREDIT) actions. No money is shown or even requested here.
 */
export default function AttendancePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AttendanceList />
    </Suspense>
  );
}

const AWAITING: string[] = [TimeEntryStatus.PENDING_APPROVAL, TimeEntryStatus.CORRECTION_REQUESTED];

function AttendanceList() {
  const t = useTranslations("attendance");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseAttendanceFilters(new URLSearchParams(searchParams?.toString() ?? ""));
  const { client } = useAuth();
  const { can } = useAccess();
  const listQuery = useQuery({
    queryKey: ["attendance-entries", filters],
    queryFn: () =>
      client.listAttendanceEntries({
        ...filters,
        pageSize: ATTENDANCE_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const [announcement, setAnnouncement] = useState<{
    key: EntryActionSuccess;
    name: string;
  } | null>(null);
  const [addingClockIn, setAddingClockIn] = useState(false);

  /** Changes the URL (and so the query); any filter change goes back to the first page. */
  const update = (changes: Partial<AttendanceListFilters>) => {
    const next = { ...filters, ...changes };
    if (!("page" in changes)) next.page = 1;
    router.replace(`${pathname}${filtersToQuery({ ...next }, ATTENDANCE_DEFAULTS)}`);
  };

  const pastEnd = useLastPageFallback(listQuery.data, (page) => update({ page }));
  const data = pastEnd ? undefined : listQuery.data;
  const pendingCount = listQuery.data?.tabCounts.PENDING ?? 0;
  const listId = useId();
  // No permission: only the access-denied state, without tabs or filters.
  const forbidden = listQuery.isError && isForbidden(listQuery.error);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {pendingCount > 0 ? <Badge tone="warning">{t("pendingCount", { count: pendingCount })}</Badge> : null}
            <Link href="/attendance/forgotten-stamps" className="text-sm font-medium text-brand-700 hover:underline">
              {t("forgottenStampsLink")}
            </Link>
            {can(Permission.CORRECT_TIME_ENTRIES) ? (
              <Button size="sm" variant="secondary" onClick={() => setAddingClockIn(true)}>
                {t("addMissingClockIn")}
              </Button>
            ) : null}
          </>
        }
      />

      <div role="status" aria-live="polite">
        {announcement ? (
          <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{t(`messages.${announcement.key}`, { name: announcement.name })}</p>
        ) : null}
      </div>

      {forbidden ? null : (
        <>
          <Tabs active={filters.tab} counts={listQuery.data?.tabCounts} panelId={listId} onSelect={(tab) => update({ tab })} />
          <Filters filters={filters} onChange={update} />
        </>
      )}

      <div id={listId} role="tabpanel" className="space-y-4">
        {(listQuery.isPending || pastEnd) && <LoadingState />}
        {listQuery.isError && <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />}
        {data && data.items.length === 0 ? (
          filters.tab === AttendanceListTab.PENDING ? (
            <EmptyState title={t("empty.title")} description={t("empty.description")} />
          ) : (
            <EmptyState title={t("emptyOther.title")} description={t("emptyOther.description")} />
          )
        ) : null}
        {data && data.items.length > 0 ? (
          <>
            <ul className="space-y-4" aria-label={t(`listLabels.${filters.tab}`)}>
              {data.items.map((entry) => (
                <li key={entry.id}>
                  <EntryCard entry={entry} tab={filters.tab} onSuccess={(key, name) => setAnnouncement({ key, name })} />
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => update({ page })} label={t("paginationLabel")} />
          </>
        ) : null}
      </div>

      {addingClockIn ? (
        <CorrectionDialog
          onClose={() => setAddingClockIn(false)}
          onSaved={(timeEntryId) => {
            setAddingClockIn(false);
            router.push(`/attendance/${timeEntryId}`);
          }}
        />
      ) : null}
    </div>
  );
}

function Tabs({
  active,
  counts,
  panelId,
  onSelect,
}: {
  active: AttendanceListTab;
  counts: Record<AttendanceListTab, number> | undefined;
  panelId: string;
  onSelect: (tab: AttendanceListTab) => void;
}) {
  const t = useTranslations("attendance");
  const label = useEnumLabel();
  return (
    <div role="tablist" aria-label={t("tabsLabel")} className="flex flex-wrap gap-2 border-b border-slate-200">
      {Object.values(AttendanceListTab).map((tab) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            onClick={() => onSelect(tab)}
            className={
              selected
                ? "-mb-px border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-700"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            }
          >
            {label("AttendanceListTab", tab)}
            {counts ? (
              <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                <bdi>{counts[tab]}</bdi>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The filter panel: closed by default, open while any filter is set (its option lists load only when open). */
function Filters({ filters, onChange }: { filters: AttendanceListFilters; onChange: (changes: Partial<AttendanceListFilters>) => void }) {
  const tFilters = useTranslations("attendance.filters");
  const label = useEnumLabel();
  const { client } = useAuth();
  const id = useId();
  const flags = filters.flags ?? [];
  const activeCount =
    [filters.workerProfileId, filters.from, filters.to, filters.projectId, filters.siteId, filters.shiftType].filter(Boolean).length + flags.length;
  const active = activeCount > 0;
  const [opened, setOpened] = useState(false);
  const open = opened || active;
  const workersQuery = useQuery({
    queryKey: ["workers"],
    queryFn: () => client.listWorkers(),
    enabled: open,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.listProjects(),
    enabled: open,
  });
  const sitesQuery = useQuery({
    queryKey: ["sites"],
    queryFn: () => client.listSites(),
    enabled: open,
  });
  const sites = (sitesQuery.data ?? []).filter((site) => !filters.projectId || site.projectId === filters.projectId);

  const toggleFlag = (flag: AttendanceFlag) =>
    onChange({
      flags: flags.includes(flag) ? flags.filter((f) => f !== flag) : [...flags, flag],
    });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{tFilters("title")}</CardTitle>
          {active ? <Badge tone="info">{tFilters("activeCount", { count: activeCount })}</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpened(false);
                onChange({
                  workerProfileId: undefined,
                  from: undefined,
                  to: undefined,
                  projectId: undefined,
                  siteId: undefined,
                  shiftType: undefined,
                  flags: undefined,
                });
              }}
            >
              {tFilters("clear")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setOpened(!opened)} aria-expanded={open} aria-controls={`${id}-panel`}>
              {open ? tFilters("hide") : tFilters("show")}
            </Button>
          )}
        </div>
      </CardHeader>
      {open ? (
        <CardContent id={`${id}-panel`} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor={`${id}-worker`}>{tFilters("worker")}</Label>
              <Select
                id={`${id}-worker`}
                value={filters.workerProfileId ?? ""}
                onChange={(event) => onChange({ workerProfileId: event.target.value || undefined })}
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
                onChange={(event) => onChange({ from: event.target.value || undefined })}
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
                onChange={(event) => onChange({ to: event.target.value || undefined })}
              />
            </div>
            <div>
              <Label htmlFor={`${id}-project`}>{tFilters("project")}</Label>
              <Select
                id={`${id}-project`}
                value={filters.projectId ?? ""}
                onChange={(event) =>
                  onChange({
                    projectId: event.target.value || undefined,
                    siteId: undefined,
                  })
                }
              >
                <option value="">{tFilters("allProjects")}</option>
                {(projectsQuery.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-site`}>{tFilters("site")}</Label>
              <Select id={`${id}-site`} value={filters.siteId ?? ""} onChange={(event) => onChange({ siteId: event.target.value || undefined })}>
                <option value="">{tFilters("allSites")}</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-shiftType`}>{tFilters("shiftType")}</Label>
              <Select
                id={`${id}-shiftType`}
                value={filters.shiftType ?? ""}
                onChange={(event) =>
                  onChange({
                    shiftType: (event.target.value || undefined) as ShiftType | undefined,
                  })
                }
              >
                <option value="">{tFilters("allShiftTypes")}</option>
                {Object.values(ShiftType).map((type) => (
                  <option key={type} value={type}>
                    {label("ShiftType", type)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-slate-700">{tFilters("flags")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {Object.values(AttendanceFlag).map((flag) => (
                <label key={flag} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={flags.includes(flag)} onChange={() => toggleFlag(flag)} />
                  {label("AttendanceFlag", flag)}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">{tFilters("flagsHint")}</p>
          </fieldset>
          <p className="text-xs text-slate-500">{tFilters("dateHint")}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function EntryCard({
  entry,
  tab,
  onSuccess,
}: {
  entry: AttendanceListItem;
  tab: AttendanceListTab;
  onSuccess: (key: EntryActionSuccess, name: string) => void;
}) {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");
  const label = useEnumLabel();
  const shiftTitle = useShiftTitle();
  const { can } = useAccess();
  const name = entry.worker.fullLegalName;
  const awaiting = AWAITING.includes(entry.status);
  // A day shorter than the standard day of the entry's own date may be credited as a full day (the API decides; the defaults when the list does not say).
  const standardDayMinutes = (entry as AttendanceListItem & { dayRules?: { standardDayMinutes: number } }).dayRules?.standardDayMinutes ?? DEFAULT_WORK_RULES.standardDayMinutes;
  const allowed = {
    approve: can(Permission.APPROVE_ATTENDANCE),
    reject: can(Permission.APPROVE_ATTENDANCE),
    fullDayCredit:
      can(Permission.APPLY_FULL_DAY_CREDIT) && entry.rawDurationMinutes !== null && entry.rawDurationMinutes < standardDayMinutes && !entry.fullDayCredit,
  };
  const showStatus = tab !== AttendanceListTab.PENDING || entry.status !== TimeEntryStatus.PENDING_APPROVAL;
  const place = [entry.shift.project?.name, entry.shift.site?.name].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>
            <Link href={`/attendance/${entry.id}`} className="hover:underline">
              {name}
            </Link>
          </CardTitle>
          <p className="text-sm text-slate-500">
            <bdi>{shiftTitle(entry.shift)}</bdi>
            {place ? (
              <>
                {" · "}
                <bdi>{place}</bdi>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showStatus ? <Badge tone={statusTone(entry.status)}>{label("TimeEntryStatus", entry.status)}</Badge> : null}
          {entry.fullDayCredit && <Badge tone="info">{t("fullDayCreditApplied")}</Badge>}
          <FlagBadges flags={entry.flags} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">{t("fields.businessDate")}</dt>
            <dd className="font-medium">
              <BusinessDateText value={entry.businessDate} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{tc("clockIn")}</dt>
            <dd className="font-medium">
              <DateTimeText value={entry.clockInAt} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{tc("clockOut")}</dt>
            <dd className="font-medium">
              <DateTimeText value={entry.clockOutAt} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("fields.duration")}</dt>
            <dd className="font-medium">
              <MinutesText minutes={entry.rawDurationMinutes} />
            </dd>
          </div>
        </dl>
        {entry.dailySummary?.text && (
          <div>
            <p className="text-slate-500">{tc("dailySummary")}</p>
            <p className="whitespace-pre-line" dir="auto">
              {entry.dailySummary.text}
            </p>
          </div>
        )}

        {awaiting && (allowed.approve || allowed.reject || allowed.fullDayCredit) ? (
          <EntryActions entryId={entry.id} workerName={name} allowed={allowed} onSuccess={onSuccess} />
        ) : null}

        <Link
          href={`/attendance/${entry.id}`}
          aria-label={t("viewDetailsFor", { name })}
          className="inline-block text-sm font-medium text-brand-700 hover:underline"
        >
          {t("viewDetails")}
        </Link>
      </CardContent>
    </Card>
  );
}
