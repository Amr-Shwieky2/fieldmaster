"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { CreateReportCard } from "@/components/reports/create-report-card";
import { ReportsHistory } from "@/components/reports/reports-history";

/**
 * Reports (Owner and Field Manager). Each report is generated in the
 * background as a PDF and a CSV whose SHA-256 hashes are recorded, so a
 * changed file is detected later. Money appears only in an Owner's
 * (financial) copy; the payroll report is the Owner's alone.
 */
export default function ReportsPage() {
  const t = useTranslations("reports");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <CreateReportCard />
      <ReportsHistory />
    </div>
  );
}
