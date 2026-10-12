"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { EvidenceClockEvent, TimeEntryEvidence } from "@fieldmaster/api-client";
import { ClockEventType, EventOrigin } from "@fieldmaster/shared-types";
import { EM_DASH } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useFormat } from "@/lib/use-format";
import { useAuditReason } from "@/lib/use-audit-reason";
import { useShiftTitle } from "@/lib/shift-title";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { BusinessDateText, DateTimeText, LtrText, MinutesText, Money, MonthText } from "@/components/formatted";
import { EmergencyTimes } from "@/components/emergency-times";
import { EvidenceMap, type EvidenceArea, type EvidencePoint } from "./evidence-map";

/** Sections of the attendance detail page (Step 5). None of them shows money except `EntryCostCard`, which only an Owner's page renders. */

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}

const TIME_FIELDS = new Set(["clockInAt", "clockOutAt"]);

/** A corrected or audited value: a time for clock fields, minutes for the break, the text otherwise. */
export function ChangeValue({ field, value }: { field: string | null; value: string | null }) {
  const tHistory = useTranslations("attendance.detail.history");
  if (value === null || value === "") return <span className="text-slate-500">{tHistory("noValue")}</span>;
  if (field && TIME_FIELDS.has(field)) return <DateTimeText value={value} />;
  if (field === "unpaidBreakMinutes" && /^\d+$/.test(value)) return <MinutesText minutes={Number(value)} />;
  if (field === "fullDayCredit") return <>{value === "true" ? tHistory("yes") : tHistory("no")}</>;
  return <bdi>{value}</bdi>;
}

export function FieldName({ field }: { field: string }) {
  const tHistory = useTranslations("attendance.detail.history");
  return <>{tHistory.has(`fields.${field}`) ? tHistory(`fields.${field}`) : <LtrText className="font-mono text-xs">{field}</LtrText>}</>;
}

// ── Record ─────────────────────────────────────────────────────────────

