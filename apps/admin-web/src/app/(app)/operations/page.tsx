"use client";

import { useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { OperationsSnapshot } from "@fieldmaster/api-client";
import { LocationValidationStatus } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useFormat } from "@/lib/use-format";
import { useShiftTitle } from "@/lib/shift-title";
import { useAuditReason } from "@/lib/use-audit-reason";
import { useEnumLabel } from "@/i18n/enums";
import { useOperationsStream, type StreamState } from "@/lib/use-operations-stream";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, MinutesText, TimeText } from "@/components/formatted";
import { EvidenceMap, type EvidenceArea, type EvidencePoint } from "@/components/attendance/evidence-map";

const QUERY_KEY = ["operations-live"];
/** Events are batched: a burst of clock-ins refetches the snapshot once. */
const REFETCH_DEBOUNCE_MS = 500;
/** "Late" and "open over 9 hours" change with time alone (no event), so the snapshot is also refreshed every minute. */
const TIME_REFRESH_MS = 60_000;

/**
 * The live operations page (Step 6, Owners and Field Managers): a map of the
 * last recorded position of every worker on shift (event-based: clock-in and
 * clock-out only, no continuous tracking), the sites' geofences, active
 * temporary points and emergencies, and the lists that need attention.
 * Updates arrive over the notifications SSE stream. Operational only: no
 * money, for Owners either.
 */
export default function OperationsPage() {
  const t = useTranslations("operations");
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: QUERY_KEY, queryFn: () => client.getOperationsLive(), refetchInterval: TIME_REFRESH_MS });

  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChange = useCallback(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }), REFETCH_DEBOUNCE_MS);
  }, [queryClient]);
  const streamState = useOperationsStream(onChange);
  const snapshot = snapshotQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ConnectionIndicator state={streamState} />
            {snapshot ? <span className="text-xs text-slate-500">{t.rich("updatedAt", { time: () => <TimeText value={snapshot.generatedAt} /> })}</span> : null}
          </>
        }
      />
      {snapshotQuery.isPending && <LoadingState />}
      {snapshotQuery.isError && <ErrorState error={snapshotQuery.error} onRetry={() => void snapshotQuery.refetch()} />}
      {snapshot ? <Operations snapshot={snapshot} /> : null}
    </div>
  );
}

function ConnectionIndicator({ state }: { state: StreamState }) {
  const tConnection = useTranslations("operations.connection");
  const tone = state === "connected" ? "success" : state === "connecting" ? "info" : "danger";
  return (
    <span role="status" aria-live="polite" className="flex flex-col items-end gap-0.5">
      <Badge tone={tone}>{tConnection(state)}</Badge>
      <span className="text-xs text-slate-500">
        {state === "connected" ? tConnection("connectedHint") : state === "connecting" ? tConnection("connectingHint") : tConnection("disconnectedHint")}
      </span>
    </span>
  );
}

