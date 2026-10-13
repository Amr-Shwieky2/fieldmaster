import { useRef, useState, type ComponentRef } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { NetworkError } from "@fieldmaster/api-client";
import { SummarySource, TaskCategory, TimeEntryStatus } from "@fieldmaster/shared-types";
import { getErrorCode } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { AppTextInput } from "../components/AppTextInput";
import { Button } from "../components/Button";
import { ClockReceipt } from "../components/ClockReceipt";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { PhotoPicker } from "../components/PhotoPicker";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView } from "../components/StateViews";
import { TaskCategoryPicker } from "../components/TaskCategoryPicker";
import { VoiceRecorder, type VoiceNote } from "../components/VoiceRecorder";
import { useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { uploadPhotos } from "../lib/attachments";
import { useAuth } from "../lib/auth-context";
import { getDeviceId } from "../lib/device-id";
import { clockLocationFields, readLocation, type LocationFailure } from "../lib/location";
import { useOfflineSync } from "../lib/offline-sync-context";
import type { AttendancePhoto } from "../lib/photos";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ClockOut">;

type Step = { name: "idle" } | { name: "locating" } | { name: "uploading"; current: number; total: number } | { name: "submitting" };

/** Why the last attempt failed. The API error itself is kept and turned into Arabic at render time. */
type Failure = { kind: "summary" } | { kind: "voiceBusy" } | { kind: "offlineVoice" } | LocationFailure | { kind: "request"; cause: unknown };

/** What happened: clocked out on the server, or saved on the phone to sync later. Times are ISO instants. */
type Receipt = {
  kind: "success" | "queued";
  /** The shift as the server's answer names it (when Home did not pass a title). */
  shiftTitle: string | null;
  at: string;
  serverTime: string | null;
  deviceTime: string;
  referenceId: string;
  durationMinutes: number | null;
  pendingApproval: boolean;
  notes: string[];
};

type SummaryMode = typeof SummarySource.TYPED | typeof SummarySource.VOICE;

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** The server's answer (the closed entry with its shift and clock-out event): time, duration, approval status, reference. */
function readAnswer(result: unknown, clientEventId: string) {
  const entry = (typeof result === "object" && result !== null ? result : {}) as {
    clockOutAt?: unknown;
    rawDurationMinutes?: unknown;
    status?: unknown;
    shift?: { title?: unknown; shiftType?: unknown } | null;
    clockEvent?: { id?: unknown } | null;
    clockEvents?: { id?: unknown; clientEventId?: unknown }[] | null;
  };
  const duration = entry.rawDurationMinutes;
  const ownEvent = Array.isArray(entry.clockEvents) ? entry.clockEvents.find((event) => event?.clientEventId === clientEventId) : undefined;
  const eventId = entry.clockEvent?.id ?? ownEvent?.id;
  return {
    clockOutAt: isInstant(entry.clockOutAt) ? entry.clockOutAt : null,
    durationMinutes: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
    // A clock-out always waits for a manager's approval; only a different status from the server hides the note.
    pendingApproval: entry.status === undefined || entry.status === null || entry.status === TimeEntryStatus.PENDING_APPROVAL,
    // Without a clock event id in the answer, the client event id (stored on the server's clock event) finds it as well.
    referenceId: typeof eventId === "string" && eventId.length > 0 ? eventId : clientEventId,
    shift: typeof entry.shift?.title === "string" ? { title: entry.shift.title, shiftType: typeof entry.shift.shiftType === "string" ? entry.shift.shiftType : null } : null,
  };
}

/** The app's page in the phone settings, where a permanently refused location permission is turned back on. */
async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing else to offer: the message on screen already says what to do.
  }
}