export function RecordCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tRecord = useTranslations("attendance.detail.record");
  const label = useEnumLabel();
  const shiftTitle = useShiftTitle();
  const { shift } = evidence;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tRecord("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="text-sm">
          <Row label={tRecord("worker")}>
            <Link href={`/workers/${evidence.worker.id}`} className="text-brand-700 hover:underline">
              {evidence.worker.fullLegalName}
            </Link>
          </Row>
          <Row label={tRecord("phone")}>
            <LtrText>{evidence.worker.phoneNumber}</LtrText>
          </Row>
          <Row label={tRecord("shift")}>
            <Link href={`/shifts/${shift.id}`} className="text-brand-700 hover:underline">
              <bdi>{shiftTitle(shift)}</bdi>
            </Link>
          </Row>
          <Row label={tRecord("shiftType")}>{label("ShiftType", shift.shiftType)}</Row>
          <Row label={tRecord("project")}>{shift.project ? <bdi>{shift.project.name}</bdi> : tRecord("noProject")}</Row>
          <Row label={tRecord("site")}>{shift.site ? <bdi>{shift.site.name}</bdi> : tRecord("noSite")}</Row>
          <Row label={tRecord("checkInMethod")}>{label("CheckInMethod", evidence.checkInMethod)}</Row>
          <Row label={tRecord("businessDate")}>
            <BusinessDateText value={evidence.businessDate} />
          </Row>
          <Row label={tRecord("scheduled")}>
            {tRecord.rich("scheduledValue", {
              start: () => <DateTimeText value={shift.scheduledStart} />,
              end: () => <DateTimeText value={shift.scheduledEnd} />,
            })}
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────

export function TimelineCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tTimeline = useTranslations("attendance.detail.timeline");
  const correctedFields = new Set(evidence.history.corrections.map((correction) => correction.field));
  const rows = [
    { type: ClockEventType.CLOCK_IN, field: "clockInAt", validatedAt: evidence.clockInAt },
    { type: ClockEventType.CLOCK_OUT, field: "clockOutAt", validatedAt: evidence.clockOutAt },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tTimeline("title")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">{tTimeline("description")}</p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map((row) => (
          <EventEvidence
            key={row.type}
            type={row.type}
            event={evidence.clockEvents.find((event) => event.eventType === row.type)}
            validatedAt={row.validatedAt}
            corrected={correctedFields.has(row.field)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function EventEvidence({
  type,
  event,
  validatedAt,
  corrected,
}: {
  type: ClockEventType;
  event: EvidenceClockEvent | undefined;
  validatedAt: string | null;
  corrected: boolean;
}) {
  const tTimeline = useTranslations("attendance.detail.timeline");
  const label = useEnumLabel();
  const format = useFormat();
  const meters = (value: number | null) => (value === null ? EM_DASH : tTimeline("meters", { value: format.number(Math.round(value)) }));
  return (
    <section className="rounded-md border border-slate-200 p-4" aria-label={label("ClockEventType", type)}>
      <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
        {label("ClockEventType", type)}
        {corrected ? <Badge tone="warning">{tTimeline("corrected")}</Badge> : null}
      </h3>
      <dl className="text-sm">
        {event ? (
          <>
            <Row label={tTimeline("device")}>
              <DateTimeText value={event.deviceTimestamp} />
            </Row>
            <Row label={tTimeline("server")}>
              <DateTimeText value={event.serverReceivedAt} />
            </Row>
          </>
        ) : null}
        <Row label={tTimeline("validated")}>
          <DateTimeText value={validatedAt} />
        </Row>
        {event ? (
          <>
            <Row label={tTimeline("deviation")}>{tTimeline("seconds", { value: format.number(event.deviceTimeDeviationSeconds) })}</Row>
            <Row label={tTimeline("origin")}>{label("EventOrigin", event.origin)}</Row>
            {event.origin === EventOrigin.OFFLINE ? (
              <Row label={tTimeline("sync")}>
                {event.offlineSync ? (
                  <span className="flex flex-col items-end">
                    <span>
                      {label("OfflineSyncEventStatus", event.offlineSync.status)}
                      {" · "}
                      <DateTimeText value={event.offlineSync.syncedAt} />
                    </span>
                    {event.offlineSync.duplicateSyncs > 0 ? (
                      <span className="text-xs text-slate-500">{tTimeline("duplicateSyncs", { count: event.offlineSync.duplicateSyncs })}</span>
                    ) : null}
                  </span>
                ) : (
                  EM_DASH
                )}
              </Row>
            ) : null}
            <Row label={tTimeline("location")}>
              <Badge tone={statusTone(event.locationValidationStatus)}>{label("LocationValidationStatus", event.locationValidationStatus)}</Badge>
            </Row>
            <Row label={tTimeline("accuracy")}>{meters(event.accuracyMeters)}</Row>
            <Row label={event.temporaryCheckInPoint ? tTimeline("distanceFromPoint") : tTimeline("distanceFromSite")}>
              {meters(event.distanceFromSiteMeters)}
            </Row>
            {event.temporaryCheckInPoint ? (
              <Row label={tTimeline("temporaryPoint")}>
                <bdi>{event.temporaryCheckInPoint.name}</bdi>
              </Row>
            ) : null}
            {event.mockLocationSuspected ? <Row label={tTimeline("mockLocation")}>{tTimeline("mockLocationYes")}</Row> : null}
          </>
        ) : null}
      </dl>
      {!event ? <p className="mt-2 text-sm text-slate-500">{validatedAt ? tTimeline("addedByCorrection") : tTimeline("notYet")}</p> : null}
    </section>
  );
}

// ── Map + refused attempts ─────────────────────────────────────────────

export function LocationCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tMap = useTranslations("attendance.detail.map");
  const tAttempts = useTranslations("attendance.detail.attempts");
  const label = useEnumLabel();
  const format = useFormat();
  const meters = (value: number | null | undefined) => (value === null || value === undefined ? EM_DASH : format.number(Math.round(value)));
  const attemptReason = (code: string) => (tAttempts.has(`codes.${code}`) ? tAttempts(`codes.${code}`) : tAttempts("unknownCode"));
  const { shift } = evidence;

  const areas: EvidenceArea[] = [];
  if (shift.geofence) {
    areas.push({
      key: "geofence",
      latitude: shift.geofence.centerLatitude,
      longitude: shift.geofence.centerLongitude,
      radiusMeters: shift.geofence.radiusMeters,
      color: "geofence",
      label: tMap("geofence", { radius: meters(shift.geofence.radiusMeters) }),
    });
  } else if (shift.site) {
    areas.push({
      key: "site",
      latitude: shift.site.latitude,
      longitude: shift.site.longitude,
      radiusMeters: shift.site.defaultGeofenceRadiusMeters,
      color: "geofence",
      label: tMap("site", { name: shift.site.name, radius: meters(shift.site.defaultGeofenceRadiusMeters) }),
    });
  }
  const temporaryPoints = new Map<string, NonNullable<EvidenceClockEvent["temporaryCheckInPoint"]>>();
  for (const item of [...evidence.clockEvents, ...evidence.rejectedAttempts]) {
    if (item.temporaryCheckInPoint) temporaryPoints.set(item.temporaryCheckInPoint.id, item.temporaryCheckInPoint);
  }
  for (const point of temporaryPoints.values()) {
    areas.push({
      key: `point-${point.id}`,
      latitude: point.latitude,
      longitude: point.longitude,
      radiusMeters: point.radiusMeters,
      color: "temporaryPoint",
      label: tMap("temporaryPoint", { name: point.name, radius: meters(point.radiusMeters) }),
    });
  }

  const points: EvidencePoint[] = evidence.clockEvents.map((event) => ({
    key: event.id,
    latitude: event.latitude,
    longitude: event.longitude,
    accuracyMeters: event.accuracyMeters,
    color: event.eventType === ClockEventType.CLOCK_IN ? "clockIn" : "clockOut",
    label:
      event.distanceFromSiteMeters === null
        ? tMap("eventPointNoDistance", {
            event: label("ClockEventType", event.eventType),
            accuracy: meters(event.accuracyMeters),
            outcome: label("LocationValidationStatus", event.locationValidationStatus),
          })
        : tMap("eventPoint", {
            event: label("ClockEventType", event.eventType),
            accuracy: meters(event.accuracyMeters),
            distance: meters(event.distanceFromSiteMeters),
            outcome: label("LocationValidationStatus", event.locationValidationStatus),
          }),
  }));
  for (const attempt of evidence.rejectedAttempts) {
    points.push({
      key: attempt.id,
      latitude: attempt.latitude,
      longitude: attempt.longitude,
      accuracyMeters: attempt.accuracyMeters,
      color: "rejected",
      label:
        attempt.distanceMeters === null
          ? tMap("attemptPointNoDistance", {
              time: format.time(attempt.serverReceivedAt),
              event: label("ClockEventType", attempt.eventType),
              reason: attemptReason(attempt.code),
            })
          : tMap("attemptPoint", {
              time: format.time(attempt.serverReceivedAt),
              event: label("ClockEventType", attempt.eventType),
              reason: attemptReason(attempt.code),
              distance: meters(attempt.distanceMeters),
            }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tMap("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EvidenceMap areas={areas} points={points} label={tMap("label")} help={tMap("help")} />

        <div>
          <h3 className="text-sm font-semibold text-slate-900">{tAttempts("title", { count: evidence.rejectedAttempts.length })}</h3>
          {evidence.rejectedAttempts.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">{tAttempts("none")}</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{tAttempts("caption")}</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tAttempts("columns.time")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tAttempts("columns.event")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tAttempts("columns.reason")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tAttempts("columns.details")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {tAttempts("columns.origin")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.rejectedAttempts.map((attempt) => (
                    <tr key={attempt.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2">
                        <DateTimeText value={attempt.serverReceivedAt} />
                      </td>
                      <td className="px-2 py-2">{label("ClockEventType", attempt.eventType)}</td>
                      <td className="px-2 py-2 font-medium text-red-700">{attemptReason(attempt.code)}</td>
                      <td className="px-2 py-2">
                        {attempt.distanceMeters !== null
                          ? attempt.allowedRadiusMeters !== null
                            ? tAttempts("distanceValue", { distance: meters(attempt.distanceMeters), allowed: meters(attempt.allowedRadiusMeters) })
                            : tAttempts("distanceOnly", { distance: meters(attempt.distanceMeters) })
                          : attempt.requiredAccuracyMeters !== null
                            ? tAttempts("accuracyValue", { accuracy: meters(attempt.accuracyMeters), required: meters(attempt.requiredAccuracyMeters) })
                            : attempt.deviationSeconds !== null
                              ? tAttempts("deviationValue", { seconds: format.number(attempt.deviationSeconds) })
                              : EM_DASH}
                        {attempt.temporaryCheckInPoint ? (
                          <span className="block text-xs text-slate-500">{tAttempts("atTemporaryPoint", { name: attempt.temporaryCheckInPoint.name })}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">{label("EventOrigin", attempt.origin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Duration + full-day credit ─────────────────────────────────────────

export function DurationCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tDuration = useTranslations("attendance.detail.duration");
  const { duration, fullDayCredit } = evidence;
  const basisText = { APPROVED: tDuration("basisApproved"), EXPECTED: tDuration("basisExpected"), OPEN: tDuration("basisOpen") }[duration.basis];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tDuration("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl>
          <Row label={tDuration("raw")}>
            <MinutesText minutes={duration.rawDurationMinutes} />
          </Row>
          <Row label={tDuration("unpaidBreak")}>
            <MinutesText minutes={duration.unpaidBreakMinutes} />
          </Row>
          <Row label={tDuration("worked")}>
            <MinutesText minutes={duration.workedMinutes} />
          </Row>
          <Row label={tDuration("regular")}>
            <MinutesText minutes={duration.regularMinutes} />
          </Row>
          <Row label={tDuration("overtime")}>
            <MinutesText minutes={duration.overtimeMinutes} />
          </Row>
        </dl>
        <p className="text-xs text-slate-500">{basisText}</p>
        {duration.approvedSplitOutdated ? <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">{tDuration("outdated")}</p> : null}
        <div className="border-t border-slate-100 pt-3">
          <p className="font-medium text-slate-900">{tDuration("fullDayCredit")}</p>
          {fullDayCredit.applied ? (
            <>
              <p className="text-slate-700">{tDuration("fullDayCreditApplied", { reason: fullDayCredit.reason ?? EM_DASH })}</p>
              {fullDayCredit.appliedByName ? (
                <p className="text-xs text-slate-500">
                  {tDuration.rich("fullDayCreditBy", { name: fullDayCredit.appliedByName, time: () => <DateTimeText value={fullDayCredit.appliedAt} /> })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-slate-700">{fullDayCredit.eligible ? tDuration("fullDayCreditEligible") : tDuration("fullDayCreditNotEligible")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Emergency ──────────────────────────────────────────────────────────

export function EmergencyCard({ emergency }: { emergency: NonNullable<TimeEntryEvidence["emergency"]> }) {
  const tEmergency = useTranslations("attendance.detail.emergency");
  const label = useEnumLabel();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tEmergency("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="text-slate-500">{tEmergency("authorization")}: </span>
          <span className="font-medium">{label("EmergencyAuthorizationSource", emergency.authorizationSource)}</span>
          {emergency.authorizedByName ? <span className="text-slate-600"> ({tEmergency("authorizedBy", { name: emergency.authorizedByName })})</span> : null}
        </p>
        <EmergencyTimes callout={emergency} />
        <Link href={`/emergencies/${emergency.id}`} className="inline-block font-medium text-brand-700 hover:underline">
          {tEmergency("viewCallout")}
        </Link>
      </CardContent>
    </Card>
  );
}

// ── Daily summary ──────────────────────────────────────────────────────

export function SummaryCard({ summary }: { summary: TimeEntryEvidence["dailySummary"] }) {
  const tSummary = useTranslations("attendance.detail.summary");
  const tc = useTranslations("common");
  const label = useEnumLabel();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tc("dailySummary")}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {summary ? (
          <dl>
            <Row label={tSummary("category")}>{label("TaskCategory", summary.taskCategory)}</Row>
            <div className="border-b border-slate-100 py-1.5">
              <dt className="text-slate-500">{tSummary("text")}</dt>
              <dd className="mt-1 whitespace-pre-line" dir="auto">
                {summary.text ?? EM_DASH}
              </dd>
            </div>
            {summary.voiceNoteUrl ? (
              <Row label={tSummary("voiceNote")}>
                <a href={summary.voiceNoteUrl} className="text-brand-700 hover:underline" target="_blank" rel="noreferrer">
                  {tSummary("voiceNoteLink")}
                </a>
              </Row>
            ) : null}
            <Row label={tSummary("materials")}>{summary.materialsUsed ? <bdi>{summary.materialsUsed}</bdi> : EM_DASH}</Row>
            <Row label={tSummary("problems")}>{summary.problemsEncountered ? <bdi>{summary.problemsEncountered}</bdi> : EM_DASH}</Row>
            <Row label={tSummary("followUp")}>
              {summary.followUpRequired ? <Badge tone="warning">{tSummary("followUpYes")}</Badge> : tSummary("followUpNo")}
            </Row>
          </dl>
        ) : (
          <p className="text-slate-500">{tSummary("none")}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── History ────────────────────────────────────────────────────────────

/**
 * Corrections, decisions and audit events of the entry. Audit rows show their
 * action, change and reason the way the audit log page does; their note is
 * left out, as there: a person's note is already shown with its correction
 * or decision, and the rest is system text (e.g. the test-mode rewind's).
 */
export function HistoryCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tHistory = useTranslations("attendance.detail.history");
  const tAudit = useTranslations("auditLog");
  const label = useEnumLabel();
  const { corrections, approvals, auditEvents } = evidence.history;
  const auditReason = useAuditReason();
  const by = (name: string | null, time: string) => tHistory.rich("by", { name: name ?? tHistory("unknownActor"), time: () => <DateTimeText value={time} /> });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tHistory("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <section>
          <h3 className="font-semibold text-slate-900">{tHistory("corrections")}</h3>
          {corrections.length === 0 ? (
            <p className="mt-1 text-slate-500">{tHistory("noCorrections")}</p>
          ) : (
            <ol className="mt-2 space-y-3">
              {corrections.map((correction) => (
                <li key={correction.id} className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">
                    {tHistory.rich("change", {
                      field: () => <FieldName field={correction.field} />,
                      old: () => <ChangeValue field={correction.field} value={correction.oldValue} />,
                      new: () => <ChangeValue field={correction.field} value={correction.newValue} />,
                    })}
                  </p>
                  <p className="text-slate-700">
                    {tHistory("reason")}: {label("CorrectionReason", correction.reason)}
                  </p>
                  {correction.note ? (
                    <p className="text-slate-700" dir="auto">
                      {correction.note}
                    </p>
                  ) : null}
                  {correction.infraction ? (
                    <p className="mt-1 text-amber-900">
                      {tHistory.rich("infraction", {
                        number: correction.infraction.monthlySequenceNumber,
                        month: () => <MonthText yearMonth={correction.infraction!.businessMonth} />,
                      })}
                      {correction.infraction.reversedAt ? (
                        <span className="block text-emerald-800">
                          {tHistory("infractionReversed", { reason: correction.infraction.reversalReason ?? EM_DASH })}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">{by(correction.editedByName, correction.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h3 className="font-semibold text-slate-900">{tHistory("approvals")}</h3>
          {approvals.length === 0 ? (
            <p className="mt-1 text-slate-500">{tHistory("noApprovals")}</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {approvals.map((approval) => (
                <li key={approval.id} className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">{label("ApprovalAction", approval.action)}</p>
                  {approval.notes ? (
                    <p className="text-slate-700" dir="auto">
                      {approval.notes}
                    </p>
                  ) : null}
                  <p className="text-xs text-slate-500">{by(approval.actedByName, approval.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h3 className="font-semibold text-slate-900">{tHistory("audit")}</h3>
          {auditEvents.length === 0 ? (
            <p className="mt-1 text-slate-500">{tHistory("noAudit")}</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {auditEvents.map((event) => {
                const reason = event.reason ? auditReason(event.reason) : null;
                return (
                  <li key={event.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <p className="font-medium text-slate-900">
                      {tAudit.has(`actions.${event.action}`) ? (
                        tAudit(`actions.${event.action}`)
                      ) : (
                        <LtrText className="font-mono text-xs">{event.action}</LtrText>
                      )}
                    </p>
                    {event.field ? (
                      <p className="text-slate-700">
                        {tHistory.rich("change", {
                          field: () => <FieldName field={event.field!} />,
                          old: () => <ChangeValue field={event.field} value={event.oldValue} />,
                          new: () => <ChangeValue field={event.field} value={event.newValue} />,
                        })}
                      </p>
                    ) : null}
                    {reason ? (
                      <p className="text-slate-700" dir="auto">
                        {tHistory("reason")}: {reason}
                      </p>
                    ) : null}
                    <p className="text-xs text-slate-500">{by(event.actorName, event.createdAt)}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

// ── Owner only: estimated cost ─────────────────────────────────────────

/**
 * The entry's estimated cost, from the Owner-only `GET /time-entries/:id/estimated-cost`
 * (a separate response: the evidence itself never carries money). Only an
 * Owner's page renders this, so a Field Manager's browser never even asks.
 */
export function EntryCostCard({ timeEntryId }: { timeEntryId: string }) {
  const tCost = useTranslations("attendance.detail.cost");
  const { client } = useAuth();
  const costQuery = useQuery({ queryKey: ["time-entry-cost", timeEntryId], queryFn: () => client.getTimeEntryEstimatedCost(timeEntryId) });
  const cost = costQuery.data;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{tCost("title")}</CardTitle>
        <Badge tone="info">{tCost("ownerOnly")}</Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {costQuery.isPending ? <LoadingState /> : null}
        {costQuery.isError ? <ErrorState error={costQuery.error} onRetry={() => void costQuery.refetch()} /> : null}
        {cost ? (
          <>
            {cost.estimatedCostAgorot !== null ? (
              <dl>
                {cost.baseAgorot !== null ? (
                  <Row label={tCost("base")}>
                    <Money agorot={cost.baseAgorot} />
                  </Row>
                ) : null}
                {cost.overtimeAgorot !== null ? (
                  <Row label={tCost("overtime")}>
                    <Money agorot={cost.overtimeAgorot} />
                  </Row>
                ) : null}
                <Row label={tCost("total")}>
                  <Money agorot={cost.estimatedCostAgorot} className="text-base" />
                </Row>
              </dl>
            ) : null}
            <p className="text-xs text-slate-500">{tCost(`basis.${cost.basis}`)}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