function Operations({ snapshot }: { snapshot: OperationsSnapshot }) {
  const t = useTranslations("operations");
  const tMap = useTranslations("operations.map");
  const format = useFormat();
  const shiftTitle = useShiftTitle();

  const areas: EvidenceArea[] = [
    ...snapshot.sites.map((site) => ({
      key: `site-${site.siteId}`,
      latitude: site.centerLatitude,
      longitude: site.centerLongitude,
      radiusMeters: site.radiusMeters,
      color: "geofence" as const,
      label: tMap("site", { name: site.name, radius: format.number(site.radiusMeters) }),
    })),
    ...snapshot.temporaryPoints.map((point) => ({
      key: `point-${point.id}`,
      latitude: point.latitude,
      longitude: point.longitude,
      radiusMeters: point.radiusMeters,
      color: "temporaryPoint" as const,
      label: tMap("temporaryPoint", { name: point.name, shift: shiftTitle(point.shift) }),
    })),
  ];
  const points: EvidencePoint[] = [
    ...snapshot.workersOnShift
      .filter((worker) => worker.position !== null)
      .map((worker) => ({
        key: `worker-${worker.timeEntryId}`,
        latitude: worker.position!.latitude,
        longitude: worker.position!.longitude,
        accuracyMeters: worker.position!.accuracyMeters,
        color: worker.isEmergency ? ("emergency" as const) : worker.position!.locationValidationStatus === LocationValidationStatus.PASSED ? ("clockIn" as const) : ("flagged" as const),
        label: tMap(worker.isEmergency ? "emergencyWorker" : "worker", {
          name: worker.worker.fullLegalName,
          shift: shiftTitle(worker.shift),
          time: format.time(worker.position!.at),
        }),
      })),
    // An emergency whose worker has no clock event yet still shows where it started.
    ...snapshot.activeEmergencies
      .filter((callout) => !snapshot.workersOnShift.some((worker) => worker.timeEntryId === callout.timeEntryId && worker.position))
      .map((callout) => ({
        key: `emergency-${callout.calloutId}`,
        latitude: callout.start.latitude,
        longitude: callout.start.longitude,
        accuracyMeters: null,
        color: "emergency" as const,
        label: tMap("emergencyStart", { name: callout.worker.fullLegalName, time: format.time(callout.actualStartClick) }),
      })),
  ];

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>{tMap("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EvidenceMap areas={areas} points={points} label={tMap("label")} help={tMap("help")} />
          </CardContent>
        </Card>
        <WorkersOnShift snapshot={snapshot} />
      </div>
      <div className="space-y-6">
        <ActiveEmergencies snapshot={snapshot} />
        <ActiveShifts snapshot={snapshot} />
        <LateWorkers snapshot={snapshot} />
        <LongOpenEntries snapshot={snapshot} />
        <RejectedAttempts snapshot={snapshot} />
        <SuspiciousLocations snapshot={snapshot} />
        <OfflineReview snapshot={snapshot} />
        <p className="text-xs text-slate-500">{t("noMoney")}</p>
      </div>
    </div>
  );
}

/** A titled list card; `count` is announced in the title, `empty` shown when there is nothing. */
function ListCard({ title, empty, count, children, tone }: { title: string; empty: string; count: number; children: ReactNode; tone?: "warning" | "danger" }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <Badge tone={count > 0 ? (tone ?? "info") : "neutral"}>{count}</Badge>
      </CardHeader>
      <CardContent className="text-sm">{count === 0 ? <p className="text-slate-500">{empty}</p> : <ul className="space-y-3">{children}</ul>}</CardContent>
    </Card>
  );
}

function EntryLink({ timeEntryId }: { timeEntryId: string | null }) {
  const t = useTranslations("operations");
  if (!timeEntryId) return null;
  return (
    <Link href={`/attendance/${timeEntryId}`} className="text-xs font-medium text-brand-700 hover:underline">
      {t("viewEntry")}
    </Link>
  );
}

