import { act, fireEvent, screen } from "@testing-library/react-native";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import { audioMock } from "../../../jest/expo-audio-mock";
import ar from "../../i18n/messages";
import { useAuth } from "../../lib/auth-context";
import { deferred, expectArabicOnly, fill, renderInArabic } from "../../screens/__tests__/clock-screens-test-utils";
import { VoiceRecorder, type VoiceNote } from "../VoiceRecorder";

jest.mock("../../lib/auth-context", () => ({ useAuth: jest.fn() }));

const TRANSCRIPT = "تم تركيب إشارتين جديدتين عند المفترق.";
const UNAVAILABLE = () =>
  new ApiRequestError(503, { statusCode: 503, code: "TRANSCRIPTION_UNAVAILABLE", message: "No transcription provider", correlationId: "corr-1" });

let uploadAttachment: jest.Mock;
let transcribeVoiceNote: jest.Mock;
let onVoiceNote: jest.Mock<void, [VoiceNote | null]>;
let onTranscript: jest.Mock<void, [string]>;
let onBusyChange: jest.Mock<void, [boolean]>;

beforeEach(() => {
  audioMock.reset();
  uploadAttachment = jest.fn(async () => ({ fileAssetId: "voice-1", purpose: "VOICE_SUMMARY", contentType: "audio/mp4", sizeBytes: 420_000 }));
  transcribeVoiceNote = jest.fn(async () => ({ fileAssetId: "voice-1", text: TRANSCRIPT, provider: "mock", language: "ar" }));
  onVoiceNote = jest.fn();
  onTranscript = jest.fn();
  onBusyChange = jest.fn();
  jest.mocked(useAuth).mockImplementation(() => ({ client: { uploadAttachment, transcribeVoiceNote } }) as unknown as ReturnType<typeof useAuth>);
});

function renderRecorder(disabled = false) {
  return renderInArabic(<VoiceRecorder disabled={disabled} onVoiceNote={onVoiceNote} onTranscript={onTranscript} onBusyChange={onBusyChange} />);
}

async function record(seconds: number) {
  await fireEvent.press(screen.getByRole("button", { name: ar.voice.start }));
  await act(async () => audioMock.setRecordingDuration(seconds * 1000));
}

