import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { ClockEvent, MyEntryPay, MyTimeEntryCorrection, MyTimeEntryDetail } from "@fieldmaster/api-client";
import { isForbidden, isNotFound } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "HistoryDetail">;

type DetailClockEvent = ClockEvent;

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: colors.primary,
  PENDING_APPROVAL: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.danger,
  CORRECTION_REQUESTED: colors.warning,
};

const LOCATION_COLORS: Record<string, string> = {
  PASSED: colors.success,
  FLAGGED: colors.warning,
  BLOCKED: colors.danger,
  UNAVAILABLE: colors.muted,
};

const TIME_FIELDS = new Set(["clockInAt", "clockOutAt"]);

/** The pay part: not loaded yet, loaded, not available (not approved), or failed. */
type PayState = { status: "idle" | "loading" } | { status: "loaded"; pay: MyEntryPay } | { status: "failed"; cause: unknown };

/**
 * One of the worker's own entries: clock-in/out times (as validated, with
 * the phone's time and when the server received it), the location result of
 * each event, corrections with their reasons and notes, the daily summary,
 * the photo count, and, once approved, the worker's own pay for it
 * ("نهائي" when the month is finalized, "تقدير" otherwise).
 */
export function HistoryDetailScreen({ navigation, route }: Props) {
  const { timeEntryId } = route.params;
  const t = useTranslations("history.detail");
  const tHistory = useTranslations("history");
  const tc = useTranslations("common");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client, session } = useAuth();
  const ownWorkerProfileId = session?.workerProfileId ?? null;

  const [entry, setEntry] = useState<MyTimeEntryDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pay, setPay] = useState<PayState>({ status: "idle" });

  const loadPay = useCallback(async () => {
    setPay({ status: "loading" });
    try {
      setPay({ status: "loaded", pay: await client.getMyEntryPay(timeEntryId) });
    } catch (cause) {
      setPay({ status: "failed", cause });
    }
  }, [client, timeEntryId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await client.getMyTimeEntry(timeEntryId);
      // Only the caller's own entry is shown (the API refuses others; this never shows one by mistake).
      if (ownWorkerProfileId && detail.workerProfileId !== ownWorkerProfileId) {
        setEntry(null);
        setNotFound(true);
        return;
      }
      setNotFound(false);
      setEntry(detail);
      if (detail.status === "APPROVED") void loadPay();
      else setPay({ status: "idle" });
    } catch (cause) {
      if (isNotFound(cause) || isForbidden(cause)) {
        setEntry(null);
        setNotFound(true);
      } else {
        setError(cause ?? new Error());
      }
    } finally {
      setRefreshing(false);
    }
  }, [client, loadPay, ownWorkerProfileId, timeEntryId]);

  useEffect(() => {
    void load();
  }, [load]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;
  const banner = <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />;

  if (!entry && !error && !notFound) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        <LoadingView />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      {banner}
      <ScrollView
        testID="history-detail"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRefresh} /> : null}
        {notFound ? (
          <View style={styles.notice} accessible accessibilityRole="alert">
            <AppText weight="semibold" color={colors.danger}>
              {t("notFound")}
            </AppText>
          </View>
        ) : null}
        {entry ? (
          <>
            <Section>
              <View style={styles.titleRow}>
                <AppText accessibilityRole="header" weight="bold" size="title" style={styles.flexShrink}>
                  {isolateAuto(shiftTitle(entry.shift))}
                </AppText>
                <Badge label={enumLabel("TimeEntryStatus", entry.status)} color={STATUS_COLORS[entry.status] ?? colors.muted} />
              </View>
              <AppText>{format.businessDate(entry.businessDate)}</AppText>
              {entry.status === "REJECTED" && entry.rejectedReason ? (
                <AppText weight="semibold" color={colors.danger}>
                  {t("rejectedReason", { reason: isolateAuto(entry.rejectedReason) })}
                </AppText>
              ) : null}
            </Section>

            <Section title={t("times")}>
              <ClockLine label={t("clockIn", { time: format.dateTime(entry.clockInAt) })} event={eventOf(entry, "CLOCK_IN")} />
              {entry.clockOutAt ? (
                <ClockLine label={t("clockOut", { time: format.dateTime(entry.clockOutAt) })} event={eventOf(entry, "CLOCK_OUT")} />
              ) : (
                <AppText color={colors.muted}>{t("notClockedOut")}</AppText>
              )}
              {entry.rawDurationMinutes !== null ? (
                <AppText weight="semibold">{tHistory("worked", { duration: format.minutes(entry.rawDurationMinutes) })}</AppText>
              ) : null}
              {entry.approvedRegularMinutes !== null ? <AppText>{t("approvedRegular", { duration: format.minutes(entry.approvedRegularMinutes) })}</AppText> : null}
              {entry.approvedOvertimeMinutes !== null ? <AppText>{t("approvedOvertime", { duration: format.minutes(entry.approvedOvertimeMinutes) })}</AppText> : null}
              {entry.fullDayCredit ? <AppText weight="semibold">{t("fullDayCredit")}</AppText> : null}
            </Section>

            <Section title={t("location")}>
              {(["CLOCK_IN", "CLOCK_OUT"] as const).map((type) => {
                const event = eventOf(entry, type);
                return event ? <LocationResult key={type} event={event} /> : null;
              })}
            </Section>

            <Section title={t("corrections")}>
              {entry.corrections.length === 0 ? (
                <AppText color={colors.muted}>{t("noCorrections")}</AppText>
              ) : (
                entry.corrections.map((correction, index) => <Correction key={`${correction.field}-${correction.correctedAt}-${index}`} correction={correction} />)
              )}
            </Section>

            <Section title={tc("dailySummary")}>
              {entry.summary ? (
                <>
                  {entry.summary.text ? <AppText>{isolateAuto(entry.summary.text)}</AppText> : null}
                  <AppText color={colors.muted}>{t("taskCategory", { category: enumLabel("TaskCategory", entry.summary.taskCategory) })}</AppText>
                  {entry.summary.summarySource ? <AppText color={colors.muted}>{enumLabel("SummarySource", entry.summary.summarySource)}</AppText> : null}
                  {entry.summary.hasVoiceNote ? <AppText>{t("voiceNote")}</AppText> : null}
                  {entry.summary.followUpRequired ? (
                    <AppText weight="semibold" color={colors.warning}>
                      {t("followUp")}
                    </AppText>
                  ) : null}
                </>
              ) : (
                <AppText color={colors.muted}>{t("noSummary")}</AppText>
              )}
              <AppText>{t("photos", { count: format.number(entry.photoCount ?? 0) })}</AppText>
            </Section>

            <Section title={t("pay")}>
              <PayPart entryStatus={entry.status} pay={pay} onRetry={() => void loadPay()} />
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function eventOf(entry: MyTimeEntryDetail, type: "CLOCK_IN" | "CLOCK_OUT"): DetailClockEvent | null {
  const events = (entry.clockEvents ?? []).filter((event) => event.eventType === type);
  // The latest one (a corrected entry may have several).
  return (events[events.length - 1] as DetailClockEvent | undefined) ?? null;
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? (
        <AppText accessibilityRole="header" weight="bold" size="large">
          {title}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

function ClockLine({ label, event }: { label: string; event: DetailClockEvent | null }) {
  const t = useTranslations("history.detail");
  const format = useFormat();
  return (
    <View style={styles.clockLine}>
      <AppText weight="semibold">{label}</AppText>
      {event ? (
        <>
          <AppText size="small" color={colors.muted}>
            {t("deviceTime", { time: format.dateTime(event.deviceTimestamp) })}
          </AppText>
          <AppText size="small" color={colors.muted}>
            {t("serverTime", { time: format.dateTime(event.serverReceivedAt) })}
          </AppText>
          {event.origin === "OFFLINE" ? (
            <AppText size="small" color={colors.muted}>
              {t("offline")}
            </AppText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function LocationResult({ event }: { event: DetailClockEvent }) {
  const t = useTranslations("history.detail");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const status = event.locationValidationStatus;
  const resultKey = ["PASSED", "FLAGGED", "BLOCKED", "UNAVAILABLE"].includes(status) ? status : "UNAVAILABLE";
  // Step 9 events carry what the phone could tell; older ones only the server's flag.
  const mockState = event.mockLocationState ?? (event.mockLocationSuspected ? "DETECTED" : null);
  return (
    <View style={styles.clockLine}>
      <View style={styles.titleRow}>
        <AppText weight="semibold" style={styles.flexShrink}>
          {enumLabel("ClockEventType", event.eventType)}
        </AppText>
        <Badge label={t(`locationResult.${resultKey}`)} color={LOCATION_COLORS[resultKey] ?? colors.muted} />
      </View>
      {event.distanceFromSiteMeters !== null && event.distanceFromSiteMeters !== undefined ? (
        <AppText>{t("distance", { meters: format.number(Math.round(event.distanceFromSiteMeters)) })}</AppText>
      ) : null}
      <AppText>{t("accuracy", { meters: format.number(Math.round(event.accuracyMeters)) })}</AppText>
      {mockState ? <AppText>{t("mockLocation", { state: enumLabel("MockLocationState", mockState) })}</AppText> : null}
    </View>
  );
}

function Correction({ correction }: { correction: MyTimeEntryCorrection }) {
  const t = useTranslations("history.detail");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const field = ["clockInAt", "clockOutAt", "unpaidBreakMinutes"].includes(correction.field) ? correction.field : "other";
  const value = (raw: string | null) => {
    if (raw === null) return null;
    if (TIME_FIELDS.has(correction.field)) return format.dateTime(raw);
    if (correction.field === "unpaidBreakMinutes" && /^\d+$/.test(raw)) return format.minutes(Number(raw));
    return isolateAuto(raw);
  };
  const oldValue = value(correction.oldValue);
  const newValue = value(correction.newValue) ?? "";
  return (
    <View style={styles.correction}>
      <AppText weight="semibold">{t(`correctionField.${field}`)}</AppText>
      <AppText>{oldValue !== null ? t("correctionChange", { old: oldValue, new: newValue }) : t("correctionSet", { new: newValue })}</AppText>
      <AppText>{t("correctionReason", { reason: enumLabel("CorrectionReason", correction.reason) })}</AppText>
      {correction.note ? <AppText>{t("correctionNote", { note: isolateAuto(correction.note) })}</AppText> : null}
      <AppText size="small" color={colors.muted}>
        {correction.correctedByName
          ? t("correctionBy", { name: isolateAuto(correction.correctedByName), time: format.dateTime(correction.correctedAt) })
          : t("correctionAt", { time: format.dateTime(correction.correctedAt) })}
      </AppText>
    </View>
  );
}

function PayPart({ entryStatus, pay, onRetry }: { entryStatus: string; pay: PayState; onRetry: () => void }) {
  const t = useTranslations("history.detail");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const money = (agorot: number | null) => isolateLtr(format.money(agorot));

  if (entryStatus !== "APPROVED") return <AppText color={colors.muted}>{t("payPending")}</AppText>;
  if (pay.status === "failed") return <ErrorView message={`${t("payLoadError")}\n${errorMessage(pay.cause)}`} onRetry={onRetry} />;
  if (pay.status !== "loaded") return <LoadingView />;
  const { pay: value } = pay;
  if (!value.approved || value.totalAgorot === null) return <AppText color={colors.muted}>{t("payPending")}</AppText>;
  return (
    <View style={styles.pay}>
      <View style={styles.titleRow}>
        <AppText weight="bold" size="large" style={styles.flexShrink}>
          {t("payTotal", { amount: money(value.totalAgorot) })}
        </AppText>
        <Badge label={value.finalized ? t("payFinal") : t("payEstimate")} color={value.finalized ? colors.success : colors.warning} />
      </View>
      <AppText size="small" color={colors.muted}>
        {value.finalized ? t("payFinalHint") : t("payEstimateHint")}
      </AppText>
      <AppText>{t("payBase", { amount: money(value.baseAgorot) })}</AppText>
      <AppText>{t("payOvertime", { amount: money(value.overtimeAgorot) })}</AppText>
      <AppText>{t("payRegularMinutes", { duration: format.minutes(value.regularMinutes) })}</AppText>
      <AppText>{t("payOvertimeMinutes", { duration: format.minutes(value.overtimeMinutes) })}</AppText>
      {value.compensatedMinutes !== null ? <AppText>{t("payCompensated", { duration: format.minutes(value.compensatedMinutes) })}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.md },
  section: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  clockLine: { gap: 2, paddingVertical: spacing.xs },
  correction: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  pay: { gap: spacing.xs },
  notice: { backgroundColor: colors.dangerSoft, borderRadius: 12, padding: spacing.md },
});
