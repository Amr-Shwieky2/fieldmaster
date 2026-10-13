"use client";

import { useId } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { FinancialDashboard } from "@fieldmaster/api-client";

/**
 * Workers with approved attendance on dates without a compensation profile:
 * those entries are not paid, so they are missing from every figure on the
 * dashboard until a rate is recorded. Nothing is rendered when there are none.
 */
export function WorkersWithoutCompensation({ workers }: { workers: FinancialDashboard["workersWithoutCompensation"] }) {
  const t = useTranslations("dashboard");
  const titleId = useId();
  if (workers.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
      <h2 id={titleId} className="font-semibold">
        {t("withoutCompensation.title")}
      </h2>
      <p className="mt-1">{t("withoutCompensation.description")}</p>
      <ul className="mt-3 space-y-1">
        {workers.map((worker) => (
          <li key={worker.workerProfileId} className="flex flex-wrap items-center justify-between gap-x-3">
            <Link href={`/workers/${worker.workerProfileId}`} className="font-medium underline-offset-2 hover:underline">
              {worker.fullLegalName}
            </Link>
            <span>{t("withoutCompensation.entries", { count: worker.entries })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
