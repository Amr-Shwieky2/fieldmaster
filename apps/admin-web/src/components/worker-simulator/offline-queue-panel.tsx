"use client";

import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/i18n/enums";
import { useFormat } from "@/lib/use-format";
import { formatCoordinates } from "@/lib/worker-simulator/bidi";
import type { QueuedOfflineEvent } from "@/lib/worker-simulator/offline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncStatusBadge, useOfflineReasonText } from "./offline-status";

export function OfflineQueuePanel({
  queue,
  keyRegistered,
  canResend,
  busy,
  onSync,
  onResend,
}: {
  queue: QueuedOfflineEvent[];
  keyRegistered: boolean;
  canResend: boolean;
  busy: "sync" | "resend" | null;
  onSync: () => void;
  onResend: () => void;
}) {
  const t = useTranslations("workerSimulator");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const reasonText = useOfflineReasonText();
  const pending = queue.filter((e) => e.localStatus === "PENDING").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("offline.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-slate-600">{t("offline.help")}</p>
        <p className="text-slate-500">{keyRegistered ? t("offline.keyRegistered") : t("offline.keyNotRegistered")}</p>
        {queue.length === 0 ? (
          <p className="text-slate-500">{t("offline.empty")}</p>
        ) : (
          <ul className="space-y-2" aria-label={t("offline.title")}>
            {queue.map((event) => {
              const reason = reasonText(event.reason);
              return (
                <li key={event.clientEventId} className="space-y-1 rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{enumLabel("ClockEventType", event.eventType)}</span>
                    <SyncStatusBadge status={event.localStatus} />
                  </div>
                  <p className="text-slate-600">{t("offline.capturedAt", { time: format.dateTime(event.deviceTimestamp) })}</p>
                  <p className="text-xs text-slate-500">{formatCoordinates(event.latitude, event.longitude)}</p>
                  {reason ? <p className="text-slate-700">{reason}</p> : null}
                  {event.localStatus === "REJECTED" ? <p className="text-red-700">{t("offline.rejectedHint")}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSync} disabled={busy !== null || pending === 0}>
            {busy === "sync" ? t("offline.syncing") : t("offline.syncNow")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onResend} disabled={busy !== null || !canResend}>
            {t("offline.resendLast")}
          </Button>
        </div>
        <p className="text-xs text-slate-500">{t("offline.resendHelp")}</p>
      </CardContent>
    </Card>
  );
}
