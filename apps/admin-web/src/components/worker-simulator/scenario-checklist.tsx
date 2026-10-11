"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SCENARIO_IDS, SCENARIOS_WITHOUT_PREPARE, type ScenarioId } from "./types";

/** The 14 attendance scenarios, each with a one-click "prepare" where one makes sense and a manual tick. */
export function ScenarioChecklist({
  enabled,
  preparing,
  checked,
  notice,
  onPrepare,
  onToggle,
}: {
  enabled: boolean;
  preparing: ScenarioId | null;
  checked: ReadonlySet<ScenarioId>;
  notice: string | null;
  onPrepare: (id: ScenarioId) => void;
  onToggle: (id: ScenarioId) => void;
}) {
  const t = useTranslations("workerSimulator");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("scenarios.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-slate-600">{t("scenarios.help")}</p>
        {notice ? (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
            {notice}
          </p>
        ) : null}
        <ol className="space-y-3">
          {SCENARIO_IDS.map((id, index) => {
            const checkboxId = `scenario-${id}`;
            return (
              <li key={id} className="space-y-1 rounded-md border border-slate-200 p-3">
                <div className="flex items-start gap-2">
                  <input id={checkboxId} type="checkbox" className="mt-1 h-4 w-4" checked={checked.has(id)} onChange={() => onToggle(id)} />
                  <label htmlFor={checkboxId} className="font-medium text-slate-900">
                    <bdi>{`${index + 1}. `}</bdi>
                    {t(`scenarios.items.${id}.title`)}
                  </label>
                </div>
                <p className="text-slate-600">{t(`scenarios.items.${id}.hint`)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {SCENARIOS_WITHOUT_PREPARE.has(id) ? null : (
                    <Button size="sm" variant="secondary" onClick={() => onPrepare(id)} disabled={!enabled || preparing !== null}>
                      {preparing === id ? t("scenarios.preparing") : t("scenarios.prepare")}
                    </Button>
                  )}
                  {checked.has(id) ? <span className="text-green-700">{t("scenarios.checked")}</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
