"use client";

import Link from "next/link";
import { Suspense, useId, useState, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PayrollAllowedActions, PayrollVersionDetail } from "@fieldmaster/api-client";
import { PayrollCalculationState, PayrollPeriodStatus } from "@fieldmaster/shared-types";
import { getErrorCode, isNotFound } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, LtrText } from "@/components/formatted";
import { ArrowStartIcon } from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ReasonForm } from "@/components/attendance/reason-form";
import { AdjustmentsTab } from "@/components/payroll/adjustments-tab";
import { CalculationFailed, CalculationProgress } from "@/components/payroll/calculation-status";
import { CostGroupsTab } from "@/components/payroll/cost-groups-tab";
import { CsvExportButton } from "@/components/payroll/csv-export-button";
import { PayrollBanners } from "@/components/payroll/payroll-banners";
import { hasResults } from "@/components/payroll/payroll-ui";
import {
  invalidatePayrollMonth,
  isCalculationRunning,
  newIdempotencyKey,
  payrollKeys,
  useCalculationRun,
  useStartPayrollCalculation,
} from "@/components/payroll/payroll-queries";
import { VersionOrigin, VersionsTab } from "@/components/payroll/versions-tab";
import { WorkersTab } from "@/components/payroll/workers-tab";

const TABS = ["workers", "projects", "sites", "adjustments", "versions"] as const;
type PayrollTab = (typeof TABS)[number];

const NO_ACTIONS: PayrollAllowedActions = { calculate: false, finalize: false, reopen: false, addAdjustment: false };

/** Outcome of the last action on this page, translated while rendering. */
type Feedback = { kind: "started" } | { kind: "succeeded" } | { kind: "finalized"; version: number } | { kind: "reopened"; version: number; previous: number };

function parseTab(value: string | null): PayrollTab {
  return TABS.find((tab) => tab === value) ?? "workers";
}

/** `?version=N`: a positive whole number, otherwise the latest version. */
function parseVersion(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
}

/** The month page's URL, keeping an earlier version (`?version=`) and a tab other than the workers (`?tab=`). */
function payrollHref(yearMonth: string, version: number | null, tab: PayrollTab): string {
  const params = new URLSearchParams();
  if (version !== null) params.set("version", String(version));
  if (tab !== "workers") params.set("tab", tab);
  const query = params.toString();
  return query ? `/payroll/${yearMonth}?${query}` : `/payroll/${yearMonth}`;
}

/**
 * A month's payroll (Owner only). The latest version is the working one and
 * may be calculated (a background job whose progress is shown), finalized
 * (it never changes again) or reopened (a new version; the finalized one
 * stays readable). `?version=N` shows an earlier version, read-only. What the
 * Owner may do now comes from the API (`allowedActions`).
 */
export default function PayrollPeriodPage() {
  return (
    <OwnerOnly>
      <Suspense fallback={<LoadingState />}>
        <PayrollPeriodContent />
      </Suspense>
    </OwnerOnly>
  );
}

function BackToPayroll() {
  const t = useTranslations("payroll.period");
  return (
    <Link href="/payroll" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
      <ArrowStartIcon />
      {t("backToList")}
    </Link>
  );
}

function PayrollPeriodContent() {
  const { yearMonth } = useParams<{ yearMonth: string }>();
  const searchParams = useSearchParams();
  const version = parseVersion(searchParams?.get("version") ?? null);
  const tab = parseTab(searchParams?.get("tab") ?? null);
  const { client } = useAuth();
  const detailQuery = useQuery({
    queryKey: payrollKeys.detail(yearMonth, version),
    queryFn: () => (version === null ? client.getPayrollPeriod(yearMonth) : client.getPayrollVersion(yearMonth, version)),
  });

  let content: ReactNode;
  if (detailQuery.data) {
    content = <PayrollVersionView detail={detailQuery.data} detailUpdatedAt={detailQuery.dataUpdatedAt} versionParam={version} tab={tab} />;
  } else if (detailQuery.isError && isNotFound(detailQuery.error)) {
    // 404: the month was never calculated (latest), or there is no such version.
    content = version === null ? <NeverCalculated yearMonth={yearMonth} /> : <VersionNotFound yearMonth={yearMonth} />;
  } else if (detailQuery.isError) {
    // 403 renders the access-denied state inside ErrorState.
    content = <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  } else {
    content = <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <BackToPayroll />
      {content}
    </div>
  );
}

