"use client";

import { useTranslations } from "next-intl";
import type { FinancialDashboard } from "@fieldmaster/api-client";
import { useFormat } from "@/lib/use-format";
import { BusinessDateText, MinutesText, Money } from "@/components/formatted";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/**
 * Days whose overtime (all workers together) reached the spike threshold,
 * with the rule spelled out from the API's own parameters, each day's
 * threshold and the workers who made the overtime.
 */
export function OvertimeSpikes({ overtime }: { overtime: FinancialDashboard["overtime"] }) {
  const t = useTranslations("dashboard");
  const format = useFormat();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("spikes.title")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          {t.rich("spikes.rule", {
            factor: format.number(overtime.spikeFactor),
            average: () => <MinutesText minutes={overtime.averageDailyMinutes} />,
            minimum: () => <MinutesText minutes={overtime.spikeMinimumMinutes} />,
          })}
        </p>
      </CardHeader>
      <CardContent>
        {overtime.spikes.length === 0 ? (
          <EmptyState title={t("spikes.emptyTitle")} description={t("spikes.emptyDescription")} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {overtime.spikes.map((spike) => (
              <li key={spike.date} className="py-3 first:pt-0 last:pb-0" data-testid="overtime-spike">
                <h3 className="text-sm font-semibold text-slate-900">
                  <BusinessDateText value={spike.date} />
                </h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-slate-500">{t("spikes.overtimeMinutes")}</dt>
                    <dd className="font-medium text-slate-900">
                      <MinutesText minutes={spike.overtimeMinutes} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{t("spikes.overtimeCost")}</dt>
                    <dd className="font-medium text-slate-900">
                      <Money agorot={spike.overtimeAgorot} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{t("spikes.threshold")}</dt>
                    <dd className="text-slate-700">
                      <MinutesText minutes={spike.thresholdMinutes} />
                    </dd>
                  </div>
                </dl>
                {spike.workers.length > 0 ? (
                  <ul aria-label={t("spikes.workers", { date: format.businessDate(spike.date) })} className="mt-2 flex flex-wrap gap-2">
                    {spike.workers.map((worker) => (
                      <li key={worker.workerProfileId} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                        {t.rich("spikes.worker", { name: worker.fullLegalName, minutes: () => <MinutesText minutes={worker.overtimeMinutes} /> })}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
