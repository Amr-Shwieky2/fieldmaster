"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { PayrollTotals, PayrollVersionDetail, PayrollWorkerLine } from "@fieldmaster/api-client";
import { cn } from "@/lib/cn";
import { useFormat } from "@/lib/use-format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { ChevronEndIcon } from "@/components/icons";
import { MinutesText, Money } from "@/components/formatted";
import { WorkerDrilldown } from "./worker-drilldown";
import { AddedMoney, DeductedMoney, hasResults, ROW, STICKY_CELL, STICKY_HEAD, TABLE_WRAPPER, TD_NUMBER, TH, TH_NUMBER, THEAD } from "./payroll-ui";

/** Worker + 13 figures. */
const COLUMN_COUNT = 14;

/** The figures of a worker line or of the totals, in the order of the columns. */
function Figures({ line }: { line: Omit<PayrollTotals, "workers"> }) {
  const format = useFormat();
  return (
    <>
      <td className={TD_NUMBER}>{format.number(line.approvedShifts)}</td>
      <td className={TD_NUMBER}>{format.number(line.standardDaysCredited)}</td>
      <td className={TD_NUMBER}>
        <MinutesText minutes={line.regularMinutes} />
      </td>
      <td className={TD_NUMBER}>
        <MinutesText minutes={line.overtimeMinutes} />
      </td>
      <td className={TD_NUMBER}>
        <MinutesText minutes={line.emergencyRetroactiveMinutes} />
      </td>
      <td className={TD_NUMBER}>
        <MinutesText minutes={line.emergencyReturnMinutes} />
      </td>
      <td className={TD_NUMBER}>
        <Money agorot={line.grossBaseAgorot} />
      </td>
      <td className={TD_NUMBER}>
        <Money agorot={line.overtimeAgorot} />
      </td>
      <td className={TD_NUMBER}>
        <AddedMoney agorot={line.positiveAdjustmentsAgorot} />
      </td>
      <td className={TD_NUMBER}>
        <DeductedMoney agorot={line.forgottenStampPenaltiesAgorot} />
      </td>
      <td className={TD_NUMBER}>
        <AddedMoney agorot={line.reversalsAgorot} />
      </td>
      <td className={TD_NUMBER}>
        <DeductedMoney agorot={line.otherDeductionsAgorot} />
      </td>
      <td className={`${TD_NUMBER} font-semibold text-slate-900`}>
        <Money agorot={line.netPayableAgorot} />
      </td>
    </>
  );
}

/**
 * The version's results per worker, with every figure of the calculation
 * and a totals row. Activating a worker's name opens the drill-down (the
 * worker's entries and adjustments as the calculation saw them).
 */
export function WorkersTab({ detail, monthLabel }: { detail: PayrollVersionDetail; monthLabel: string }) {
  const t = useTranslations("payroll.workers");
  const tc = useTranslations("common");
  const tPeriod = useTranslations("payroll.period");
  const baseId = useId();
  const [openWorker, setOpenWorker] = useState<string | null>(null);

  if (detail.workers.length === 0 && detail.legacyNetByWorker) {
    return <LegacyNetTable rows={detail.legacyNetByWorker} version={detail.version} />;
  }
  if (!hasResults(detail)) {
    return (
      <Card>
        <EmptyState title={tPeriod("notCalculated.title")} description={tPeriod("notCalculated.description")} />
      </Card>
    );
  }
  if (detail.workers.length === 0) {
    return (
      <Card>
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <p className="border-b border-slate-100 px-4 py-3 text-xs text-slate-500">{t("drilldownHint")}</p>
        <div className={TABLE_WRAPPER}>
          <table className="w-full min-w-[96rem] text-start text-sm">
            <caption className="sr-only">{t("caption", { month: monthLabel, version: detail.version })}</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={`${STICKY_HEAD} ${TH}`}>
                  {t("columns.worker")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.approvedShifts")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.standardDays")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.regular")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {tc("overtime")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.emergencyRetroactive")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.emergencyReturn")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.grossBase")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.overtimePay")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.positiveAdjustments")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.forgottenStampPenalties")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.reversals")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.otherDeductions")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.net")}
                </th>
              </tr>
            </thead>
            {detail.workers.map((line) => (
              <WorkerRows
                key={line.workerProfileId}
                line={line}
                yearMonth={detail.yearMonth}
                version={detail.version}
                open={openWorker === line.workerProfileId}
                panelId={`${baseId}-${line.workerProfileId}`}
                onToggle={() => setOpenWorker(openWorker === line.workerProfileId ? null : line.workerProfileId)}
              />
            ))}
            {detail.totals ? (
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <tr>
                  <th scope="row" className={`${STICKY_HEAD} px-4 py-3 text-start text-slate-900`}>
                    {t("totals", { count: detail.totals.workers })}
                  </th>
                  <Figures line={detail.totals} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{t("emergencyNote")}</p>
      </CardContent>
    </Card>
  );
}

function WorkerRows({
  line,
  yearMonth,
  version,
  open,
  panelId,
  onToggle,
}: {
  line: PayrollWorkerLine;
  yearMonth: string;
  version: number;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const t = useTranslations("payroll.workers");
  const pending = line.pendingEntries ?? 0;
  const withoutCompensation = line.entriesWithoutCompensation ?? 0;

  return (
    <tbody className="border-b border-slate-100 last:border-0">
      <tr className={open ? "bg-slate-50" : undefined}>
        <th scope="row" className={`${STICKY_CELL} px-4 py-3 text-start font-medium text-slate-900`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-start font-semibold text-brand-700 hover:underline"
          >
            <ChevronEndIcon className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90 rtl:-rotate-90")} />
            {line.fullLegalName}
          </button>
          {pending > 0 || withoutCompensation > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {pending > 0 ? <Badge tone="warning">{t("pending", { count: pending })}</Badge> : null}
              {withoutCompensation > 0 ? <Badge tone="danger">{t("withoutCompensation", { count: withoutCompensation })}</Badge> : null}
            </span>
          ) : null}
        </th>
        <Figures line={line} />
      </tr>
      {open ? (
        <tr className={ROW}>
          <td id={panelId} colSpan={COLUMN_COUNT} className="bg-slate-50 px-4 py-4">
            <WorkerDrilldown yearMonth={yearMonth} version={version} line={line} />
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

/** A legacy version that only stored the net per worker. */
function LegacyNetTable({ rows, version }: { rows: { workerProfileId: string; fullLegalName: string; netPayableAgorot: number }[]; version: number }) {
  const t = useTranslations("payroll.workers");
  return (
    <Card>
      <CardContent className="p-0">
        <div className={TABLE_WRAPPER}>
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{t("legacyCaption", { version })}</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH}>
                  {t("columns.worker")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.net")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.workerProfileId} className={ROW}>
                  <th scope="row" className="px-4 py-3 text-start font-medium text-slate-900">
                    {row.fullLegalName}
                  </th>
                  <td className={`${TD_NUMBER} font-semibold text-slate-900`}>
                    <Money agorot={row.netPayableAgorot} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