function NeverCalculated({ yearMonth }: { yearMonth: string }) {
  const t = useTranslations("payroll.period");
  const tActions = useTranslations("payroll.actions");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const start = useStartPayrollCalculation(yearMonth);
  const startCalculation = () =>
    start.mutate(newIdempotencyKey(), {
      onError: (error) => {
        // Someone else started the month's first calculation: refetch so the month and its progress show.
        if (getErrorCode(error) === "PAYROLL_CALCULATION_IN_PROGRESS") void invalidatePayrollMonth(queryClient, yearMonth);
      },
    });

  return (
    <>
      <PageHeader
        title={t("title", { month: format.month(yearMonth) })}
        actions={
          <Button onClick={startCalculation} disabled={start.isPending}>
            {start.isPending ? tActions("starting") : tActions("calculate")}
          </Button>
        }
      />
      {start.isError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage(start.error)}
        </p>
      ) : null}
      <Card>
        <EmptyState title={t("notFound.title")} description={t("notFound.description")} />
      </Card>
    </>
  );
}

function VersionNotFound({ yearMonth }: { yearMonth: string }) {
  const t = useTranslations("payroll.period");
  const format = useFormat();
  return (
    <>
      <PageHeader title={t("title", { month: format.month(yearMonth) })} />
      <Card>
        <EmptyState title={t("versionNotFound.title")} description={t("versionNotFound.description")} />
        <div className="flex justify-center pb-6">
          <Link href={`/payroll/${yearMonth}`} className="text-sm font-medium text-brand-700 hover:underline">
            {t("viewCurrent")}
          </Link>
        </div>
      </Card>
    </>
  );
}

