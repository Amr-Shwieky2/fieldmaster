"use client";

import { useTranslations } from "next-intl";
import type { PayrollCalculationRun } from "@fieldmaster/api-client";
import { PayrollCalculationState } from "@fieldmaster/shared-types";
import { getCodeMessage } from "@fieldmaster/i18n";
import { Button } from "@/components/ui/button";
import { DateTimeText, LtrText } from "@/components/formatted";

function clampPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** A running (or queued) calculation: a progress bar, the percentage and the workers processed so far. */
export function CalculationProgress({ run }: { run: PayrollCalculationRun | null }) {
  const t = useTranslations("payroll.calculation");
  const percent = clampPercent(run?.progress);
  const processed = run?.processedWorkers ?? 0;
  const total = run?.totalWorkers ?? 0;
  const queued = !run || run.state === PayrollCalculationState.QUEUED;

  return (
    <section aria-label={t("progressLabel")} className="space-y-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <p className="font-medium">{queued ? t("queued") : t("running")}</p>
      <div
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t("valueText", { percent, processed, total })}
        className="h-2.5 w-full overflow-hidden rounded-full bg-blue-100"
      >
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LtrText className="font-semibold">{t("percent", { percent })}</LtrText>
        <span>{t("workers", { processed, total })}</span>
      </p>
    </section>
  );
}

/** A failed calculation: the translated reason and, when allowed, a button to calculate again. */
export function CalculationFailed({
  run,
  canRetry,
  retrying,
  onRetry,
}: {
  run: PayrollCalculationRun;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("payroll.calculation");
  const tActions = useTranslations("payroll.actions");
  const tErrors = useTranslations("errors");
  const message = (run.errorCode ? getCodeMessage(tErrors, run.errorCode) : null) ?? tErrors("PAYROLL_CALCULATION_FAILED");

  return (
    <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-semibold">{t("failedTitle")}</p>
      <p>{message}</p>
      {run.finishedAt ? <p className="text-xs text-red-700">{t.rich("failedAt", { date: () => <DateTimeText value={run.finishedAt} /> })}</p> : null}
      {canRetry ? (
        <Button size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? tActions("starting") : t("retry")}
        </Button>
      ) : null}
    </div>
  );
}
