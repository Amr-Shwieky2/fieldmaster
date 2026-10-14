import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import { useTranslations } from "use-intl";
import { MAX_VOICE_SUMMARY_SECONDS } from "@fieldmaster/shared-types";
import { getErrorCode, isNetworkError } from "@fieldmaster/i18n";
import { useErrorMessage } from "../i18n/hooks";
import { toUploadable, voiceFileInfo } from "../lib/attachments";
import { useAuth } from "../lib/auth-context";
import { formatClock } from "../lib/elapsed";
import { colors, spacing } from "../lib/theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

/** The uploaded voice summary: its file, and the transcript exactly as the service returned it (null when there is none). */
export interface VoiceNote {
  assetId: string;
  transcription: string | null;
}

/**
 * Speech in mono AAC at 64 kbit/s (WebM on the web target): a 3-minute
 * summary is about 1.4 MB, far under the upload limit, and quick to send.
 */
const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  web: { mimeType: "audio/webm", bitsPerSecond: 64000 },
};

const MAX_MS = MAX_VOICE_SUMMARY_SECONDS * 1000;

type Phase = "idle" | "recording" | "uploading" | "transcribing" | "ready" | "uploadFailed";
type Notice = "permission" | "recordFailed" | "autoStopped";

/**
 * The daily summary by voice: record (up to MAX_VOICE_SUMMARY_SECONDS, then
 * it stops by itself), listen back, and the recording is uploaded and
 * transcribed to Arabic text. The screen shows that text for the worker to
 * correct; the original transcript is kept with the summary. Needs the
 * network: with `disabled` (offline) recording cannot start.
 */
