import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import type { EvidenceClockEvent, TimeEntryEvidence } from "@fieldmaster/api-client";
import { ClockEventType, EventOrigin } from "@fieldmaster/shared-types";
import { EM_DASH } from "@fieldmaster/i18n";
import { useEnumLabel, useFormat } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { Badge } from "../Badge";
import { isolateAuto } from "../LtrText";
import { ReviewCard } from "./ReviewCard";

/**
 * The evidence sections of the attendance review screen (the admin web's
 * attendance detail cards). None of them shows money.
 */

const LOCATION_COLORS: Record<string, string> = {
  PASSED: colors.success,
  FLAGGED: colors.warning,
  BLOCKED: colors.danger,
  UNAVAILABLE: colors.muted,
};

const TIME_FIELDS = new Set(["clockInAt", "clockOutAt"]);
const KNOWN_FIELDS = new Set(["clockInAt", "clockOutAt", "unpaidBreakMinutes", "fullDayCredit"]);

// ── Times ──────────────────────────────────────────────────────────────

/** Clock-in and clock-out: the validated time, and what the phone and the server recorded with the location check. */
export function TimesCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tTimes = useTranslations("review.times");
  const correctedFields = new Set(evidence.history.corrections.map((correction) => correction.field));
  const rows = [
    { type: ClockEventType.CLOCK_IN, field: "clockInAt", validatedAt: evidence.clockInAt },
    { type: ClockEventType.CLOCK_OUT, field: "clockOutAt", validatedAt: evidence.clockOutAt },
  ];
  return (
    <ReviewCard title={tTimes("title")} testID="times">
      <AppText size="small" color={colors.muted}>
        {tTimes("description")}
      </AppText>
      {rows.map((row) => (
        <EventEvidence
          key={row.type}
          type={row.type}
          event={evidence.clockEvents.find((event) => event.eventType === row.type)}
          validatedAt={row.validatedAt}
          corrected={correctedFields.has(row.field)}
        />
      ))}
    </ReviewCard>
  );
}

function EventEvidence({ type, event, validatedAt, corrected }: { type: string; event: EvidenceClockEvent | undefined; validatedAt: string | null; corrected: boolean }) {
  const tTimes = useTranslations("review.times");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const meters = (value: number | null) => format.number(value === null ? null : Math.round(value));
  return (
    <View style={styles.block} testID={`event-${type}`}>
      <View style={styles.titleRow}>
        <AppText weight="bold" style={styles.flexShrink}>
          {enumLabel("ClockEventType", type)}
        </AppText>
        {corrected ? <Badge label={tTimes("corrected")} color={colors.warning} /> : null}
      </View>
      <AppText weight="semibold">{tTimes("validated", { time: format.dateTime(validatedAt) })}</AppText>
      {event ? (
        <>
          <AppText size="small">{tTimes("device", { time: format.dateTime(event.deviceTimestamp) })}</AppText>
          <AppText size="small">{tTimes("server", { time: format.dateTime(event.serverReceivedAt) })}</AppText>
          <AppText size="small">{tTimes("deviation", { seconds: format.number(event.deviceTimeDeviationSeconds) })}</AppText>
          {event.origin === EventOrigin.OFFLINE ? (
            event.offlineSync ? (
              <>
                <AppText size="small">
                  {tTimes("offline", { status: enumLabel("OfflineSyncEventStatus", event.offlineSync.status), time: format.dateTime(event.offlineSync.syncedAt) })}
                </AppText>
                {event.offlineSync.duplicateSyncs > 0 ? (
                  <AppText size="small" color={colors.muted}>
                    {tTimes("duplicateSyncs", { count: event.offlineSync.duplicateSyncs })}
                  </AppText>
                ) : null}
              </>
            ) : (
              <AppText size="small">{tTimes("offlineNoSync")}</AppText>
            )
          ) : null}
          <View style={styles.titleRow}>
            <AppText size="small" style={styles.flexShrink}>
              {tTimes("location")}
            </AppText>
            <Badge label={enumLabel("LocationValidationStatus", event.locationValidationStatus)} color={LOCATION_COLORS[event.locationValidationStatus] ?? colors.muted} />
          </View>
          <AppText size="small">{tTimes("accuracy", { meters: meters(event.accuracyMeters) })}</AppText>
          {event.distanceFromSiteMeters !== null ? (
            <AppText size="small">
              {event.temporaryCheckInPoint
                ? tTimes("distanceFromPoint", { meters: meters(event.distanceFromSiteMeters) })
                : tTimes("distanceFromSite", { meters: meters(event.distanceFromSiteMeters) })}
            </AppText>
          ) : null}
          {event.temporaryCheckInPoint ? <AppText size="small">{tTimes("temporaryPoint", { name: isolateAuto(event.temporaryCheckInPoint.name) })}</AppText> : null}
          {event.mockLocationSuspected ? (
            <AppText size="small" weight="semibold" color={colors.danger}>
              {tTimes("mockLocation")}
            </AppText>
          ) : null}
        </>
      ) : (
        <AppText size="small" color={colors.muted}>
          {validatedAt ? tTimes("addedByCorrection") : tTimes("notYet")}
        </AppText>
      )}
    </View>
  );
}

