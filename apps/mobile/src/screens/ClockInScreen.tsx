import { useRef, useState } from "react";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { NetworkError } from "@fieldmaster/api-client";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView } from "../components/StateViews";
import { useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import { getDeviceId } from "../lib/device-id";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ClockIn">;

type Step = "idle" | "locating" | "submitting";

/**
 * Why the last attempt failed. The API error itself is kept and turned into Arabic at render time.
 * `canAskAgain: false` means the phone no longer shows the permission prompt: only the settings can fix it.
 */
type Failure =
  | { kind: "permission"; canAskAgain: boolean }
  | { kind: "servicesOff" }
  | { kind: "location" }
  | { kind: "request"; cause: unknown };

/** What happened: clocked in on the server, or saved on the phone to sync later. `at` is an ISO instant. */
type Receipt = { kind: "success" | "queued"; at: string };

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** The server's clock-in time from the `{ timeEntry, clockEvent }` answer, when present. */
function serverClockInAt(result: { timeEntry?: { clockInAt?: unknown } | null } | null | undefined): string | null {
  const value = result?.timeEntry?.clockInAt;
  return isInstant(value) ? value : null;
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

export function ClockInScreen({ route, navigation }: Props) {
  const { shiftId } = route.params;
  const t = useTranslations("clockIn");
  const tc = useTranslations("common");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle()({ title: route.params.shiftTitle });
  const { client } = useAuth();
  const { queueOfflineEvent } = useOfflineSync();
  const [step, setStep] = useState<Step>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const inFlight = useRef(false);
  const busy = step !== "idle";

  async function handleClockIn() {
    if (inFlight.current) return;
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
      const idempotencyKey = `clockin-${shiftId}-${Date.now()}`;
      const deviceTimestamp = new Date().toISOString();
      const locationFields = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? 9999,
        altitude: position.coords.altitude ?? undefined,
        locationProvider: "expo-location",
        mockLocationSuspected: position.mocked ?? false,
      };

      try {
        const result = await client.clockIn(
          { shiftId, deviceId, clientEventId: idempotencyKey, deviceTimestamp, ...locationFields, origin: "ONLINE" },
          idempotencyKey,
        );
        setReceipt({ kind: "success", at: serverClockInAt(result) ?? deviceTimestamp });
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        // No connectivity: capture, sign, and queue the event locally
        // instead of failing outright (spec section 20.1). The server will
        // validate the geofence/shift rules for real once this syncs.
        await queueOfflineEvent({
          clientEventId: idempotencyKey,
          eventType: "CLOCK_IN",
          shiftId,
          deviceTimestamp,
          ...locationFields,
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
            <AppText size="large" weight="semibold">
              {shiftTitle}
            </AppText>
            {queued ? (
              <>
                <AppText size="large">{t("queuedBody")}</AppText>
                <AppText size="large" weight="semibold">
                  {t("queuedAt", { time })}
                </AppText>
              </>
            ) : (
              <AppText size="large">{t("successBody", { time })}</AppText>
            )}
          </View>
          <View style={styles.actions}>
            <Button label={t("backHome")} onPress={goHome} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  function failureMessage(current: Failure): string {
    switch (current.kind) {
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

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenHeader title={t("title")} />
        {/* Not while busy: leaving mid-request would show the receipt on a screen the worker already left. */}
        <ConnectionBanner disabled={busy} onPress={() => navigation.navigate("OfflineQueue")} />
        <View style={styles.body}>
          <AppText size="large" weight="semibold">
            {shiftTitle}
          </AppText>
          <AppText color={colors.muted}>{t("help")}</AppText>
        </View>

        {failure ? <ErrorView message={failureMessage(failure)} /> : null}
        {failure?.kind === "permission" && !failure.canAskAgain ? (
          <View style={styles.settings}>
            <Button label={t("openSettings")} variant="secondary" onPress={openAppSettings} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={t("action")}
            busy={busy}
            busyLabel={step === "submitting" ? t("submitting") : t("locating")}
            onPress={handleClockIn}
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
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.md },
  settings: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  actions: { paddingHorizontal: spacing.xl, gap: spacing.md },
  receiptScroll: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing.xl, gap: spacing.xl },
  receipt: { marginHorizontal: spacing.xl, borderRadius: 16, padding: spacing.xl, gap: spacing.md },
});