export function VoiceRecorder({
  disabled = false,
  onVoiceNote,
  onTranscript,
  onBusyChange,
}: {
  disabled?: boolean;
  /** The uploaded note (and its transcript once known); null when the recording is deleted. */
  onVoiceNote: (note: VoiceNote | null) => void;
  /** The transcript, to fill the editable summary text. */
  onTranscript: (text: string) => void;
  /** True while recording, uploading or transcribing (the summary is not ready to send). */
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslations("voice");
  const tUnits = useTranslations("units");
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recording, setRecording] = useState<{ uri: string; durationMs: number } | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [transcriptionError, setTranscriptionError] = useState<unknown>(null);
  const player = useAudioPlayer(recording ? { uri: recording.uri } : null);
  const playback = useAudioPlayerStatus(player);
  const stopping = useRef(false);
  /** Waiting for the microphone permission (the phone's dialog) and the recorder. */
  const [starting, setStarting] = useState(false);
  const busy = starting || phase === "recording" || phase === "uploading" || phase === "transcribing";

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  async function start() {
    if (disabled || starting || phase !== "idle") return;
    setNotice(null);
    setStarting(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setNotice("permission");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch {
      setNotice("recordFailed");
    } finally {
      setStarting(false);
    }
  }

  async function transcribe(id: string) {
    setPhase("transcribing");
    setTranscriptionError(null);
    try {
      const result = await client.transcribeVoiceNote(id);
      onVoiceNote({ assetId: id, transcription: result.text });
      onTranscript(result.text);
    } catch (cause) {
      // The recording itself is attached; without a transcript the worker types the text (or sends the voice note alone).
      setTranscriptionError(cause ?? new Error());
    } finally {
      setPhase("ready");
    }
  }

  async function upload(uri: string) {
    setPhase("uploading");
    setUploadError(null);
    try {
      const { name, type } = voiceFileInfo();
      const uploaded = await client.uploadAttachment("VOICE_SUMMARY", await toUploadable(uri, name, type), name);
      setAssetId(uploaded.fileAssetId);
      onVoiceNote({ assetId: uploaded.fileAssetId, transcription: null });
      await transcribe(uploaded.fileAssetId);
    } catch (cause) {
      setUploadError(cause ?? new Error());
      setPhase("uploadFailed");
    }
  }

  async function stop(automatic = false) {
    if (stopping.current || phase !== "recording") return;
    stopping.current = true;
    const durationMs = Math.min(recorderState.durationMillis, MAX_MS);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      const uri = recorder.uri;
      if (!uri) {
        setPhase("idle");
        setNotice("recordFailed");
        return;
      }
      setRecording({ uri, durationMs });
      if (automatic) setNotice("autoStopped");
      await upload(uri);
    } catch {
      setPhase("idle");
      setNotice("recordFailed");
    } finally {
      stopping.current = false;
    }
  }

  // The limit: the recording stops by itself at MAX_VOICE_SUMMARY_SECONDS.
  useEffect(() => {
    if (phase === "recording" && recorderState.durationMillis >= MAX_MS) void stop(true);
  });

  // Leaving the screen while recording: stop the microphone.
  const recordingRef = useRef(false);
  recordingRef.current = phase === "recording";
  useEffect(
    () => () => {
      if (recordingRef.current) void Promise.resolve(recorder.stop()).catch(() => undefined);
    },
    [recorder],
  );

  function discard() {
    if (playback.playing) player.pause();
    setRecording(null);
    setAssetId(null);
    setUploadError(null);
    setTranscriptionError(null);
    setNotice(null);
    setPhase("idle");
    onVoiceNote(null);
  }

  async function togglePlayback() {
    if (playback.playing) {
      player.pause();
      return;
    }
    if (playback.duration > 0 && playback.currentTime >= playback.duration) await player.seekTo(0);
    player.play();
  }

  function noticeText(): string | null {
    if (notice === "permission") return t("permissionDenied");
    if (notice === "recordFailed") return t("recordFailed");
    if (notice === "autoStopped") return t("autoStopped");
    return null;
  }

  const uploadErrorText = uploadError ? (isNetworkError(uploadError) ? t("uploadOffline") : `${t("uploadFailed")}\n${errorMessage(uploadError)}`) : null;
  const transcriptionErrorText = transcriptionError
    ? getErrorCode(transcriptionError) === "TRANSCRIPTION_UNAVAILABLE"
      ? t("transcriptionUnavailable")
      : `${t("transcriptionFailed")}\n${errorMessage(transcriptionError)}`
    : null;
  const currentNotice = noticeText();

  return (
    <View style={styles.box} testID="voice-recorder">
      {phase === "idle" ? (
        <>
          <AppText color={colors.muted}>{t("maxHint", { duration: tUnits("minutesLong", { count: MAX_VOICE_SUMMARY_SECONDS / 60 }) })}</AppText>
          {disabled ? (
            <AppText color={colors.warning} weight="semibold">
              {t("offline")}
            </AppText>
          ) : null}
          <Button testID="voice-start" label={t("start")} disabled={disabled} busy={starting} busyLabel={t("preparing")} onPress={start} />
        </>
      ) : null}

      {phase === "recording" ? (
        <>
          <AppText testID="voice-elapsed" weight="semibold" color={colors.danger}>
            {t("recording", { elapsed: formatClock(recorderState.durationMillis), max: formatClock(MAX_MS) })}
          </AppText>
          <Button testID="voice-stop" label={t("stop")} variant="danger" onPress={() => stop(false)} />
        </>
      ) : null}

      {recording && phase !== "recording" ? (
        <>
          <AppText weight="semibold">{t("recorded", { duration: formatClock(recording.durationMs) })}</AppText>
          <View style={styles.row}>
            <Button
              testID="voice-play"
              label={playback.playing ? t("pause") : t("play")}
              variant="secondary"
              onPress={togglePlayback}
              style={styles.rowButton}
            />
            <Button testID="voice-discard" label={t("discard")} variant="secondary" disabled={busy} onPress={discard} style={styles.rowButton} />
          </View>
        </>
      ) : null}

      {phase === "uploading" ? <AppText color={colors.muted}>{t("uploading")}</AppText> : null}
      {phase === "transcribing" ? <AppText color={colors.muted}>{t("transcribing")}</AppText> : null}
      {phase === "ready" && assetId && !transcriptionErrorText ? <AppText color={colors.success}>{t("transcribed")}</AppText> : null}

      {phase === "ready" && transcriptionErrorText ? (
        <>
          <AppText accessibilityRole="alert" color={colors.warning} weight="semibold">
            {transcriptionErrorText}
          </AppText>
          {assetId && getErrorCode(transcriptionError) !== "TRANSCRIPTION_UNAVAILABLE" ? (
            <Button testID="voice-retry-transcription" label={t("retryTranscription")} variant="secondary" onPress={() => transcribe(assetId)} />
          ) : null}
        </>
      ) : null}

      {phase === "uploadFailed" && uploadErrorText ? (
        <>
          <AppText accessibilityRole="alert" color={colors.danger} weight="semibold">
            {uploadErrorText}
          </AppText>
          {recording ? (
            <Button testID="voice-retry-upload" label={t("retryUpload")} variant="secondary" disabled={disabled} onPress={() => upload(recording.uri)} />
          ) : null}
        </>
      ) : null}

      {currentNotice ? (
        <AppText accessibilityRole="alert" color={notice === "autoStopped" ? colors.muted : colors.danger} weight="semibold">
          {currentNotice}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: spacing.md, backgroundColor: colors.card },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rowButton: { flexGrow: 1, flexBasis: 140 },
});