// ── Duration and full-day credit ───────────────────────────────────────

/** Worked, regular and overtime minutes (as the API split them with the entry's day rules) and the full-day credit state. */
export function DurationCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tDuration = useTranslations("review.duration");
  const tc = useTranslations("common");
  const format = useFormat();
  const { duration, fullDayCredit, dayRules } = evidence;
  const basis =
    duration.basis === "APPROVED"
      ? tDuration("basisApproved")
      : duration.basis === "EXPECTED"
        ? tDuration("basisExpected", { threshold: format.minutes(dayRules.overtimeThresholdMinutes) })
        : tDuration("basisOpen");
  return (
    <ReviewCard title={tDuration("title")} testID="duration">
      <AppText>{tDuration("raw", { duration: format.minutes(duration.rawDurationMinutes) })}</AppText>
      <AppText>{tDuration("unpaidBreak", { duration: format.minutes(duration.unpaidBreakMinutes) })}</AppText>
      <AppText weight="semibold">{tDuration("worked", { duration: format.minutes(duration.workedMinutes) })}</AppText>
      <AppText>{tDuration("regular", { duration: format.minutes(duration.regularMinutes) })}</AppText>
      <AppText>{tDuration("overtime", { duration: format.minutes(duration.overtimeMinutes) })}</AppText>
      <AppText size="small" color={colors.muted}>
        {basis}
      </AppText>
      {duration.approvedSplitOutdated ? (
        <View style={styles.warning}>
          <AppText weight="semibold" color={colors.warning}>
            {tDuration("outdated")}
          </AppText>
        </View>
      ) : null}
      <View style={styles.block}>
        <AppText weight="semibold">{tc("creditAsFullDay")}</AppText>
        {fullDayCredit.applied ? (
          <>
            <AppText>{tDuration("fullDayCreditApplied", { reason: fullDayCredit.reason ? isolateAuto(fullDayCredit.reason) : EM_DASH })}</AppText>
            {fullDayCredit.appliedByName ? (
              <AppText size="small" color={colors.muted}>
                {tDuration("fullDayCreditBy", { name: isolateAuto(fullDayCredit.appliedByName), time: format.dateTime(fullDayCredit.appliedAt) })}
              </AppText>
            ) : null}
          </>
        ) : (
          <AppText>
            {fullDayCredit.eligible
              ? tDuration("fullDayCreditEligible", { standard: format.minutes(dayRules.standardDayMinutes) })
              : tDuration("fullDayCreditNotEligible")}
          </AppText>
        )}
      </View>
    </ReviewCard>
  );
}

// ── Emergency call-out ─────────────────────────────────────────────────

/** An emergency call-out's four times (the actual clicks and the compensated window) with both durations. */
export function EmergencyCard({ emergency }: { emergency: NonNullable<TimeEntryEvidence["emergency"]> }) {
  const tEmergency = useTranslations("review.emergency");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  return (
    <ReviewCard title={tc("emergencyCallout")} testID="emergency">
      <AppText>{tEmergency("authorization", { source: enumLabel("EmergencyAuthorizationSource", emergency.authorizationSource) })}</AppText>
      {emergency.authorizedByName ? (
        <AppText size="small" color={colors.muted}>
          {tEmergency("authorizedBy", { name: isolateAuto(emergency.authorizedByName) })}
        </AppText>
      ) : null}
      <AppText>{tEmergency("actualStart", { time: format.dateTime(emergency.actualStartClick) })}</AppText>
      <AppText>{tEmergency("compensatedStart", { duration: format.minutes(emergency.retroactiveMinutes), time: format.dateTime(emergency.compensatedStart) })}</AppText>
      {emergency.actualEndClick ? <AppText>{tEmergency("actualEnd", { time: format.dateTime(emergency.actualEndClick) })}</AppText> : null}
      {emergency.compensatedEnd && emergency.returnBufferMinutes !== null ? (
        <AppText>{tEmergency("compensatedEnd", { duration: format.minutes(emergency.returnBufferMinutes), time: format.dateTime(emergency.compensatedEnd) })}</AppText>
      ) : null}
      {emergency.actualWorkedMinutes !== null ? <AppText>{tEmergency("actualWorked", { duration: format.minutes(emergency.actualWorkedMinutes) })}</AppText> : null}
      {emergency.compensatedDurationMinutes !== null ? (
        <AppText weight="semibold">{tEmergency("totalCompensated", { duration: format.minutes(emergency.compensatedDurationMinutes) })}</AppText>
      ) : null}
      {emergency.actualEndClick ? null : <AppText color={colors.muted}>{tEmergency("notEnded")}</AppText>}
    </ReviewCard>
  );
}

// ── Daily summary ──────────────────────────────────────────────────────

