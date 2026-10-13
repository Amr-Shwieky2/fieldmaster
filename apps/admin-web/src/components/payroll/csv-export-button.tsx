"use client";

import { useTranslations } from "next-intl";
import type { PayrollVersionDetail } from "@fieldmaster/api-client";
import { buildPayrollCsv, payrollCsvFileName, type PayrollCsvLabels } from "@/lib/payroll-csv";
import { Button } from "@/components/ui/button";

/** Saves text as a file through a temporary object URL (no request to the API). */
function downloadText(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the click has started the download.
  window.setTimeout(() => {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }, 0);
}

/** "تصدير CSV": the version on screen, one row per worker with every figure, then the totals. */
export function CsvExportButton({ detail }: { detail: PayrollVersionDetail }) {
  const tActions = useTranslations("payroll.actions");
  const tCsv = useTranslations("payroll.csv");

  const exportCsv = () => {
    const labels: PayrollCsvLabels = {
      worker: tCsv("worker"),
      approvedShifts: tCsv("approvedShifts"),
      standardDays: tCsv("standardDays"),
      regularMinutes: tCsv("regularMinutes"),
      overtimeMinutes: tCsv("overtimeMinutes"),
      emergencyRetroactiveMinutes: tCsv("emergencyRetroactiveMinutes"),
      emergencyReturnMinutes: tCsv("emergencyReturnMinutes"),
      grossBase: tCsv("grossBase"),
      overtimePay: tCsv("overtimePay"),
      positiveAdjustments: tCsv("positiveAdjustments"),
      forgottenStampPenalties: tCsv("forgottenStampPenalties"),
      reversals: tCsv("reversals"),
      otherDeductions: tCsv("otherDeductions"),
      net: tCsv("net"),
      totals: tCsv("totals"),
    };
    const csv = buildPayrollCsv({ workers: detail.workers, totals: detail.totals, legacyNetByWorker: detail.legacyNetByWorker, labels });
    downloadText(payrollCsvFileName(detail.yearMonth, detail.version), csv, "text/csv;charset=utf-8");
  };

  return (
    <Button variant="secondary" onClick={exportCsv}>
      {tActions("exportCsv")}
    </Button>
  );
}
