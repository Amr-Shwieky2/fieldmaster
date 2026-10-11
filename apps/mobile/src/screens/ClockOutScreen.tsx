import { useRef, useState, type ComponentRef } from "react";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { NetworkError } from "@fieldmaster/api-client";
import { TaskCategory, TimeEntryStatus } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { AppTextInput } from "../components/AppTextInput";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import { getDeviceId } from "../lib/device-id";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ClockOut">;

type Step = "idle" | "locating" | "submitting";

/**
 * Why the last attempt failed. The API error itself is kept and turned into Arabic at render time.
 * `canAskAgain: false` means the phone no longer shows the permission prompt: only the settings can fix it.
 */
type Failure =
  | { kind: "summary" }
  | { kind: "permission"; canAskAgain: boolean }
  | { kind: "servicesOff" }
  | { kind: "location" }
  | { kind: "request"; cause: unknown };

/** What happened: clocked out on the server, or saved on the phone to sync later. `at` is an ISO instant. */
type Receipt =
  | { kind: "success"; at: string; durationMinutes: number | null; pendingApproval: boolean }
  | { kind: "queued"; at: string };

const TASK_CATEGORIES = Object.values(TaskCategory);

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** The receipt for the server's answer (the updated time entry): its clock-out time, duration and approval status. */
function successReceipt(result: unknown, deviceTimestamp: string): Receipt {
  const entry = (typeof result === "object" && result !== null ? result : {}) as {
    clockOutAt?: unknown;
    rawDurationMinutes?: unknown;
    status?: unknown;
  };
  const duration = entry.rawDurationMinutes;
  return {
    kind: "success",
    at: isInstant(entry.clockOutAt) ? entry.clockOutAt : deviceTimestamp,
    durationMinutes: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
    // A clock-out always waits for a manager's approval; only a different status from the server hides the note.
    pendingApproval: entry.status === undefined || entry.status === null || entry.status === TimeEntryStatus.PENDING_APPROVAL,
  };
}

/** True only when the phone reports that its location services (GPS) are switched off. */
async function locationServicesOff(): Promise<boolean> {
  try {
    return (await Location.hasServicesEnabledAsync()) === false;
  } catch {
    return false;
  }
}

/** The app's page in the phone settings, where a permanently refused location permission is turned back on. */
async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing else to offer: the message on screen already says what to do.
  }
}

