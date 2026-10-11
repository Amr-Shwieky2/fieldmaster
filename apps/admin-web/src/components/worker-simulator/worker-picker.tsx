"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { DevLoginUser } from "@fieldmaster/api-client";
import { cn } from "@/lib/cn";
import type { SimulatorSession } from "@/lib/worker-simulator/session";
import { Phone } from "@/components/formatted";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

function matches(user: DevLoginUser, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [user.fullLegalName, user.preferredName ?? "", user.phoneNumber].some((value) => value.toLowerCase().includes(q));
}

export function WorkerPicker({
  workers,
  current,
  pendingId,
  failed,
  onPick,
  onEnd,
}: {
  workers: DevLoginUser[];
  current: SimulatorSession | null;
  pendingId: string | null;
  failed: string | null;
  onPick: (user: DevLoginUser) => void;
  onEnd: () => void;
}) {
  const t = useTranslations("workerSimulator");
  const [query, setQuery] = useState("");
  const searchId = useId();
  const visible = useMemo(() => workers.filter((w) => matches(w, query)), [workers, query]);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{t("picker.title")}</CardTitle>
        {current ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-800">{t("picker.current", { name: current.fullLegalName })}</span>
            <Button size="sm" variant="secondary" onClick={onEnd}>
              {t("picker.endSession")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {workers.length === 0 ? (
          <p className="text-sm text-slate-500">{t("picker.noWorkers")}</p>
        ) : (
          <>
            <div>
              <Label htmlFor={searchId}>{t("picker.searchLabel")}</Label>
              <Input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("picker.searchPlaceholder")} />
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-slate-500">{t("picker.noMatches")}</p>
            ) : (
              <ul className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2" aria-label={t("picker.title")}>
                {visible.map((worker) => {
                  const isCurrent = current?.membershipId === worker.membershipId;
                  const isPending = pendingId === worker.membershipId;
                  return (
                    <li key={worker.membershipId}>
                      <button
                        type="button"
                        onClick={() => onPick(worker)}
                        disabled={pendingId !== null}
                        aria-pressed={isCurrent}
                        aria-label={`${t("picker.actAs")}: ${worker.fullLegalName}`}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-start text-sm transition-colors disabled:cursor-wait",
                          isCurrent ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50",
                        )}
                      >
                        <span className="font-medium text-slate-900">{worker.fullLegalName}</span>
                        <Phone value={worker.phoneNumber} className="text-xs text-slate-500" />
                        {isPending ? <span className="text-xs text-brand-700">{t("picker.signingIn")}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {failed ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {failed}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
