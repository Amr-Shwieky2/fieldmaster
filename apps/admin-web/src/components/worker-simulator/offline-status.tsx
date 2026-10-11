"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getCodeMessage } from "@fieldmaster/i18n";
import { Badge } from "@/components/ui/badge";
import type { LocalSyncStatus } from "@/lib/worker-simulator/offline";

const STATUS_TONES: Record<LocalSyncStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  SYNCING: "info",
  VERIFIED: "success",
  FLAGGED: "warning",
  REJECTED: "danger",
  DUPLICATE: "neutral",
};

/** An offline event's status with the mobile app's own Arabic wording ("بانتظار المزامنة", "تم القبول", ...). */
export function SyncStatusBadge({ status }: { status: string }) {
  const t = useTranslations("workerSimulator");
  const known = status in STATUS_TONES;
  return <Badge tone={known ? STATUS_TONES[status as LocalSyncStatus] : "neutral"}>{known ? t(`offline.status.${status}`) : status}</Badge>;
}

/** Arabic text for an offline-sync rejection reason, as the mobile queue screen shows it. */
export function useOfflineReasonText(): (reason: string | null | undefined) => string | null {
  const t = useTranslations("workerSimulator");
  const tErrors = useTranslations("errors");
  return useCallback(
    (reason) => {
      if (!reason) return null;
      if (t.has(`offline.reasons.${reason}`)) return t(`offline.reasons.${reason}`);
      return getCodeMessage(tErrors, reason) ?? t("offline.unknownReason");
    },
    [t, tErrors],
  );
}
