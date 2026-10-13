"use client";

import { useTranslations } from "next-intl";
import type { PayrollVersionDetail } from "@fieldmaster/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { AdjustmentForm } from "./adjustment-form";
import { AdjustmentsTable } from "./adjustments-table";
import { hasResults } from "./payroll-ui";

/**
 * The version's adjustments: the ones its calculation included, and (latest
 * working version only) the ones added since, which count from the next
 * calculation. When allowed, a form adds a manual bonus or deduction.
 */
export function AdjustmentsTab({ detail, canAdd }: { detail: PayrollVersionDetail; canAdd: boolean }) {
  const t = useTranslations("payroll.adjustments");
  const notIncluded = detail.adjustmentsNotIncluded;

  return (
    <div className="space-y-6">
      {canAdd ? <AdjustmentForm yearMonth={detail.yearMonth} versionWorkers={detail.workers} /> : null}

      {notIncluded.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("notIncludedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <AdjustmentsTable adjustments={notIncluded} yearMonth={detail.yearMonth} caption={t("notIncludedCaption")} notIncluded />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("includedTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {detail.adjustments.length > 0 ? (
            <AdjustmentsTable adjustments={detail.adjustments} yearMonth={detail.yearMonth} caption={t("includedCaption", { version: detail.version })} />
          ) : (
            <EmptyState title={hasResults(detail) ? t("empty") : t("notCalculated")} description={t("emptyDescription")} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
