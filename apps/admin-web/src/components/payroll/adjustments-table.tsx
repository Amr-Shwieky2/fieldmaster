"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PayrollAdjustmentLine } from "@fieldmaster/api-client";
import { PayrollAdjustmentType } from "@fieldmaster/shared-types";
import { EM_DASH } from "@fieldmaster/i18n";
import { useEnumLabel } from "@/i18n/enums";
import { Badge } from "@/components/ui/badge";
import { DateTimeText } from "@/components/formatted";
import { ROW, SignedMoney, STICKY_CELL, STICKY_HEAD, TABLE_WRAPPER, TD, TD_NUMBER, TH, TH_NUMBER, THEAD } from "./payroll-ui";

/** The in-page anchor of an adjustment (a reversal links to the penalty it cancels, a penalty to its reversal). */
export function adjustmentAnchor(id: string): string {
  return `adjustment-${id}`;
}

const LINK = "font-medium text-brand-700 hover:underline";

/**
 * Payroll adjustments: worker, type, source, signed amount, reason, when and
 * by whom. A forgotten-stamp penalty links to its attendance entry and to the
 * month's forgotten stamps, and says when it was reversed; a reversal links
 * to the penalty it cancels.
 */
export function AdjustmentsTable({
  adjustments,
  yearMonth,
  caption,
  showWorker = true,
  notIncluded = false,
}: {
  adjustments: PayrollAdjustmentLine[];
  yearMonth: string;
  caption: string;
  /** False inside a worker's drill-down, where every row is the same worker. */
  showWorker?: boolean;
  /** Added after the calculation on screen: each row says it is not included yet. */
  notIncluded?: boolean;
}) {
  const t = useTranslations("payroll.adjustments");
  const enumLabel = useEnumLabel();

  return (
    <div className={TABLE_WRAPPER}>
      <table className="w-full min-w-[60rem] text-start text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className={THEAD}>
          <tr>
            {showWorker ? (
              <th scope="col" className={`${STICKY_HEAD} ${TH}`}>
                {t("columns.worker")}
              </th>
            ) : null}
            <th scope="col" className={TH}>
              {t("columns.type")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.source")}
            </th>
            <th scope="col" className={TH_NUMBER}>
              {t("columns.amount")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.reason")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.created")}
            </th>
            <th scope="col" className={TH}>
              {t("columns.links")}
            </th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((adjustment) => {
            const isPenalty = adjustment.type === PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY;
            const isReversal = adjustment.type === PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL;
            return (
              <tr key={adjustment.id} id={adjustmentAnchor(adjustment.id)} className={`${ROW} scroll-mt-24 target:bg-amber-50`}>
                {showWorker ? (
                  <th scope="row" className={`${STICKY_CELL} px-4 py-3 text-start font-medium text-slate-900`}>
                    {adjustment.fullLegalName}
                  </th>
                ) : null}
                <td className={TD}>
                  <span className="flex flex-wrap items-center gap-1">
                    <span>{enumLabel("PayrollAdjustmentType", adjustment.type)}</span>
                    {isPenalty && adjustment.reversedById ? <Badge tone="neutral">{t("reversed")}</Badge> : null}
                    {notIncluded ? <Badge tone="warning">{t("notIncludedBadge")}</Badge> : null}
                  </span>
                </td>
                <td className={TD}>{enumLabel("PayrollAdjustmentSource", adjustment.source)}</td>
                <td className={TD_NUMBER}>
                  <SignedMoney agorot={adjustment.amountAgorot} className="font-medium" />
                </td>
                <td className={TD}>{adjustment.reason ? <bdi dir="auto">{adjustment.reason}</bdi> : EM_DASH}</td>
                <td className={TD}>
                  {adjustment.createdByName ? (
                    t.rich("createdBy", { name: adjustment.createdByName, date: () => <DateTimeText value={adjustment.createdAt} /> })
                  ) : (
                    <DateTimeText value={adjustment.createdAt} />
                  )}
                </td>
                <td className={TD}>
                  {isPenalty || isReversal ? (
                    <span className="flex flex-col items-start gap-1">
                      {isPenalty && adjustment.timeEntryId ? (
                        <Link href={`/attendance/${adjustment.timeEntryId}`} className={LINK}>
                          {t("viewEntry")}
                        </Link>
                      ) : null}
                      {isPenalty && adjustment.reversedById ? (
                        <a href={`#${adjustmentAnchor(adjustment.reversedById)}`} className={LINK}>
                          {t("viewReversal")}
                        </a>
                      ) : null}
                      {isReversal && adjustment.reversalOfId ? (
                        <a href={`#${adjustmentAnchor(adjustment.reversalOfId)}`} className={LINK}>
                          {t("reverses")}
                        </a>
                      ) : null}
                      <Link href={`/attendance/forgotten-stamps?month=${yearMonth}`} className={LINK}>
                        {t("forgottenStamps")}
                      </Link>
                    </span>
                  ) : (
                    EM_DASH
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