describe("VoiceRecorder (Arabic, RTL)", () => {
  it("offers to record, with the 3-minute limit in Arabic", async () => {
    await renderRecorder();
    expect(screen.getByText(fill(ar.voice.maxHint, { duration: "3 دقائق" }))).toBeOnTheScreen();
    expect(screen.getByText("يمكن تسجيل ملخص صوتي حتى 3 دقائق.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.voice.start })).toBeEnabled();
    expectArabicOnly();
  });

  it("records, shows the running time against the limit, then uploads and transcribes on stop", async () => {
    await renderRecorder();
    await record(42);

    expect(audioMock.requestRecordingPermissionsAsync).toHaveBeenCalled();
    expect(audioMock.setAudioModeAsync).toHaveBeenCalledWith({ allowsRecording: true, playsInSilentMode: true });
    expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalled();
    expect(audioMock.recorder.record).toHaveBeenCalled();
    expect(screen.getByText(fill(ar.voice.recording, { elapsed: "00:42", max: "03:00" }))).toBeOnTheScreen();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));

    expect(await screen.findByText(ar.voice.transcribed)).toBeOnTheScreen();
    expect(audioMock.recorder.stop).toHaveBeenCalled();
    expect(uploadAttachment).toHaveBeenCalledWith("VOICE_SUMMARY", { uri: "file:///cache/voice-summary.m4a", name: "voice-summary.m4a", type: "audio/mp4" }, "voice-summary.m4a");
    expect(transcribeVoiceNote).toHaveBeenCalledWith("voice-1");
    // First the note alone (uploaded), then with the transcript exactly as the service returned it.
    expect(onVoiceNote.mock.calls).toEqual([[{ assetId: "voice-1", transcription: null }], [{ assetId: "voice-1", transcription: TRANSCRIPT }]]);
    expect(onTranscript).toHaveBeenCalledWith(TRANSCRIPT);
    expect(screen.getByText(fill(ar.voice.recorded, { duration: "00:42" }))).toBeOnTheScreen();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expectArabicOnly();
  });

  it("stops by itself at 3 minutes and says so", async () => {
    await renderRecorder();
    await record(179);
    expect(audioMock.recorder.stop).not.toHaveBeenCalled();

    await act(async () => audioMock.setRecordingDuration(180_000));

    expect(await screen.findByText(ar.voice.autoStopped)).toBeOnTheScreen();
    expect(audioMock.recorder.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(fill(ar.voice.recorded, { duration: "03:00" }))).toBeOnTheScreen();
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it("shows what it is doing while uploading and transcribing", async () => {
    const upload = deferred<unknown>();
    const transcription = deferred<unknown>();
    uploadAttachment.mockReturnValue(upload.promise);
    transcribeVoiceNote.mockReturnValue(transcription.promise);
    await renderRecorder();
    await record(5);
    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));

    expect(await screen.findByText(ar.voice.uploading)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.voice.discard })).toBeDisabled();
    await act(async () => upload.resolve({ fileAssetId: "voice-1" }));
    expect(await screen.findByText(ar.voice.transcribing)).toBeOnTheScreen();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => transcription.resolve({ text: TRANSCRIPT }));
    await pressing;
    expect(await screen.findByText(ar.voice.transcribed)).toBeOnTheScreen();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the voice note when transcription is unavailable (503), and says the text can be typed", async () => {
    transcribeVoiceNote.mockRejectedValue(UNAVAILABLE());
    await renderRecorder();
    await record(30);
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));

    expect(await screen.findByText(ar.voice.transcriptionUnavailable)).toBeOnTheScreen();
    expect(onVoiceNote).toHaveBeenLastCalledWith({ assetId: "voice-1", transcription: null });
    expect(onTranscript).not.toHaveBeenCalled();
    // Nothing to retry: the service is not configured.
    expect(screen.queryByRole("button", { name: ar.voice.retryTranscription })).not.toBeOnTheScreen();
    expect(screen.queryByText(/No transcription provider/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("offers to retry a transcription that failed for another reason", async () => {
    transcribeVoiceNote.mockRejectedValueOnce(new ApiRequestError(500, { statusCode: 500, code: "INTERNAL_ERROR", message: "boom", correlationId: "c" }));
    await renderRecorder();
    await record(30);
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));

    expect(await screen.findByText(`${ar.voice.transcriptionFailed}\n${ar.errors.INTERNAL_ERROR}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.retryTranscription }));
    expect(await screen.findByText(ar.voice.transcribed)).toBeOnTheScreen();
    expect(transcribeVoiceNote).toHaveBeenCalledTimes(2);
    expect(onTranscript).toHaveBeenCalledWith(TRANSCRIPT);
  });

  it("says when the upload found no connection, and uploads the same recording again on retry", async () => {
    uploadAttachment.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderRecorder();
    await record(12);
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));

    expect(await screen.findByText(ar.voice.uploadOffline)).toBeOnTheScreen();
    expect(onVoiceNote).not.toHaveBeenCalled();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.voice.retryUpload }));
    expect(await screen.findByText(ar.voice.transcribed)).toBeOnTheScreen();
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(uploadAttachment.mock.calls[1][1]).toEqual({ uri: "file:///cache/voice-summary.m4a", name: "voice-summary.m4a", type: "audio/mp4" });
  });

  it("plays the recording back and pauses it", async () => {
    await renderRecorder();
    await record(42);
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));
    await screen.findByText(ar.voice.transcribed);
    expect(audioMock.lastPlayerSource).toEqual({ uri: "file:///cache/voice-summary.m4a" });

    await fireEvent.press(screen.getByRole("button", { name: ar.voice.play }));
    expect(audioMock.player.play).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.pause }));
    expect(audioMock.player.pause).toHaveBeenCalled();

    // Played to the end: the next play starts from the beginning.
    await act(async () => audioMock.finishPlayback());
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.play }));
    expect(audioMock.player.seekTo).toHaveBeenCalledWith(0);
  });

  it("deletes the recording: the summary no longer has a voice note", async () => {
    await renderRecorder();
    await record(42);
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));
    await screen.findByText(ar.voice.transcribed);

    await fireEvent.press(screen.getByRole("button", { name: ar.voice.discard }));
    expect(onVoiceNote).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: ar.voice.start })).toBeOnTheScreen();
    expect(screen.queryByText(ar.voice.transcribed)).not.toBeOnTheScreen();
  });

  it("shows that the microphone is being prepared while the phone asks for the permission", async () => {
    const permission = deferred<{ status: string; granted: boolean; canAskAgain: boolean; expires: string }>();
    audioMock.requestRecordingPermissionsAsync.mockReturnValue(permission.promise);
    await renderRecorder();
    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(screen.getByRole("button", { name: ar.voice.start }));

    const preparing = await screen.findByRole("button", { name: ar.voice.preparing });
    expect(preparing).toBeDisabled();
    expect(preparing).toBeBusy();
    expect(audioMock.recorder.record).not.toHaveBeenCalled();

    await act(async () => permission.resolve({ status: "granted", granted: true, canAskAgain: true, expires: "never" }));
    await pressing;
    expect(await screen.findByRole("button", { name: ar.voice.stop })).toBeOnTheScreen();
  });

  it("explains a refused microphone permission, without recording", async () => {
    audioMock.requestRecordingPermissionsAsync.mockResolvedValue({ status: "denied", granted: false, canAskAgain: true, expires: "never" });
    await renderRecorder();
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.start }));

    expect(await screen.findByText(ar.voice.permissionDenied)).toBeOnTheScreen();
    expect(audioMock.recorder.record).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("says when this device cannot record", async () => {
    audioMock.recorder.prepareToRecordAsync.mockRejectedValue(new Error("No media devices available"));
    await renderRecorder();
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.start }));

    expect(await screen.findByText(ar.voice.recordFailed)).toBeOnTheScreen();
    expect(screen.queryByText(/media devices/)).not.toBeOnTheScreen();
  });

  it("offline: recording is switched off and the notice says to type the summary", async () => {
    await renderRecorder(true);
    expect(screen.getByText(ar.voice.offline)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.voice.start })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.start }));
    expect(audioMock.recorder.record).not.toHaveBeenCalled();
    expectArabicOnly();
  });
});
