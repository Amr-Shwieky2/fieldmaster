"use client";

import { useTranslations } from "next-intl";
import type { PayrollCostGroup } from "@fieldmaster/api-client";
import { useFormat } from "@/lib/use-format";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { MinutesText, Money } from "@/components/formatted";
import { ROW, STICKY_CELL, STICKY_HEAD, TABLE_WRAPPER, TD, TD_NUMBER, TH, TH_NUMBER, THEAD } from "./payroll-ui";

/**
 * A version's labor cost per project or per site (base and overtime pay of
 * its approved shifts; adjustments belong to workers, not to places). Shifts
 * without a project or site are emergency call-outs.
 */
export function CostGroupsTab({
  kind,
  groups,
  calculated,
  version,
}: {
  kind: "projects" | "sites";
  /** Null for a legacy version, which did not store them. */
  groups: PayrollCostGroup[] | null;
  calculated: boolean;
  version: number;
}) {
  const t = useTranslations("payroll.groups");
  const tc = useTranslations("common");
  const tPeriod = useTranslations("payroll.period");
  const format = useFormat();
  const isSites = kind === "sites";

  if (!calculated) {
    return (
      <Card>
        <EmptyState title={tPeriod("notCalculated.title")} description={tPeriod("notCalculated.description")} />
      </Card>
    );
  }
  if (groups === null) {
    return (
      <Card>
        <EmptyState title={t("notAvailable")} description={t("notAvailableDescription")} />
      </Card>
    );
  }
  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState title={t("empty")} description={t("note")} />
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className={TABLE_WRAPPER}>
          <table className="w-full min-w-[60rem] text-start text-sm">
            <caption className="sr-only">{isSites ? t("sitesCaption", { version }) : t("projectsCaption", { version })}</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={`${STICKY_HEAD} ${TH}`}>
                  {isSites ? t("columns.site") : t("columns.project")}
                </th>
                {isSites ? (
                  <th scope="col" className={TH}>
                    {t("columns.project")}
                  </th>
                ) : null}
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.shifts")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.workers")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.regular")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {tc("overtime")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.base")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.overtimePay")}
                </th>
                <th scope="col" className={TH_NUMBER}>
                  {t("columns.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id ?? "none"} className={ROW}>
                  <th scope="row" className={`${STICKY_CELL} px-4 py-3 text-start font-medium text-slate-900`}>
                    {group.name ?? <span className="text-slate-500">{isSites ? t("noSite") : t("noProject")}</span>}
                  </th>
                  {isSites ? <td className={TD}>{group.projectName ?? <span className="text-slate-500">{t("noProject")}</span>}</td> : null}
                  <td className={TD_NUMBER}>{format.number(group.approvedShifts)}</td>
                  <td className={TD_NUMBER}>{format.number(group.workers)}</td>
                  <td className={TD_NUMBER}>
                    <MinutesText minutes={group.regularMinutes} />
                  </td>
                  <td className={TD_NUMBER}>
                    <MinutesText minutes={group.overtimeMinutes} />
                  </td>
                  <td className={TD_NUMBER}>
                    <Money agorot={group.grossBaseAgorot} />
                  </td>
                  <td className={TD_NUMBER}>
                    <Money agorot={group.overtimeAgorot} />
                  </td>
                  <td className={`${TD_NUMBER} font-semibold text-slate-900`}>
                    <Money agorot={group.totalAgorot} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{t("note")}</p>
      </CardContent>
    </Card>
  );
}