export function ClockOutScreen({ navigation }: Props) {
  const t = useTranslations("clockOut");
  const tc = useTranslations("common");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { queueOfflineEvent } = useOfflineSync();
  const [taskCategory, setTaskCategory] = useState<string>(TaskCategory.OTHER);
  const [summaryText, setSummaryText] = useState("");
  const [problemsEncountered, setProblemsEncountered] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const summaryInput = useRef<ComponentRef<typeof AppTextInput>>(null);
  const inFlight = useRef(false);
  const busy = step !== "idle";

  function handleSummaryChange(text: string) {
    setSummaryText(text);
    if (failure?.kind === "summary" && text.trim().length > 0) setFailure(null);
  }

  async function handleClockOut() {
    if (inFlight.current) return;
    if (summaryText.trim().length === 0) {
      setFailure({ kind: "summary" });
      summaryInput.current?.focus();
      return;
    }
    inFlight.current = true;
    setFailure(null);
    setStep("locating");
    try {
      let position: Location.LocationObject;
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          // iOS answers "denied" while location services are off for the whole phone.
          setFailure((await locationServicesOff()) ? { kind: "servicesOff" } : { kind: "permission", canAskAgain: permission.canAskAgain !== false });
          return;
        }
        position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      } catch {
        // GPS switched off (Android rejects) versus a timeout or a weak signal.
        setFailure((await locationServicesOff()) ? { kind: "servicesOff" } : { kind: "location" });
        return;
      }
      setStep("submitting");

      const deviceId = await getDeviceId();
      const idempotencyKey = `clockout-${Date.now()}`;
      const deviceTimestamp = new Date().toISOString();
      const locationFields = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? 9999,
        altitude: position.coords.altitude ?? undefined,
        locationProvider: "expo-location",
        mockLocationSuspected: position.mocked ?? false,
      };
      const summaryFields = {
        summaryText: summaryText.trim(),
        taskCategory,
        problemsEncountered: problemsEncountered.trim() || undefined,
      };

      try {
        const result = await client.clockOut(
          { deviceId, clientEventId: idempotencyKey, deviceTimestamp, ...locationFields, origin: "ONLINE", ...summaryFields },
          idempotencyKey,
        );
        setReceipt(successReceipt(result, deviceTimestamp));
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        // No connectivity: the mandatory summary was already captured
        // above, so clock-out can still queue locally like clock-in does.
        await queueOfflineEvent({
          clientEventId: idempotencyKey,
          eventType: "CLOCK_OUT",
          deviceTimestamp,
          ...locationFields,
          ...summaryFields,
        });
        setReceipt({ kind: "queued", at: deviceTimestamp });
      }
    } catch (err) {
      setFailure({ kind: "request", cause: err });
    } finally {
      inFlight.current = false;
      setStep("idle");
    }
  }

  // Back to the Home screen already in the stack (it reloads on focus), not a second copy of it.
  const goHome = () => navigation.popTo("Home");

  if (receipt) {
    const queued = receipt.kind === "queued";
    const time = format.time(receipt.at);
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.receiptScroll}>
          <View
            aria-live="polite"
            style={[styles.receipt, { backgroundColor: queued ? colors.warningSoft : colors.successSoft }]}
          >
            <AppText accessibilityRole="header" size="title" weight="bold" color={queued ? colors.warning : colors.success}>
              {queued ? t("queuedTitle") : t("successTitle")}
            </AppText>
            {receipt.kind === "queued" ? (
              <>
                <AppText size="large">{t("queuedBody")}</AppText>
                <AppText size="large" weight="semibold">
                  {t("queuedAt", { time })}
                </AppText>
              </>
            ) : (
              <>
                <AppText size="large">{t("successBody", { time })}</AppText>
                {receipt.durationMinutes !== null ? (
                  <AppText size="large" weight="semibold">
                    {t("successDuration", { duration: format.minutes(receipt.durationMinutes) })}
                  </AppText>
                ) : null}
                {receipt.pendingApproval ? <AppText size="large">{t("successPending")}</AppText> : null}
              </>
            )}
          </View>
          <View style={styles.actions}>
            <Button label={t("backHome")} onPress={goHome} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const summaryMissing = failure?.kind === "summary";

  /** The message under the form; the missing summary is shown next to its field instead. */
  function failureMessage(current: Failure): string | null {
    switch (current.kind) {
      case "summary":
        return null;
      case "permission":
        return current.canAskAgain ? t("permissionDenied") : t("permissionSettings");
      case "servicesOff":
        return t("locationServicesOff");
      case "location":
        return t("locationUnavailable");
      case "request":
        return errorMessage(current.cause);
    }
  }
  const failureText = failure ? failureMessage(failure) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <ScreenHeader title={t("title")} />
        {/* Not while busy: leaving mid-request would show the receipt on a screen the worker already left. */}
        <ConnectionBanner disabled={busy} onPress={() => navigation.navigate("OfflineQueue")} />
        <View style={styles.body}>
          <AppText color={colors.muted}>{t("help")}</AppText>

          <AppText weight="semibold" style={styles.label}>
            {t("categoryLabel")}
          </AppText>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("categoryLabel")} style={styles.categoryGrid}>
            {TASK_CATEGORIES.map((value) => {
              const selected = taskCategory === value;
              const label = enumLabel("TaskCategory", value);
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: selected, selected, disabled: busy }}
                  disabled={busy}
                  onPress={() => setTaskCategory(value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <AppText weight={selected ? "semibold" : "regular"} color={selected ? colors.primaryText : colors.text} align="center">
                    {label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText weight="semibold" style={styles.label}>
            {t("summaryLabel")}
          </AppText>
          <AppTextInput
            ref={summaryInput}
            accessibilityLabel={t("summaryLabel")}
            multiline
            numberOfLines={4}
            placeholder={t("summaryPlaceholder")}
            value={summaryText}
            onChangeText={handleSummaryChange}
            editable={!busy}
            style={summaryMissing ? styles.inputInvalid : null}
          />
          {summaryMissing ? (
            <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
              {t("summaryRequired")}
            </AppText>
          ) : null}

          <AppText weight="semibold" style={styles.label}>
            {t("problemsLabel")}
          </AppText>
          <AppTextInput
            accessibilityLabel={t("problemsLabel")}
            multiline
            numberOfLines={3}
            placeholder={t("problemsPlaceholder")}
            value={problemsEncountered}
            onChangeText={setProblemsEncountered}
            editable={!busy}
          />
        </View>

        {failureText ? <ErrorView message={failureText} /> : null}
        {failure?.kind === "permission" && !failure.canAskAgain ? (
          <View style={styles.settings}>
            <Button label={t("openSettings")} variant="secondary" onPress={openAppSettings} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={t("action")}
            variant="danger"
            busy={busy}
            busyLabel={step === "submitting" ? t("submitting") : t("locating")}
            onPress={handleClockOut}
          />
          <Button label={tc("cancel")} variant="secondary" disabled={busy} onPress={() => navigation.goBack()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingBottom: spacing.xl },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm },
  label: { marginTop: spacing.sm },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: TOUCH_TARGET,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  inputInvalid: { borderColor: colors.danger, borderWidth: 2 },
  settings: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  actions: { paddingHorizontal: spacing.xl, gap: spacing.md },
  receiptScroll: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing.xl, gap: spacing.xl },
  receipt: { marginHorizontal: spacing.xl, borderRadius: 16, padding: spacing.xl, gap: spacing.md },
});
