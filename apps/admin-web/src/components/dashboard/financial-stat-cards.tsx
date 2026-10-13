"use client";

import { useTranslations } from "next-intl";
import type { FinancialDashboard } from "@fieldmaster/api-client";
import { MinutesText, Money } from "@/components/formatted";
import { StatCard } from "./stat-card";

/**
 * The Owner's money cards, placed in the dashboard's stat grid: overtime,
 * forgotten-stamp deductions, emergency call-outs and what the attendance
 * still waiting for approval would cost.
 */
export function FinancialStatCards({ data }: { data: FinancialDashboard }) {
  const t = useTranslations("dashboard");
  const { overtime, forgottenStamps, emergencies, pendingApproval } = data;
  return (
    <>
      <StatCard
        label={t("stats.overtime")}
        value={<Money agorot={overtime.totalAgorot} />}
        hint={t.rich("stats.overtimeHint", { minutes: () => <MinutesText minutes={overtime.totalMinutes} /> })}
      />
      <StatCard
        label={t("stats.forgottenStamps")}
        value={<Money agorot={forgottenStamps.netDeductionsAgorot} />}
        hint={t("stats.forgottenStampsHint", { penalties: forgottenStamps.penalties, reversals: forgottenStamps.reversals })}
      />
      <StatCard
        label={t("stats.emergencies")}
        value={<Money agorot={emergencies.costAgorot} />}
        hint={t.rich("stats.emergenciesHint", { count: emergencies.callouts, minutes: () => <MinutesText minutes={emergencies.compensatedMinutes} /> })}
      />
      <StatCard
        label={t("stats.pendingExposure")}
        value={<Money agorot={pendingApproval.exposureAgorot} />}
        hint={
          <>
            <p>{t("stats.pendingExposureHint", { count: pendingApproval.entries })}</p>
            {pendingApproval.entriesWithoutCompensation > 0 ? (
              <p className="text-amber-700">{t("stats.pendingWithoutCompensation", { count: pendingApproval.entriesWithoutCompensation })}</p>
            ) : null}
          </>
        }
      />
    </>
  );
}
