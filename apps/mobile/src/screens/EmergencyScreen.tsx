import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { EmergencyCalloutEndResult, EmergencyEligibility } from "@fieldmaster/api-client";
import { EMERGENCY_RETROACTIVE_MINUTES, EMERGENCY_RETURN_BUFFER_MINUTES, TaskCategory } from "@fieldmaster/shared-types";
import { getErrorCode, isNetworkError } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { AppTextInput } from "../components/AppTextInput";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView, LoadingView } from "../components/StateViews";
import { TaskCategoryPicker } from "../components/TaskCategoryPicker";
import { useCodeMessage, useErrorMessage, useFormat } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { getDeviceId } from "../lib/device-id";
import { formatElapsed, useNow } from "../lib/elapsed";
import { readLocation, type LocationFailure, type LocationReading } from "../lib/location";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Emergency">;

type Step = "idle" | "locating" | "starting" | "ending";
type Failure = LocationFailure | { kind: "summary" } | { kind: "request"; cause: unknown };

/** A running call-out: the two start times the server recorded. */
interface Running {
  actualStartClick: string;
  compensatedStart: string;
}

type Ended = EmergencyCalloutEndResult & Running;

/** The location fields the emergency start / end endpoints take (nothing else: the API refuses unknown fields). */
function emergencyLocation(reading: LocationReading) {
  return { latitude: reading.latitude, longitude: reading.longitude, accuracyMeters: reading.accuracy ?? 9999 };
}

async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch {
    // The message on screen already says what to do.
  }
}

function Line({ label, value, badge, testID }: { label: string; value: string; badge?: ReactNode; testID: string }) {
  return (
    <View style={styles.line} testID={testID}>
      <View style={styles.lineLabel}>
        <AppText color={colors.muted}>{label}</AppText>
        {badge}
      </View>
      <AppText weight="semibold">{value}</AppText>
    </View>
  );
}

/**
 * The Night Turan emergency call-out. Whether it can start, and every time
 * and duration, come from the API: it starts paying 60 minutes before the
 * press and adds 15 minutes for the way back after the end, and the screen
 * says so in plain Arabic before each step. Ending needs a summary.
 */
