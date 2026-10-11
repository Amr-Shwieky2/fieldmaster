"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ApiRequestError } from "@fieldmaster/api-client";
import { getErrorCode } from "@fieldmaster/i18n";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useShiftTitle } from "@/lib/shift-title";
import { cn } from "@/lib/cn";
import { withoutMoney } from "@/lib/worker-simulator/strip-money";
import { formatCoordinates, isolateLtr } from "@/lib/worker-simulator/bidi";
import { LtrText } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncStatusBadge, useOfflineReasonText } from "./offline-status";
import type { SimulatorResult } from "./types";

const RECEIPT_TONES = {
  // Same colours as the mobile receipt card (theme successSoft/success, warningSoft/warning).
  success: { card: "bg-green-100", title: "text-green-700" },
  queued: { card: "bg-amber-100", title: "text-amber-700" },
  error: { card: "bg-red-50", title: "text-red-700" },
  info: { card: "bg-slate-100", title: "text-slate-900" },
} as const;

/** The mobile app's receipt card: rounded, padded, large type, announced politely. */
function ReceiptCard({ tone, title, children }: { tone: keyof typeof RECEIPT_TONES; title: string; children?: ReactNode }) {
  return (
    <div aria-live="polite" className={cn("w-full max-w-sm space-y-3 rounded-2xl p-6", RECEIPT_TONES[tone].card)}>
      <p className={cn("text-xl font-bold", RECEIPT_TONES[tone].title)}>{title}</p>
      {children ? <div className="space-y-2 text-base leading-relaxed text-slate-900">{children}</div> : null}
    </div>
  );
}