function PayrollVersionView({
  detail,
  detailUpdatedAt,
  versionParam,
  tab,
}: {
  detail: PayrollVersionDetail;
  detailUpdatedAt: number;
  versionParam: number | null;
  tab: PayrollTab;
}) {
  const t = useTranslations("payroll.period");
  const tPayroll = useTranslations("payroll");
  const tActions = useTranslations("payroll.actions");
  const tFinalize = useTranslations("payroll.finalize");
  const tReopen = useTranslations("payroll.reopen");
  const tCalculation = useTranslations("payroll.calculation");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { client } = useAuth();
  const ids = useId();
  const yearMonth = detail.yearMonth;
  const monthLabel = format.month(yearMonth);

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [panel, setPanel] = useState<"finalize" | "reopen" | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenInvalid, setReopenInvalid] = useState(false);

  const run = useCalculationRun(yearMonth, detail, detailUpdatedAt, () => setFeedback({ kind: "succeeded" }));
  const running = isCalculationRunning(run) || (detail.isCurrent && run === null && detail.status === PayrollPeriodStatus.CALCULATING);
  const failedRun = run?.state === PayrollCalculationState.FAILED ? run : null;
  // An earlier version is read-only, whatever the API says.
  const actions = detail.isCurrent ? detail.allowedActions : NO_ACTIONS;
  const calculated = hasResults(detail);

  const start = useStartPayrollCalculation(yearMonth);
  const startCalculation = () => {
    setActionError(null);
    setFeedback(null);
    setPanel(null);
    start.mutate(newIdempotencyKey(), {
      onSuccess: () => setFeedback({ kind: "started" }),
      onError: (error) => {
        setActionError(error);
        // Another calculation of the month is running: refetch so its progress shows.
        if (getErrorCode(error) === "PAYROLL_CALCULATION_IN_PROGRESS") void invalidatePayrollMonth(queryClient, yearMonth);
      },
    });
  };

  const finalize = useMutation({
    mutationFn: () => client.finalizePayroll(yearMonth),
    onMutate: () => {
      setActionError(null);
      setFeedback(null);
    },
    onSuccess: (next) => {
      setPanel(null);
      queryClient.setQueryData(payrollKeys.detail(yearMonth, null), next);
      if (versionParam !== null) queryClient.setQueryData(payrollKeys.detail(yearMonth, versionParam), next);
      setFeedback({ kind: "finalized", version: next.version });
      void invalidatePayrollMonth(queryClient, yearMonth);
    },
    onError: (error) => setActionError(error),
  });

  const reopen = useMutation({
    mutationFn: (reason: string) => client.reopenPayroll(yearMonth, reason),
    onMutate: () => {
      setActionError(null);
      setFeedback(null);
    },
    onSuccess: (next) => {
      setPanel(null);
      setReopenReason("");
      setReopenInvalid(false);
      // The new version is the month's latest: show it.
      queryClient.setQueryData(payrollKeys.detail(yearMonth, null), next);
      setFeedback({ kind: "reopened", version: next.version, previous: next.previousVersion ?? detail.version });
      if (versionParam !== null) router.replace(payrollHref(yearMonth, null, tab), { scroll: false });
      void invalidatePayrollMonth(queryClient, yearMonth);
    },
    onError: (error) => setActionError(error),
  });

  const togglePanel = (next: "finalize" | "reopen") => {
    setActionError(null);
    setFeedback(null);
    setReopenReason("");
    setReopenInvalid(false);
    setPanel(panel === next ? null : next);
  };

  const feedbackText = (value: Feedback): string => {
    switch (value.kind) {
      case "started":
        return tCalculation("started");
      case "succeeded":
        return tCalculation("succeeded");
      case "finalized":
        return tFinalize("success", { month: monthLabel, version: value.version });
      case "reopened":
        return tReopen("success", { version: value.version, previous: value.previous });
    }
  };

  const finalizeId = `${ids}-finalize`;
  const reopenId = `${ids}-reopen`;
  const panelId = `${ids}-panel`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t("title", { month: monthLabel })}
            <Badge tone={statusTone(detail.status)}>{enumLabel("PayrollPeriodStatus", detail.status)}</Badge>
          </span>
        }
        description={t("version", { version: detail.version })}
        actions={
          <>
            {actions.calculate ? (
              <Button variant={actions.finalize ? "secondary" : "primary"} onClick={startCalculation} disabled={start.isPending || running}>
                {start.isPending ? tActions("starting") : tActions("calculate")}
              </Button>
            ) : null}
            {actions.finalize ? (
              <Button
                onClick={() => togglePanel("finalize")}
                disabled={running || finalize.isPending}
                aria-expanded={panel === "finalize"}
                aria-controls={panel === "finalize" ? finalizeId : undefined}
              >
                {tActions("finalize")}
              </Button>
            ) : null}
            {actions.reopen ? (
              <Button
                variant="secondary"
                onClick={() => togglePanel("reopen")}
                disabled={reopen.isPending}
                aria-expanded={panel === "reopen"}
                aria-controls={panel === "reopen" ? reopenId : undefined}
              >
                {tActions("reopen")}
              </Button>
            ) : null}
            {calculated ? <CsvExportButton detail={detail} /> : null}
          </>
        }
      />

      <div aria-live="polite">
        {feedback ? (
          <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {feedbackText(feedback)}
          </p>
        ) : null}
      </div>
      {actionError !== null ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage(actionError)}
        </p>
      ) : null}

      {!detail.isCurrent ? (
        <div
          role="note"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-800"
        >
          <p className="font-semibold">{t("oldVersion", { version: detail.version })}</p>
          <Link href={payrollHref(yearMonth, null, tab)} className="font-medium text-brand-700 hover:underline">
            {t("viewCurrent")}
          </Link>
        </div>
      ) : null}

      {panel === "finalize" && actions.finalize ? (
        <section
          id={finalizeId}
          aria-labelledby={`${finalizeId}-title`}
          className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <h2 id={`${finalizeId}-title`} className="font-semibold">
            {tFinalize("confirmTitle", { month: monthLabel, version: detail.version })}
          </h2>
          <p>{tFinalize("confirmText")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => finalize.mutate()} disabled={finalize.isPending || running}>
              {finalize.isPending ? tActions("finalizing") : tFinalize("confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)} disabled={finalize.isPending}>
              {tc("cancel")}
            </Button>
          </div>
        </section>
      ) : null}

      {panel === "reopen" && actions.reopen ? (
        <ReasonForm
          id={reopenId}
          label={tReopen("label")}
          hint={tReopen("hint")}
          value={reopenReason}
          invalid={reopenInvalid}
          onChange={(value) => {
            setReopenReason(value);
            setReopenInvalid(false);
          }}
          onSubmit={(reason) => (reason.length === 0 ? setReopenInvalid(true) : reopen.mutate(reason))}
          onCancel={() => setPanel(null)}
          submitLabel={tReopen("submit")}
          pendingLabel={tActions("reopening")}
          pending={reopen.isPending}
          busy={reopen.isPending}
        />
      ) : null}

      {detail.isCurrent && running ? <CalculationProgress run={run} /> : null}
      {detail.isCurrent && failedRun ? (
        <CalculationFailed run={failedRun} canRetry={actions.calculate} retrying={start.isPending} onRetry={startCalculation} />
      ) : null}

      <PayrollBanners detail={detail} />

      <VersionSummary detail={detail} />

      <div role="tablist" aria-label={tPayroll("tabs.label")} className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((key) => (
          <button
            key={key}
            id={`${ids}-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={panelId}
            onClick={() => router.replace(payrollHref(yearMonth, versionParam, key), { scroll: false })}
            className={
              tab === key
                ? "-mb-px border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-700"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            }
          >
            {tPayroll(`tabs.${key}`)}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`}>
        {tab === "workers" ? <WorkersTab detail={detail} monthLabel={monthLabel} /> : null}
        {tab === "projects" ? <CostGroupsTab kind="projects" groups={detail.projects} calculated={calculated} version={detail.version} /> : null}
        {tab === "sites" ? <CostGroupsTab kind="sites" groups={detail.sites} calculated={calculated} version={detail.version} /> : null}
        {tab === "adjustments" ? <AdjustmentsTab detail={detail} canAdd={actions.addAdjustment} /> : null}
        {tab === "versions" ? <VersionsTab yearMonth={yearMonth} monthLabel={monthLabel} viewedVersion={detail.version} /> : null}
      </div>
    </>
  );
}

/** The version at a glance: its net, workers, last calculation, finalization and how it started. */
function VersionSummary({ detail }: { detail: PayrollVersionDetail }) {
  const t = useTranslations("payroll.period");
  const format = useFormat();
  const net =
    detail.totals?.netPayableAgorot ?? (detail.legacyNetByWorker ? detail.legacyNetByWorker.reduce((sum, row) => sum + row.netPayableAgorot, 0) : null);
  const calculatedAt = () => <DateTimeText value={detail.calculatedAt} />;
  const finalizedAt = () => <DateTimeText value={detail.finalizedAt} />;

  return (
    <Card>
      <CardContent className="space-y-1 text-sm text-slate-600">
        {net !== null ? (
          <p>
            {t.rich("totalNet", {
              total: format.money(net),
              ltr: (chunks) => <LtrText className="font-semibold text-slate-900">{chunks}</LtrText>,
            })}
          </p>
        ) : null}
        {detail.totals ? <p>{t("workersCount", { count: detail.totals.workers })}</p> : null}
        <p>
          {detail.calculatedAt
            ? detail.calculatedByName
              ? t.rich("calculated", { name: detail.calculatedByName, date: calculatedAt })
              : t.rich("calculatedUnknown", { date: calculatedAt })
            : t("notCalculated.title")}
        </p>
        {detail.finalizedAt ? (
          <p>
            {detail.finalizedByName
              ? t.rich("finalized", { name: detail.finalizedByName, date: finalizedAt })
              : t.rich("finalizedUnknown", { date: finalizedAt })}
          </p>
        ) : null}
        <p>
          <VersionOrigin version={detail} />
        </p>
      </CardContent>
    </Card>
  );
}