export function EmergencyScreen({ navigation }: Props) {
  const t = useTranslations("emergency");
  const tLocation = useTranslations("location");
  const tc = useTranslations("common");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const { client } = useAuth();
  const { isOnline } = useOfflineSync();

  const [eligibility, setEligibility] = useState<EmergencyEligibility | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState("");
  const [taskCategory, setTaskCategory] = useState<string>(TaskCategory.EMERGENCY_REPAIR);
  const [step, setStep] = useState<Step>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const inFlight = useRef(false);
  const busy = step !== "idle";
  const now = useNow(1000, running !== null && ended === null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await client.getEmergencyEligibility();
      setEligibility(result);
      setRunning(result.activeCallout ? { actualStartClick: result.activeCallout.actualStartClick, compensatedStart: result.activeCallout.compensatedStart } : null);
    } catch (cause) {
      setLoadError(cause ?? new Error());
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  /** Locates, then runs `send` with the reading; the location problem or the API error is shown otherwise. */
  async function withLocation(sending: Step, send: (reading: LocationReading, deviceId: string) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    setStep("locating");
    try {
      const location = await readLocation();
      if (!location.ok) {
        setFailure(location.failure);
        return;
      }
      setStep(sending);
      await send(location.reading, await getDeviceId());
    } catch (cause) {
      setFailure(getErrorCode(cause) === "SUMMARY_REQUIRED" ? { kind: "summary" } : { kind: "request", cause });
    } finally {
      inFlight.current = false;
      setStep("idle");
    }
  }

  function start() {
    return withLocation("starting", async (reading, deviceId) => {
      const key = `emergency-start-${Date.now()}`;
      const turanAssignmentId = eligibility?.turanAssignment?.id;
      const result = await client.startEmergencyCallout(
        {
          ...(turanAssignmentId ? { turanAssignmentId } : {}),
          deviceId,
          clientEventId: key,
          deviceTimestamp: new Date().toISOString(),
          ...emergencyLocation(reading),
        },
        key,
      );
      setRunning({ actualStartClick: result.actualStartClick, compensatedStart: result.compensatedStart });
      setConfirming(false);
    });
  }

  function end() {
    if (!running || inFlight.current) return;
    if (summary.trim().length === 0) {
      setFailure({ kind: "summary" });
      return;
    }
    return withLocation("ending", async (reading, deviceId) => {
      const key = `emergency-end-${Date.now()}`;
      const result = await client.endEmergencyCallout(
        {
          deviceId,
          clientEventId: key,
          deviceTimestamp: new Date().toISOString(),
          ...emergencyLocation(reading),
          summaryText: summary.trim(),
          taskCategory,
        },
        key,
      );
      setEnded({ ...result, ...running });
    });
  }

  function failureMessage(current: Failure): string | null {
    switch (current.kind) {
      case "summary":
        return null;
      case "permission":
        return current.canAskAgain ? tLocation("actionPermissionDenied") : tLocation("actionPermissionSettings");
      case "servicesOff":
        return tLocation("servicesOff");
      case "location":
        return tLocation("actionUnavailable");
      case "request":
        return isNetworkError(current.cause) ? t("offline") : errorMessage(current.cause);
    }
  }

  const goHome = () => navigation.popTo("Home");
  const header = <ScreenHeader title={t("title")} onBack={busy ? undefined : () => navigation.goBack()} />;
  const banner = <ConnectionBanner disabled={busy} onPress={() => navigation.navigate("OfflineQueue")} />;
  const failureText = failure ? failureMessage(failure) : null;
  const failureViews = (
    <>
      {failureText ? <ErrorView message={failureText} /> : null}
      {failure?.kind === "permission" && !failure.canAskAgain ? (
        <View style={styles.padded}>
          <Button label={tLocation("openSettings")} variant="secondary" onPress={openAppSettings} />
        </View>
      ) : null}
    </>
  );
  const busyLabel = step === "starting" ? t("starting") : step === "ending" ? t("ending") : t("locating");
  // "+60" / "+15" keep their sign on the left inside the Arabic text (a left-to-right isolate, like phone numbers).
  const retroBadgeFor = (minutes: number) => <Badge label={t("retroBadge", { amount: isolateLtr(`+${minutes}`) })} color={colors.warning} />;
  const returnBadgeFor = (minutes: number) => <Badge label={t("returnBadge", { amount: isolateLtr(`+${minutes}`) })} color={colors.warning} />;
  const retroBadge = retroBadgeFor(EMERGENCY_RETROACTIVE_MINUTES);
  const returnBadge = returnBadgeFor(EMERGENCY_RETURN_BUFFER_MINUTES);

  // ── Ended: the breakdown from the server's answer ─────────────────────────
  if (ended) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {header}
          <View style={[styles.card, styles.successCard]} testID="emergency-ended" aria-live="polite">
            <AppText accessibilityRole="header" size="title" weight="bold" color={colors.success}>
              {t("endedTitle")}
            </AppText>
            <AppText weight="bold" size="large">
              {t("breakdownTitle")}
            </AppText>
            <Line testID="emergency-actual-start" label={t("actualStart")} value={format.dateTime(ended.actualStartClick)} />
            <Line
              testID="emergency-compensated-start"
              label={t("compensatedStart")}
              value={format.dateTime(ended.compensatedStart)}
              badge={retroBadgeFor(ended.retroactiveMinutes)}
            />
            <Line testID="emergency-actual-end" label={t("actualEnd")} value={format.dateTime(ended.actualEndClick)} />
            <Line
              testID="emergency-compensated-end"
              label={t("compensatedEnd")}
              value={format.dateTime(ended.compensatedEnd)}
              badge={returnBadgeFor(ended.returnBufferMinutes)}
            />
            <Line testID="emergency-actual-worked" label={t("actualWorked")} value={format.minutes(ended.actualWorkedMinutes)} />
            <Line testID="emergency-compensated-total" label={t("compensatedTotal")} value={format.minutes(ended.compensatedDurationMinutes)} />
            <AppText>{t("pendingApproval")}</AppText>
          </View>
          <View style={styles.padded}>
            <Button testID="emergency-done" label={t("backHome")} onPress={goHome} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Loading / error ───────────────────────────────────────────────────────
  if (!eligibility) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        {loadError ? <ErrorView message={`${t("loadError")}\n${errorMessage(loadError)}`} onRetry={load} /> : <LoadingView />}
      </SafeAreaView>
    );
  }

  // ── Running: live timer, and the end with a mandatory summary ─────────────
  if (running) {
    const summaryMissing = failure?.kind === "summary";
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {header}
          {banner}
          <View style={[styles.card, styles.runningCard]} testID="emergency-running">
            <AppText weight="bold" size="large" color={colors.danger}>
              {t("running")}
            </AppText>
            <AppText color={colors.muted}>{t("elapsed")}</AppText>
            <AppText testID="emergency-timer" size="hero" weight="bold" accessibilityRole="timer">
              {formatElapsed(now - Date.parse(running.actualStartClick))}
            </AppText>
            <AppText>{t("startedAt", { time: format.dateTime(running.actualStartClick) })}</AppText>
            <View style={styles.badgeRow}>
              <AppText>{t("compensatedFrom", { time: format.dateTime(running.compensatedStart) })}</AppText>
              {retroBadge}
            </View>
          </View>

          <View style={styles.section}>
            <AppText accessibilityRole="header" weight="bold" size="large">
              {t("endTitle")}
            </AppText>
            <View style={styles.badgeRow}>
              {returnBadge}
              <AppText>{t("endBody", { minutes: EMERGENCY_RETURN_BUFFER_MINUTES })}</AppText>
            </View>
            <AppText weight="semibold" style={styles.label}>
              {t("categoryLabel")}
            </AppText>
            <TaskCategoryPicker label={t("categoryLabel")} value={taskCategory} onChange={setTaskCategory} disabled={busy} />
            <AppText weight="semibold" style={styles.label}>
              {t("summaryLabel")}
            </AppText>
            <AppTextInput
              testID="emergency-summary"
              accessibilityLabel={t("summaryLabel")}
              multiline
              numberOfLines={4}
              placeholder={t("summaryPlaceholder")}
              value={summary}
              onChangeText={(text) => {
                setSummary(text);
                if (summaryMissing && text.trim().length > 0) setFailure(null);
              }}
              editable={!busy}
              style={summaryMissing ? styles.inputInvalid : null}
            />
            {summaryMissing ? (
              <AppText testID="emergency-summary-error" accessibilityRole="alert" weight="semibold" color={colors.danger}>
                {t("summaryRequired")}
              </AppText>
            ) : null}
          </View>

          {failureViews}
          {!isOnline ? (
            <AppText style={styles.padded} color={colors.warning} weight="semibold">
              {t("offline")}
            </AppText>
          ) : null}
          <View style={styles.padded}>
            <Button testID="emergency-end" label={t("end")} variant="danger" busy={busy} busyLabel={busyLabel} disabled={!isOnline} onPress={end} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Not running: eligible or not ──────────────────────────────────────────
  const turan = eligibility.turanAssignment;
  const ineligibleText =
    eligibility.reason === "ACTIVE_TIME_ENTRY_EXISTS"
      ? t("activeEntryExists")
      : eligibility.reason && eligibility.reason !== "EMERGENCY_NOT_ELIGIBLE"
        ? (codeMessage(eligibility.reason) ?? t("notEligible"))
        : t("notEligible");

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {header}
        {banner}
        {eligibility.eligible ? (
          <View style={styles.section} testID="emergency-eligible">
            <AppText weight="semibold" size="large">
              {t("eligible")}
            </AppText>
            {turan ? <AppText>{t("turan", { start: format.dateTime(turan.startAt), end: format.dateTime(turan.endAt) })}</AppText> : null}

            {confirming ? (
              <View style={[styles.card, styles.confirmCard]} testID="emergency-confirm" accessibilityRole="alert">
                <AppText accessibilityRole="header" weight="bold" size="large">
                  {t("confirmTitle")}
                </AppText>
                {retroBadge}
                <AppText>{t("confirmBody", { minutes: EMERGENCY_RETROACTIVE_MINUTES })}</AppText>
                {failureViews}
                {!isOnline ? (
                  <AppText color={colors.warning} weight="semibold">
                    {t("offline")}
                  </AppText>
                ) : null}
                <Button testID="emergency-confirm-start" label={t("confirmYes")} variant="danger" busy={busy} busyLabel={busyLabel} disabled={!isOnline} onPress={start} />
                <Button label={tc("cancel")} variant="secondary" disabled={busy} onPress={() => setConfirming(false)} />
              </View>
            ) : (
              <>
                <View style={styles.badgeRow}>
                  {retroBadge}
                  <AppText>{t("confirmBody", { minutes: EMERGENCY_RETROACTIVE_MINUTES })}</AppText>
                </View>
                {!isOnline ? (
                  <AppText color={colors.warning} weight="semibold">
                    {t("offline")}
                  </AppText>
                ) : null}
                <Button testID="emergency-start" label={t("start")} variant="danger" disabled={!isOnline} onPress={() => setConfirming(true)} />
              </>
            )}
          </View>
        ) : (
          <View style={styles.section} testID="emergency-not-eligible">
            <AppText weight="semibold" size="large">
              {ineligibleText}
            </AppText>
            {turan ? <AppText color={colors.muted}>{t("turan", { start: format.dateTime(turan.startAt), end: format.dateTime(turan.endAt) })}</AppText> : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingBottom: spacing.xl },
  padded: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  section: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.md },
  card: { marginHorizontal: spacing.xl, marginBottom: spacing.lg, borderRadius: 16, padding: spacing.lg, gap: spacing.sm },
  successCard: { backgroundColor: colors.successSoft },
  runningCard: { backgroundColor: colors.dangerSoft },
  confirmCard: { marginHorizontal: 0, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  line: { gap: 2, paddingVertical: spacing.xs },
  lineLabel: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  label: { marginTop: spacing.sm },
  inputInvalid: { borderColor: colors.danger, borderWidth: 2 },
});