function WorkersOnShift({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tWorkers = useTranslations("operations.workersOnShift");
  const label = useEnumLabel();
  const shiftTitle = useShiftTitle();
  return (
    <ListCard title={tWorkers("title")} empty={tWorkers("empty")} count={snapshot.workersOnShift.length}>
      {snapshot.workersOnShift.map((worker) => (
        <li key={worker.timeEntryId} className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
          <div className="min-w-0">
            <p className="font-medium text-slate-900">
              {worker.worker.fullLegalName}
              {worker.isEmergency ? <Badge tone="danger" className="ms-2">{label("ShiftType", "EMERGENCY_CALLOUT")}</Badge> : null}
            </p>
            <p className="text-slate-600">
              <bdi>{shiftTitle(worker.shift)}</bdi>
            </p>
            <p className="text-xs text-slate-500">{tWorkers.rich("since", { time: () => <DateTimeText value={worker.clockInAt} />, duration: () => <MinutesText minutes={worker.openMinutes} /> })}</p>
            {worker.position ? (
              <p className="text-xs text-slate-500">
                {tWorkers.rich("lastPosition", {
                  event: label("ClockEventType", worker.position.eventType),
                  time: () => <TimeText value={worker.position!.at} />,
                  status: label("LocationValidationStatus", worker.position.locationValidationStatus),
                })}
              </p>
            ) : (
              <p className="text-xs text-slate-500">{tWorkers("noPosition")}</p>
            )}
          </div>
          <EntryLink timeEntryId={worker.timeEntryId} />
        </li>
      ))}
    </ListCard>
  );
}

function ActiveEmergencies({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tEmergencies = useTranslations("operations.emergencies");
  const label = useEnumLabel();
  return (
    <ListCard title={tEmergencies("title")} empty={tEmergencies("empty")} count={snapshot.activeEmergencies.length} tone="danger">
      {snapshot.activeEmergencies.map((callout) => (
        <li key={callout.calloutId} className="space-y-0.5">
          <p className="font-medium text-slate-900">{callout.worker.fullLegalName}</p>
          <p className="text-slate-600">{label("EmergencyAuthorizationSource", callout.authorizationSource)}</p>
          <p className="text-xs text-slate-500">{tEmergencies.rich("since", { time: () => <DateTimeText value={callout.actualStartClick} /> })}</p>
          <Link href={`/emergencies/${callout.calloutId}`} className="text-xs font-medium text-brand-700 hover:underline">
            {tEmergencies("view")}
          </Link>
        </li>
      ))}
    </ListCard>
  );
}

function ActiveShifts({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tShifts = useTranslations("operations.activeShifts");
  const shiftTitle = useShiftTitle();
  return (
    <ListCard title={tShifts("title")} empty={tShifts("empty")} count={snapshot.activeShifts.length}>
      {snapshot.activeShifts.map((shift) => (
        <li key={shift.id} className="space-y-0.5">
          <Link href={`/shifts/${shift.id}`} className="font-medium text-brand-700 hover:underline">
            <bdi>{shiftTitle(shift)}</bdi>
          </Link>
          {shift.siteName ? <p className="text-slate-600">{shift.siteName}</p> : null}
          <p className="text-xs text-slate-500">{tShifts.rich("window", { from: () => <TimeText value={shift.scheduledStart} />, to: () => <TimeText value={shift.scheduledEnd} /> })}</p>
          <p className="text-slate-700">{tShifts("counts", { clockedIn: shift.clockedInCount, expected: shift.expectedCount })}</p>
          {shift.lateCount > 0 ? <Badge tone="warning">{tShifts("late", { count: shift.lateCount })}</Badge> : null}
        </li>
      ))}
    </ListCard>
  );
}

function LateWorkers({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tLate = useTranslations("operations.lateWorkers");
  const shiftTitle = useShiftTitle();
  return (
    <ListCard title={tLate("title")} empty={tLate("empty")} count={snapshot.lateWorkers.length} tone="warning">
      {snapshot.lateWorkers.map((late) => (
        <li key={`${late.shift.id}-${late.worker.id}`} className="space-y-0.5">
          <p className="font-medium text-slate-900">{late.worker.fullLegalName}</p>
          <p className="text-slate-600">
            <bdi>{shiftTitle(late.shift)}</bdi>
          </p>
          <p className="text-xs text-slate-500">
            {tLate.rich("detail", { start: () => <TimeText value={late.scheduledStart} />, grace: late.graceMinutes, late: () => <MinutesText minutes={late.lateMinutes} /> })}
          </p>
        </li>
      ))}
    </ListCard>
  );
}

function LongOpenEntries({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tLongOpen = useTranslations("operations.longOpen");
  const shiftTitle = useShiftTitle();
  return (
    <ListCard title={tLongOpen("title")} empty={tLongOpen("empty")} count={snapshot.longOpenEntries.length} tone="warning">
      {snapshot.longOpenEntries.map((entry) => (
        <li key={entry.timeEntryId} className="space-y-0.5">
          <p className="font-medium text-slate-900">{entry.worker.fullLegalName}</p>
          <p className="text-slate-600">
            <bdi>{shiftTitle(entry.shift)}</bdi>
          </p>
          <p className="text-xs text-slate-500">{tLongOpen.rich("openFor", { duration: () => <MinutesText minutes={entry.openMinutes} /> })}</p>
          <EntryLink timeEntryId={entry.timeEntryId} />
        </li>
      ))}
    </ListCard>
  );
}

function RejectedAttempts({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tRejected = useTranslations("operations.rejected");
  const tAttempts = useTranslations("attendance.detail.attempts");
  const label = useEnumLabel();
  const format = useFormat();
  const shiftTitle = useShiftTitle();
  const reason = (code: string) => (tAttempts.has(`codes.${code}`) ? tAttempts(`codes.${code}`) : tAttempts("unknownCode"));
  return (
    <ListCard title={tRejected("title")} empty={tRejected("empty")} count={snapshot.recentRejectedAttempts.length} tone="warning">
      {snapshot.recentRejectedAttempts.map((attempt) => (
        <li key={attempt.id} className="space-y-0.5">
          <p className="font-medium text-slate-900">{attempt.worker.fullLegalName}</p>
          <p className="text-slate-600">{tRejected("what", { event: label("ClockEventType", attempt.eventType), reason: reason(attempt.code) })}</p>
          {attempt.distanceMeters !== null && attempt.allowedRadiusMeters !== null ? (
            <p className="text-xs text-slate-500">{tRejected("distance", { distance: format.number(Math.round(attempt.distanceMeters)), allowed: format.number(attempt.allowedRadiusMeters) })}</p>
          ) : null}
          {attempt.requiredAccuracyMeters !== null ? (
            <p className="text-xs text-slate-500">
              {tRejected("accuracy", { accuracy: format.number(Math.round(attempt.accuracyMeters)), required: format.number(attempt.requiredAccuracyMeters) })}
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            {tRejected.rich("where", { shift: () => <bdi>{shiftTitle(attempt.shift)}</bdi>, time: () => <TimeText value={attempt.at} /> })}
          </p>
          <EntryLink timeEntryId={attempt.timeEntryId} />
        </li>
      ))}
    </ListCard>
  );
}

function SuspiciousLocations({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tSuspicious = useTranslations("operations.suspicious");
  const label = useEnumLabel();
  return (
    <ListCard title={tSuspicious("title")} empty={tSuspicious("empty")} count={snapshot.suspiciousLocations.length} tone="danger">
      {snapshot.suspiciousLocations.map((event) => (
        <li key={event.clockEventId} className="space-y-0.5">
          <p className="font-medium text-slate-900">{event.worker.fullLegalName}</p>
          <p className="text-slate-600">
            {tSuspicious("what", {
              event: label("ClockEventType", event.eventType),
              status: event.mockLocationSuspected ? tSuspicious("mock") : label("LocationValidationStatus", event.locationValidationStatus),
            })}
          </p>
          <p className="text-xs text-slate-500">{tSuspicious.rich("when", { origin: label("EventOrigin", event.origin), time: () => <TimeText value={event.at} /> })}</p>
          <EntryLink timeEntryId={event.timeEntryId} />
        </li>
      ))}
    </ListCard>
  );
}

function OfflineReview({ snapshot }: { snapshot: OperationsSnapshot }) {
  const tOffline = useTranslations("operations.offline");
  const label = useEnumLabel();
  const auditReason = useAuditReason();
  return (
    <ListCard title={tOffline("title")} empty={tOffline("empty")} count={snapshot.offlineReview.length} tone="warning">
      {snapshot.offlineReview.map((event) => (
        <li key={event.id} className="space-y-0.5">
          <p className="font-medium text-slate-900">{event.worker.fullLegalName}</p>
          <p className="text-slate-600">{tOffline("what", { event: label("ClockEventType", event.eventType), status: label("OfflineSyncEventStatus", event.status) })}</p>
          {event.rejectionReason ? <p className="text-xs text-slate-500">{auditReason(event.rejectionReason)}</p> : null}
          <p className="text-xs text-slate-500">{tOffline.rich("recorded", { device: () => <DateTimeText value={event.deviceTimestamp} />, synced: () => <DateTimeText value={event.processedAt} /> })}</p>
          <EntryLink timeEntryId={event.timeEntryId} />
        </li>
      ))}
    </ListCard>
  );
}
