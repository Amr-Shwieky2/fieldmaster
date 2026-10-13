"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PayrollVersionDetail } from "@fieldmaster/api-client";
import { BusinessDateText } from "@/components/formatted";
import { Note } from "./payroll-ui";

/** `/attendance` filtered to a worker's entries of the month (the list opens on the entries waiting for approval). */
function pendingAttendanceHref(yearMonth: string, workerProfileId: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const params = new URLSearchParams({ workerProfileId, from: `${yearMonth}-01`, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` });
  return `/attendance?${params.toString()}`;
}

/**
 * What the Owner must know about the version on screen before trusting it:
 * the month changed after the calculation, approved entries that were not
 * paid (no compensation profile on their date), entries still waiting for
 * approval (not included), and a legacy version that shows only what was
 * stored before Step 7.
 */
export function PayrollBanners({ detail }: { detail: PayrollVersionDetail }) {
  const t = useTranslations("payroll.banners");
  const tPayroll = useTranslations("payroll");
  const noCompensation = detail.warnings.workersWithoutCompensation;
  const pending = detail.pending && detail.pending.entries > 0 ? detail.pending : null;

  return (
    <>
      {detail.changedSinceCalculation ? (
        <Note tone="warning">
          <p className="font-semibold">{t("changed")}</p>
        </Note>
      ) : null}

      {noCompensation.length > 0 ? (
        <Note tone="warning">
          <p className="font-semibold">{t("noCompensation.title")}</p>
          <p>{t("noCompensation.description")}</p>
          <ul aria-label={t("noCompensation.listLabel")} className="space-y-1">
            {noCompensation.map((worker) => (
              <li key={worker.workerProfileId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Link href={`/workers/${worker.workerProfileId}`} className="font-semibold underline hover:no-underline">
                  {worker.fullLegalName}
                </Link>
                <span>{tPayroll("entries", { count: worker.entries })}</span>
                <ul aria-label={t("noCompensation.datesLabel", { name: worker.fullLegalName })} className="flex flex-wrap gap-x-3 gap-y-1 text-amber-800">
                  {worker.businessDates.map((date) => (
                    <li key={date}>
                      <BusinessDateText value={date} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Note>
      ) : null}

      {pending ? (
        <Note tone="info">
          <p className="font-semibold">{t("pending.title", { count: pending.entries })}</p>
          <p>{t("pending.description")}</p>
          {pending.byWorker.length > 0 ? (
            <ul aria-label={t("pending.listLabel")} className="space-y-1">
              {pending.byWorker.map((worker) => (
                <li key={worker.workerProfileId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold">{worker.fullLegalName}</span>
                  <span>{tPayroll("entries", { count: worker.entries })}</span>
                  <Link
                    href={pendingAttendanceHref(detail.yearMonth, worker.workerProfileId)}
                    aria-label={t("pending.reviewFor", { name: worker.fullLegalName })}
                    className="font-medium text-brand-700 underline hover:no-underline"
                  >
                    {t("pending.review")}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Note>
      ) : null}

      {detail.legacy ? (
        <Note tone="neutral">
          <p className="font-semibold">{t("legacy")}</p>
        </Note>
      ) : null}
    </>
  );
}
