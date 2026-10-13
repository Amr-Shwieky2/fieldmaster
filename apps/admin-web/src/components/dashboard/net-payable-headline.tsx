"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { PayrollFigureSource } from "@fieldmaster/shared-types";
import type { FinancialDashboard } from "@fieldmaster/api-client";
import { useEnumLabel } from "@/i18n/enums";
import { useFormat } from "@/lib/use-format";
import { LtrText, Money } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The change from the previous month: the signed difference, and the change
 * as a ratio of the previous amount (null when the previous month is 0, as
 * there is nothing to compare against).
 */
export function compareWithPreviousMonth(currentAgorot: number, previousAgorot: number): { differenceAgorot: number; changeRatio: number | null } {
  const differenceAgorot = currentAgorot - previousAgorot;
  return { differenceAgorot, changeRatio: previousAgorot === 0 ? null : differenceAgorot / Math.abs(previousAgorot) };
}

/** `+23.5%` / `-10.0%` / `0.0%`: one decimal, the sign shown except for zero. */
const CHANGE_FORMAT: Intl.NumberFormatOptions = { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" };

/**
 * The month's net payable (what it pays: labor cost and adjustments), where
 * the figure comes from (a finalized payroll version, or the live estimate),
 * its labor cost, and the comparison with the previous month.
 */
export function NetPayableHeadline({ data }: { data: FinancialDashboard }) {
  const t = useTranslations("dashboard");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const titleId = useId();
  const comparisonId = useId();
  const previous = data.previousMonth;
  const { differenceAgorot, changeRatio } = compareWithPreviousMonth(data.netPayableAgorot, previous.netPayableAgorot);
  const isFinalized = data.source === PayrollFigureSource.FINALIZED;
  // `format.money` signs only negatives; the difference shows `+` too.
  const difference = differenceAgorot > 0 ? `+${format.money(differenceAgorot)}` : format.money(differenceAgorot);

  return (
    <Card>
      <CardContent className="grid gap-6 py-5 lg:grid-cols-2">
        <section aria-labelledby={titleId} className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-sm font-medium text-slate-600">
              {t("headline.title", { month: format.month(data.yearMonth) })}
            </h2>
            <Badge tone={isFinalized ? "success" : "info"}>{enumLabel("PayrollFigureSource", data.source)}</Badge>
            {isFinalized && data.finalizedVersion !== null ? <Badge>{t("headline.version", { version: data.finalizedVersion })}</Badge> : null}
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            <Money agorot={data.netPayableAgorot} />
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {t.rich("headline.laborCost", { money: () => <Money agorot={data.laborCostAgorot} className="font-medium text-slate-900" /> })}
          </p>
        </section>

        <section aria-labelledby={comparisonId} className="min-w-0 border-t border-slate-200 pt-4 lg:border-s lg:border-t-0 lg:ps-6 lg:pt-0">
          <h3 id={comparisonId} className="text-sm font-medium text-slate-600">
            {t("headline.comparison.title", { month: format.month(previous.yearMonth) })}
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <dt className="text-slate-600">{t("headline.comparison.previous")}</dt>
              <dd className="text-end">
                <Money agorot={previous.netPayableAgorot} className="font-medium text-slate-900" />
                <span className="block text-xs text-slate-500">{enumLabel("PayrollFigureSource", previous.source)}</span>
              </dd>
            </div>
            {changeRatio !== null ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <dt className="text-slate-600">{t("headline.comparison.difference")}</dt>
                  <dd>
                    <LtrText className="font-medium text-slate-900">{difference}</LtrText>
                  </dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <dt className="text-slate-600">{t("headline.comparison.change")}</dt>
                  <dd>
                    <LtrText className="font-medium text-slate-900">{format.number(changeRatio, CHANGE_FORMAT)}</LtrText>
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
          {changeRatio === null ? <p className="mt-3 text-sm text-slate-500">{t("headline.comparison.none")}</p> : null}
        </section>
      </CardContent>
    </Card>
  );
}
