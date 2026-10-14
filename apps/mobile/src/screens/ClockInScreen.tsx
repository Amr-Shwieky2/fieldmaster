import { useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { NetworkError } from "@fieldmaster/api-client";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { ClockReceipt } from "../components/ClockReceipt";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { PhotoPicker } from "../components/PhotoPicker";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView } from "../components/StateViews";
import { useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { uploadPhotos } from "../lib/attachments";
import { useAuth } from "../lib/auth-context";
import { getDeviceId } from "../lib/device-id";
import { clockLocationFields, readLocation, type LocationFailure, type LocationReading } from "../lib/location";
import { useOfflineSync } from "../lib/offline-sync-context";
import type { AttendancePhoto } from "../lib/photos";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ClockIn">;

type Step = { name: "idle" } | { name: "locating" } | { name: "uploading"; current: number; total: number } | { name: "submitting" };

/** Why the last attempt failed. The API error itself is kept and turned into Arabic at render time. */
type Failure = LocationFailure | { kind: "request"; cause: unknown };

/** What happened: clocked in on the server, or saved on the phone to sync later. Times are ISO instants. */
type Receipt = {
  kind: "success" | "queued";
  /** The time shown in the body: the server's clock-in time, or the phone's time when the server sent none / while queued. */
  at: string;
  serverTime: string | null;
  deviceTime: string;
  referenceId: string;
  photosDropped: boolean;
};

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** The server's clock-in time from the `{ timeEntry, clockEvent }` answer, when present. */
function serverClockInAt(result: { timeEntry?: { clockInAt?: unknown } | null } | null | undefined): string | null {
  const value = result?.timeEntry?.clockInAt;
  return isInstant(value) ? value : null;
}

/** The clock event's id from the answer, when present. */
function clockEventId(result: { clockEvent?: { id?: unknown } | null } | null | undefined): string | null {
  const id = result?.clockEvent?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
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
  const tClock = useTranslations("clock");
  const tc = useTranslations("common");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle()({ title: route.params.shiftTitle });
  const { client } = useAuth();
  const { queueOfflineEvent } = useOfflineSync();
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [photos, setPhotos] = useState<AttendancePhoto[]>([]);
  const inFlight = useRef(false);
  const busy = step.name !== "idle";

  async function handleClockIn() {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    setStep({ name: "locating" });
    try {
      const location = await readLocation();
      if (!location.ok) {
        setFailure(location.failure);
        return;
      }
      const { reading } = location;

      const deviceId = await getDeviceId();
      const idempotencyKey = `clockin-${shiftId}-${Date.now()}`;
      const locationFields = clockLocationFields(reading);

      try {
        // Photos first (they need the network); an upload already done by an earlier attempt is reused.
        const photoAssetIds = await uploadPhotos(client, photos, {
          onProgress: (current, total) => setStep({ name: "uploading", current, total }),
          onUploaded: (key, assetId) => setPhotos((list) => list.map((photo) => (photo.key === key ? { ...photo, assetId } : photo))),
        });
        setStep({ name: "submitting" });
        const deviceTimestamp = new Date().toISOString();
        try {
          const result = await client.clockIn(
            {
              shiftId,
              deviceId,
              clientEventId: idempotencyKey,
              deviceTimestamp,
              ...locationFields,
              origin: "ONLINE",
              mockLocationState: reading.mockLocationState,
              locationSignals: reading.locationSignals,
              ...(photoAssetIds.length > 0 ? { photoAssetIds } : {}),
            },
            idempotencyKey,
          );
          const serverTime = serverClockInAt(result);
          setReceipt({
            kind: "success",
            at: serverTime ?? deviceTimestamp,
            serverTime,
            deviceTime: deviceTimestamp,
            referenceId: clockEventId(result) ?? idempotencyKey,
            photosDropped: false,
          });
        } catch (err) {
          if (!(err instanceof NetworkError)) throw err;
          await queueClockIn(idempotencyKey, deviceTimestamp, locationFields, reading.mockLocationState);
        }
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        // A photo upload found no connection: the clock-in is saved without the photos.
        await queueClockIn(idempotencyKey, new Date().toISOString(), locationFields, reading.mockLocationState);
      }
    } catch (err) {
      setFailure({ kind: "request", cause: err });
    } finally {
      inFlight.current = false;
      setStep({ name: "idle" });
    }
  }

  /**
   * No connectivity: capture, sign and queue the event locally instead of
   * failing outright (spec section 20.1). The server checks the geofence and
   * the shift for real once it syncs. Only the signed event's own fields are
   * queued (the mock-location state is one of them; the movement signals are
   * not): photos are never stored for later (they need the network).
   */
  async function queueClockIn(
    clientEventId: string,
    deviceTimestamp: string,
    locationFields: ReturnType<typeof clockLocationFields>,
    mockLocationState: LocationReading["mockLocationState"],
  ) {
    await queueOfflineEvent({ clientEventId, eventType: "CLOCK_IN", shiftId, deviceTimestamp, ...locationFields, mockLocationState });
    setReceipt({ kind: "queued", at: deviceTimestamp, serverTime: null, deviceTime: deviceTimestamp, referenceId: clientEventId, photosDropped: photos.length > 0 });
  }

  // Back to the Home screen already in the stack (it reloads on focus), not a second copy of it.
  const goHome = () => navigation.popTo("Home");

  if (receipt) {
    const queued = receipt.kind === "queued";
    const time = format.time(receipt.at);
    return (
      <ClockReceipt
        action="CLOCK_IN"
        queued={queued}
        title={queued ? t("queuedTitle") : t("successTitle")}
        shiftTitle={shiftTitle}
        serverTime={receipt.serverTime}
        deviceTime={receipt.deviceTime}
        referenceId={receipt.referenceId}
        notes={receipt.photosDropped ? [tClock("photosNotSent")] : []}
        doneLabel={t("backHome")}
        onDone={goHome}
      >
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
      </ClockReceipt>
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

  const busyLabel =
    step.name === "uploading" ? tClock("uploadingPhotos", { current: step.current, total: step.total }) : step.name === "submitting" ? t("submitting") : t("locating");

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

        <View style={styles.photos}>
          <PhotoPicker photos={photos} onChange={setPhotos} disabled={busy} />
        </View>

        {failure ? <ErrorView message={failureMessage(failure)} /> : null}
        {failure?.kind === "permission" && !failure.canAskAgain ? (
          <View style={styles.settings}>
            <Button label={t("openSettings")} variant="secondary" onPress={openAppSettings} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button testID="clock-in-submit" label={t("action")} busy={busy} busyLabel={busyLabel} onPress={handleClockIn} />
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
  photos: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  settings: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  actions: { paddingHorizontal: spacing.xl, gap: spacing.md },
});