function rawResponse(result: SimulatorResult): unknown {
  switch (result.kind) {
    case "clockInQueued":
    case "clockOutQueued":
      return { queuedSignedEvent: result.event };
    case "error":
      if (result.error instanceof ApiRequestError) return { httpStatus: result.error.status, ...result.error.body };
      return { error: result.error instanceof Error ? result.error.message : String(result.error) };
    default:
      return result.body;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

export function ResultPanel({
  result,
  onApprove,
  approving,
}: {
  result: SimulatorResult | null;
  onApprove: (timeEntryId: string) => void;
  approving: boolean;
}) {
  const t = useTranslations("workerSimulator");
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const shiftTitle = useShiftTitle();
  const reasonText = useOfflineReasonText();

  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("result.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">{t("result.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  const raw = withoutMoney(rawResponse(result));
  const code = result.kind === "error" ? getErrorCode(result.error) : null;
  const status = result.kind === "error" && result.error instanceof ApiRequestError ? result.error.status : null;

  let receipt: ReactNode = null;
  let extra: ReactNode = null;
  switch (result.kind) {
    case "clockIn": {
      const event = result.body.clockEvent;
      receipt = (
        <ReceiptCard tone="success" title={t("receipt.clockIn.successTitle")}>
          {result.shiftTitle ? <p>{result.shiftTitle}</p> : null}
          <p>{t("receipt.clockIn.successBody", { time: format.time(result.body.timeEntry.clockInAt) })}</p>
        </ReceiptCard>
      );
      extra = (
        <div className="space-y-1 text-sm text-slate-600">
          <p>
            {t("result.gpsSaved", {
              coordinates: formatCoordinates(event.latitude, event.longitude),
              accuracy: format.number(Math.round(event.accuracyMeters)),
            })}
          </p>
          {event.distanceFromSiteMeters !== null ? <p>{t("result.gpsDistance", { meters: format.number(Math.round(event.distanceFromSiteMeters)) })}</p> : null}
        </div>
      );
      break;
    }
    case "clockInQueued":
      receipt = (
        <ReceiptCard tone="queued" title={t("receipt.clockIn.queuedTitle")}>
          {result.shiftTitle ? <p>{result.shiftTitle}</p> : null}
          <p>{t("receipt.clockIn.queuedBody")}</p>
          <p className="font-semibold">{t("receipt.clockIn.queuedAt", { time: format.time(result.event.deviceTimestamp) })}</p>
        </ReceiptCard>
      );
      break;
    case "clockOut": {
      const entry = result.body;
      const pending = !entry.status || entry.status === TimeEntryStatus.PENDING_APPROVAL;
      receipt = (
        <ReceiptCard tone="success" title={t("receipt.clockOut.successTitle")}>
          <p>{t("receipt.clockOut.successBody", { time: format.time(entry.clockOutAt) })}</p>
          {entry.rawDurationMinutes !== null ? (
            <p className="font-semibold">{t("receipt.clockOut.successDuration", { duration: format.minutes(entry.rawDurationMinutes) })}</p>
          ) : null}
          {pending ? <p>{t("receipt.clockOut.successPending")}</p> : null}
        </ReceiptCard>
      );
      if (entry.status === TimeEntryStatus.PENDING_APPROVAL) {
        extra = (
          <Button variant="secondary" size="sm" onClick={() => onApprove(entry.id)} disabled={approving}>
            {approving ? t("result.approving") : t("result.approveForSplit")}
          </Button>
        );
      }
      break;
    }
    case "clockOutQueued":
      receipt = (
        <ReceiptCard tone="queued" title={t("receipt.clockOut.queuedTitle")}>
          <p>{t("receipt.clockOut.queuedBody")}</p>
          <p className="font-semibold">{t("receipt.clockOut.queuedAt", { time: format.time(result.event.deviceTimestamp) })}</p>
        </ReceiptCard>
      );
      break;
    case "emergencyStart":
      receipt = (
        <ReceiptCard tone="success" title={t("emergency.startTitle")}>
          <dl className="space-y-2">
            <Row label={t("emergency.actualStart")}>
              <LtrText>{format.time(result.body.actualStartClick)}</LtrText>
            </Row>
            <Row label={t("emergency.compensatedStart", { minutes: result.body.retroactiveMinutes })}>
              <LtrText>{format.time(result.body.compensatedStart)}</LtrText>
            </Row>
          </dl>
        </ReceiptCard>
      );
      break;
    case "emergencyEnd":
      receipt = (
        <ReceiptCard tone="success" title={t("emergency.endTitle")}>
          <dl className="space-y-2">
            <Row label={t("emergency.actualStart")}>
              <LtrText>{format.time(result.actualStart)}</LtrText>
            </Row>
            <Row label={t("emergency.compensatedStart", { minutes: result.body.retroactiveMinutes })}>
              <LtrText>{format.time(result.compensatedStart)}</LtrText>
            </Row>
            <Row label={t("emergency.actualEnd")}>
              <LtrText>{format.time(result.body.actualEndClick)}</LtrText>
            </Row>
            <Row label={t("emergency.compensatedEnd", { minutes: result.body.returnBufferMinutes })}>
              <LtrText>{format.time(result.body.compensatedEnd)}</LtrText>
            </Row>
            <Row label={t("emergency.actualWorked")}>
              <bdi>{format.minutes(result.body.actualWorkedMinutes)}</bdi>
            </Row>
            <Row label={t("emergency.totalCompensated")}>
              <bdi>
                {t("emergency.minutesValue", {
                  minutes: format.number(result.body.compensatedDurationMinutes),
                  duration: format.minutes(result.body.compensatedDurationMinutes),
                })}
              </bdi>
            </Row>
          </dl>
        </ReceiptCard>
      );
      break;
    case "tempPoint":
      receipt = <ReceiptCard tone="success" title={t("result.tempPointCreated", { name: result.body.name, time: format.time(result.body.expiresAt) })} />;
      break;
    case "rewind": {
      const elapsed = result.body.clockInAt ? Math.round((Date.now() - Date.parse(result.body.clockInAt)) / 60_000) : null;
      receipt = (
        <ReceiptCard tone="info" title={t("result.rewound", { time: format.time(result.body.clockInAt), duration: format.minutes(elapsed) })}>
          {result.body.devRewoundAt ? <Badge tone="warning">{t("status.devRewound")}</Badge> : null}
        </ReceiptCard>
      );
      break;
    }
    case "approve":
      receipt = (
        <ReceiptCard tone="success" title={result.body.shift ? shiftTitle(result.body.shift) : t("log.actions.approve")}>
          <dl className="space-y-2">
            <Row label={t("result.regular")}>
              <LtrText>{format.number(result.body.approvedRegularMinutes)}</LtrText>
            </Row>
            <Row label={t("result.overtime")}>
              <LtrText>{format.number(result.body.approvedOvertimeMinutes)}</LtrText>
            </Row>
          </dl>
        </ReceiptCard>
      );
      break;
    case "sync":
      receipt = (
        <ReceiptCard tone="info" title={result.resend ? t("log.actions.resend") : t("result.syncTitle")}>
          <ul className="space-y-2">
            {result.body.results.map((r) => (
              <li key={r.clientEventId} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SyncStatusBadge status={r.status} />
                  <LtrText className="text-xs text-slate-500">{r.clientEventId}</LtrText>
                </div>
                {reasonText(r.reason) ? <p className="text-sm">{reasonText(r.reason)}</p> : null}
              </li>
            ))}
          </ul>
        </ReceiptCard>
      );
      break;
    case "error":
      receipt = (
        <ReceiptCard tone="error" title={t("receipt.errorTitle")}>
          <p role="alert">{errorMessage(result.error)}</p>
        </ReceiptCard>
      );
      break;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("result.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs font-medium text-slate-500">{t("receipt.title")}</p>
        {receipt}
        {extra}
        {code || status !== null ? (
          <div className="flex flex-wrap gap-3 text-sm text-slate-700">
            {status !== null ? <span>{t("result.httpStatus", { status: String(status) })}</span> : null}
            {code ? <span>{t("result.errorCode", { code: isolateLtr(code) })}</span> : null}
          </div>
        ) : null}
        <details className="rounded-md border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">{t("result.rawJson")}</summary>
          {raw.removed ? <p className="px-3 text-xs text-slate-500">{t("result.moneyRemoved")}</p> : null}
          <pre dir="ltr" className="max-h-96 overflow-auto px-3 py-2 text-start font-mono text-xs text-slate-800">
            {JSON.stringify(raw.value, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
