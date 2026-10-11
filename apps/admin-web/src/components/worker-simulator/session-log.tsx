"use client";

import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/use-format";
import { timeWithSeconds } from "@/lib/worker-simulator/bidi";
import { LtrText } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionLogEntry } from "./types";

const OUTCOME_TONES = { success: "success", error: "danger", queued: "warning" } as const;

/** Every action of this simulator visit, newest first, with its time (seconds included). */
export function SessionLog({ entries }: { entries: SessionLogEntry[] }) {
  const t = useTranslations("workerSimulator");
  const format = useFormat();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("log.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">{t("log.empty")}</p>
        ) : (
          <ol className="max-h-80 space-y-2 overflow-y-auto text-sm" aria-label={t("log.title")}>
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start gap-2 border-b border-slate-100 pb-2 last:border-b-0">
                <LtrText className="font-mono text-xs text-slate-500">{timeWithSeconds(format.time, entry.at)}</LtrText>
                <span className="font-medium text-slate-800">{t(`log.actions.${entry.action}`, entry.params ?? {})}</span>
                <Badge tone={OUTCOME_TONES[entry.outcome]}>{t(`log.outcome.${entry.outcome}`)}</Badge>
                {entry.message ? <p className="w-full text-slate-600">{entry.message}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