/** The worker's daily summary: text, kind of work, problems, materials and whether it needs a follow-up. */
export function SummaryCard({ summary }: { summary: TimeEntryEvidence["dailySummary"] }) {
  const tSummary = useTranslations("review.summary");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  return (
    <ReviewCard title={tc("dailySummary")} testID="daily-summary">
      {summary ? (
        <>
          {summary.text ? <AppText>{isolateAuto(summary.text)}</AppText> : null}
          <AppText color={colors.muted}>{tSummary("category", { category: enumLabel("TaskCategory", summary.taskCategory) })}</AppText>
          {summary.problemsEncountered ? <AppText>{tSummary("problems", { text: isolateAuto(summary.problemsEncountered) })}</AppText> : null}
          {summary.materialsUsed ? <AppText>{tSummary("materials", { text: isolateAuto(summary.materialsUsed) })}</AppText> : null}
          {summary.followUpRequired ? (
            <AppText weight="semibold" color={colors.warning}>
              {tSummary("followUp")}
            </AppText>
          ) : (
            <AppText color={colors.muted}>{tSummary("noFollowUp")}</AppText>
          )}
          {summary.voiceNoteUrl ? <AppText color={colors.muted}>{tSummary("voiceNote")}</AppText> : null}
        </>
      ) : (
        <AppText color={colors.muted}>{tSummary("none")}</AppText>
      )}
    </ReviewCard>
  );
}

// ── History ────────────────────────────────────────────────────────────

/** Corrections (what changed, why, by whom) and decisions (approvals, rejections, correction requests). */
export function HistoryCard({ history }: { history: TimeEntryEvidence["history"] }) {
  const tHistory = useTranslations("review.history");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const by = (name: string | null, time: string) => tHistory("by", { name: name ? isolateAuto(name) : tHistory("unknownActor"), time: format.dateTime(time) });
  return (
    <ReviewCard title={tHistory("title")} testID="history">
      <AppText weight="bold">{tHistory("corrections")}</AppText>
      {history.corrections.length === 0 ? <AppText color={colors.muted}>{tHistory("noCorrections")}</AppText> : null}
      {history.corrections.map((correction) => (
        <View key={correction.id} style={styles.item}>
          <AppText weight="semibold">{tHistory(`fields.${KNOWN_FIELDS.has(correction.field) ? correction.field : "other"}`)}</AppText>
          <ChangeText field={correction.field} oldValue={correction.oldValue} newValue={correction.newValue} />
          <AppText>{tHistory("reason", { reason: enumLabel("CorrectionReason", correction.reason) })}</AppText>
          {correction.note ? <AppText>{tHistory("note", { note: isolateAuto(correction.note) })}</AppText> : null}
          {correction.infraction ? (
            <AppText color={colors.warning}>
              {tHistory("infraction", { number: format.number(correction.infraction.monthlySequenceNumber), month: format.month(correction.infraction.businessMonth) })}
            </AppText>
          ) : null}
          {correction.infraction?.reversedAt ? (
            <AppText color={colors.success}>
              {tHistory("infractionReversed", { reason: correction.infraction.reversalReason ? isolateAuto(correction.infraction.reversalReason) : EM_DASH })}
            </AppText>
          ) : null}
          <AppText size="small" color={colors.muted}>
            {by(correction.editedByName, correction.createdAt)}
          </AppText>
        </View>
      ))}

      <AppText weight="bold" style={styles.subheading}>
        {tHistory("approvals")}
      </AppText>
      {history.approvals.length === 0 ? <AppText color={colors.muted}>{tHistory("noApprovals")}</AppText> : null}
      {history.approvals.map((approval) => (
        <View key={approval.id} style={styles.item}>
          <AppText weight="semibold">{enumLabel("ApprovalAction", approval.action)}</AppText>
          {approval.notes ? <AppText>{isolateAuto(approval.notes)}</AppText> : null}
          <AppText size="small" color={colors.muted}>
            {by(approval.actedByName, approval.createdAt)}
          </AppText>
        </View>
      ))}
    </ReviewCard>
  );
}

/** A corrected value: a time for the clock fields, minutes for the break, yes/no for the full-day credit, the text otherwise. */
function ChangeText({ field, oldValue, newValue }: { field: string; oldValue: string | null; newValue: string | null }) {
  const tHistory = useTranslations("review.history");
  const tc = useTranslations("common");
  const format = useFormat();
  const value = (raw: string | null) => {
    if (raw === null || raw === "") return tHistory("noValue");
    if (TIME_FIELDS.has(field)) return format.dateTime(raw);
    if (field === "unpaidBreakMinutes" && /^\d+$/.test(raw)) return format.minutes(Number(raw));
    if (field === "fullDayCredit") return raw === "true" ? tc("yes") : tc("no");
    return isolateAuto(raw);
  };
  return (
    <AppText>
      {oldValue === null || oldValue === "" ? tHistory("set", { new: value(newValue) }) : tHistory("change", { old: value(oldValue), new: value(newValue) })}
    </AppText>
  );
}

const styles = StyleSheet.create({
  block: { gap: 2, paddingTop: spacing.sm, marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  warning: { backgroundColor: colors.warningSoft, borderRadius: 12, padding: spacing.md },
  item: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  subheading: { marginTop: spacing.sm },
});