export function ClockOutScreen({ navigation, route }: Props) {
  const t = useTranslations("clockOut");
  const tClock = useTranslations("clock");
  const tc = useTranslations("common");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const titleOf = useShiftTitle();
  const { client } = useAuth();
  const { isOnline, queueOfflineEvent } = useOfflineSync();
  const shiftTitle = route.params?.shiftTitle ?? null;
  const [taskCategory, setTaskCategory] = useState<string>(TaskCategory.OTHER);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>(SummarySource.TYPED);
  const [summaryText, setSummaryText] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceOpened, setVoiceOpened] = useState(false);
  const [problemsEncountered, setProblemsEncountered] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [photos, setPhotos] = useState<AttendancePhoto[]>([]);
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const summaryInput = useRef<ComponentRef<typeof AppTextInput>>(null);
  const inFlight = useRef(false);
  const busy = step.name !== "idle";

  const isSummaryFailure = (current: Failure | null) => current?.kind === "summary" || current?.kind === "voiceBusy" || current?.kind === "offlineVoice";

  function handleSummaryChange(text: string) {
    setSummaryText(text);
    if (isSummaryFailure(failure) && text.trim().length > 0) setFailure(null);
  }

  function handleVoiceNote(note: VoiceNote | null) {
    setVoiceNote(note);
    if (!note) setVoiceText("");
    else if (isSummaryFailure(failure)) setFailure(null);
  }

  function chooseMode(mode: SummaryMode) {
    setSummaryMode(mode);
    if (mode === SummarySource.VOICE) setVoiceOpened(true);
    if (isSummaryFailure(failure)) setFailure(null);
  }

  /** The summary as the API takes it, or why it cannot be sent yet. */
  function summaryFields():
    | { ok: true; fields: { summaryText?: string; summarySource: SummaryMode; voiceNoteAssetId?: string; transcription?: string } }
    | { ok: false; failure: Failure } {
    if (summaryMode === SummarySource.VOICE) {
      if (voiceBusy) return { ok: false, failure: { kind: "voiceBusy" } };
      if (!voiceNote) return { ok: false, failure: { kind: "summary" } };
      return {
        ok: true,
        fields: {
          summaryText: voiceText.trim() || undefined,
          summarySource: SummarySource.VOICE,
          voiceNoteAssetId: voiceNote.assetId,
          transcription: voiceNote.transcription ?? undefined,
        },
      };
    }
    const text = summaryText.trim();
    if (text.length === 0) return { ok: false, failure: { kind: "summary" } };
    return { ok: true, fields: { summaryText: text, summarySource: SummarySource.TYPED } };
  }

  async function handleClockOut() {
    if (inFlight.current) return;
    const summary = summaryFields();
    if (!summary.ok) {
      setFailure(summary.failure);
      if (summary.failure.kind === "summary" && summaryMode === SummarySource.TYPED) summaryInput.current?.focus();
      return;
    }
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
      const idempotencyKey = `clockout-${Date.now()}`;
      const locationFields = clockLocationFields(reading);
      const shared = {
        taskCategory,
        problemsEncountered: problemsEncountered.trim() || undefined,
        // Only sent when switched on: the API's default is "no follow-up".
        ...(followUpRequired ? { followUpRequired: true } : {}),
      };

      /**
       * No connectivity: the clock-out is signed and saved on the phone with
       * a typed summary (spec section 20.1). Photos and the voice note need
       * the network and are never queued; a voice summary falls back to its
       * (edited) text, and without any text the worker is asked to type it.
       */
      const queueClockOut = async (deviceTimestamp: string) => {
        const text = summaryMode === SummarySource.VOICE ? voiceText.trim() : summary.fields.summaryText ?? "";
        if (!text) {
          setSummaryMode(SummarySource.TYPED);
          setFailure({ kind: "offlineVoice" });
          return;
        }
        await queueOfflineEvent({
          clientEventId: idempotencyKey,
          eventType: "CLOCK_OUT",
          deviceTimestamp,
          ...locationFields,
          mockLocationState: reading.mockLocationState,
          summaryText: text,
          ...shared,
        });
        const notes = [
          ...(photos.length > 0 ? [tClock("photosNotSent")] : []),
          ...(summaryMode === SummarySource.VOICE ? [tClock("voiceNotSent")] : []),
        ];
        setReceipt({
          kind: "queued",
          shiftTitle: null,
          at: deviceTimestamp,
          serverTime: null,
          deviceTime: deviceTimestamp,
          referenceId: idempotencyKey,
          durationMinutes: null,
          pendingApproval: true,
          notes,
        });
      };

      try {
        const photoAssetIds = await uploadPhotos(client, photos, {
          onProgress: (current, total) => setStep({ name: "uploading", current, total }),
          onUploaded: (key, assetId) => setPhotos((list) => list.map((photo) => (photo.key === key ? { ...photo, assetId } : photo))),
        });
        setStep({ name: "submitting" });
        const deviceTimestamp = new Date().toISOString();
        try {
          const result = await client.clockOut(
            {
              deviceId,
              clientEventId: idempotencyKey,
              deviceTimestamp,
              ...locationFields,
              origin: "ONLINE",
              ...summary.fields,
              ...shared,
              mockLocationState: reading.mockLocationState,
              locationSignals: reading.locationSignals,
              ...(photoAssetIds.length > 0 ? { photoAssetIds } : {}),
            },
            idempotencyKey,
          );
          const answer = readAnswer(result, idempotencyKey);
          setReceipt({
            kind: "success",
            shiftTitle: answer.shift ? titleOf(answer.shift) : null,
            at: answer.clockOutAt ?? deviceTimestamp,
            serverTime: answer.clockOutAt,
            deviceTime: deviceTimestamp,
            referenceId: answer.referenceId,
            durationMinutes: answer.durationMinutes,
            pendingApproval: answer.pendingApproval,
            notes: [],
          });
        } catch (err) {
          if (!(err instanceof NetworkError)) throw err;
          await queueClockOut(deviceTimestamp);
        }
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        // A photo upload found no connection.
        await queueClockOut(new Date().toISOString());
      }
    } catch (err) {
      // The server's own "summary required" goes next to the summary, like the check before sending.
      setFailure(getErrorCode(err) === "SUMMARY_REQUIRED" ? { kind: "summary" } : { kind: "request", cause: err });
    } finally {
      inFlight.current = false;
      setStep({ name: "idle" });
    }
  }

  // Back to the Home screen already in the stack (it reloads on focus), not a second copy of it.
  const goHome = () => navigation.popTo("Home");

  if (receipt) {
    const queued = receipt.kind === "queued";
    const time = format.time(receipt.at);
    return (
      <ClockReceipt
        action="CLOCK_OUT"
        queued={queued}
        title={queued ? t("queuedTitle") : t("successTitle")}
        shiftTitle={shiftTitle ?? receipt.shiftTitle}
        serverTime={receipt.serverTime}
        deviceTime={receipt.deviceTime}
        referenceId={receipt.referenceId}
        notes={receipt.notes}
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
      </ClockReceipt>
    );
  }

  /** The message under the form; summary problems are shown next to the summary instead. */
  function failureMessage(current: Failure): string | null {
    switch (current.kind) {
      case "summary":
      case "voiceBusy":
      case "offlineVoice":
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
  const summaryProblem =
    failure?.kind === "summary" ? tClock("summaryRequired") : failure?.kind === "voiceBusy" ? tClock("voiceBusy") : failure?.kind === "offlineVoice" ? tClock("offlineVoice") : null;
  const busyLabel =
    step.name === "uploading" ? tClock("uploadingPhotos", { current: step.current, total: step.total }) : step.name === "submitting" ? t("submitting") : t("locating");

  const modes: { mode: SummaryMode; label: string; disabled: boolean }[] = [
    { mode: SummarySource.TYPED, label: tClock("summaryTyped"), disabled: busy },
    // Recording needs the network (upload and transcription); a recording already made stays available.
    { mode: SummarySource.VOICE, label: tClock("summaryVoice"), disabled: busy || (!isOnline && !voiceNote) },
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <ScreenHeader title={t("title")} />
        {/* Not while busy: leaving mid-request would show the receipt on a screen the worker already left. */}
        <ConnectionBanner disabled={busy} onPress={() => navigation.navigate("OfflineQueue")} />
        <View style={styles.body}>
          {shiftTitle ? (
            <AppText size="large" weight="semibold">
              {shiftTitle}
            </AppText>
          ) : null}
          <AppText color={colors.muted}>{t("help")}</AppText>

          <AppText weight="semibold" style={styles.label}>
            {t("categoryLabel")}
          </AppText>
          <TaskCategoryPicker label={t("categoryLabel")} value={taskCategory} onChange={setTaskCategory} disabled={busy} />

          <AppText weight="semibold" style={styles.label}>
            {t("summaryLabel")}
          </AppText>
          <View accessibilityRole="tablist" accessibilityLabel={tClock("summaryMode")} style={styles.modes}>
            {modes.map(({ mode, label, disabled }) => {
              const selected = summaryMode === mode;
              return (
                <Pressable
                  key={mode}
                  testID={mode === SummarySource.VOICE ? "summary-mode-voice" : "summary-mode-typed"}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => chooseMode(mode)}
                  style={[styles.mode, selected && styles.modeSelected, disabled && styles.modeDisabled]}
                >
                  <AppText weight="semibold" color={selected ? colors.primaryText : colors.text} align="center">
                    {label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {summaryMode === SummarySource.TYPED ? (
            <AppTextInput
              ref={summaryInput}
              testID="clock-out-summary"
              accessibilityLabel={t("summaryLabel")}
              multiline
              numberOfLines={4}
              placeholder={t("summaryPlaceholder")}
              value={summaryText}
              onChangeText={handleSummaryChange}
              editable={!busy}
              style={summaryProblem ? styles.inputInvalid : null}
            />
          ) : null}
          {/* Once opened, the recorder stays mounted (hidden while typing): switching back keeps the recording. */}
          {voiceOpened ? (
            <View style={summaryMode === SummarySource.VOICE ? styles.voice : styles.hidden}>
              <VoiceRecorder disabled={!isOnline || busy} onVoiceNote={handleVoiceNote} onTranscript={setVoiceText} onBusyChange={setVoiceBusy} />
              {voiceNote ? (
                <>
                  <AppText weight="semibold" style={styles.label}>
                    {tClock("voiceTextLabel")}
                  </AppText>
                  <AppTextInput
                    testID="clock-out-voice-text"
                    accessibilityLabel={tClock("voiceTextLabel")}
                    multiline
                    numberOfLines={4}
                    placeholder={tClock("voiceTextPlaceholder")}
                    value={voiceText}
                    onChangeText={setVoiceText}
                    editable={!busy}
                  />
                </>
              ) : null}
            </View>
          ) : null}
          {summaryProblem ? (
            <AppText testID="clock-out-summary-error" accessibilityRole="alert" weight="semibold" color={colors.danger}>
              {summaryProblem}
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

          <View style={styles.followUp}>
            <View style={styles.followUpText}>
              <AppText weight="semibold">{tClock("followUp")}</AppText>
              <AppText size="small" color={colors.muted}>
                {tClock("followUpHint")}
              </AppText>
            </View>
            <Switch
              testID="clock-out-follow-up"
              accessibilityLabel={tClock("followUp")}
              value={followUpRequired}
              onValueChange={setFollowUpRequired}
              disabled={busy}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>

          <View style={styles.photos}>
            <PhotoPicker photos={photos} onChange={setPhotos} disabled={busy} />
          </View>
        </View>

        {failureText ? <ErrorView message={failureText} /> : null}
        {failure?.kind === "permission" && !failure.canAskAgain ? (
          <View style={styles.settings}>
            <Button label={t("openSettings")} variant="secondary" onPress={openAppSettings} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button testID="clock-out-submit" label={t("action")} variant="danger" busy={busy} busyLabel={busyLabel} onPress={handleClockOut} />
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
  modes: { flexDirection: "row", gap: spacing.sm },
  mode: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
  },
  modeSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeDisabled: { opacity: 0.5 },
  inputInvalid: { borderColor: colors.danger, borderWidth: 2 },
  voice: { gap: spacing.sm },
  hidden: { display: "none" },
  followUp: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginTop: spacing.md, minHeight: TOUCH_TARGET },
  followUpText: { flexShrink: 1, gap: 2 },
  photos: { marginTop: spacing.md },
  settings: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  actions: { paddingHorizontal: spacing.xl, gap: spacing.md },
});
