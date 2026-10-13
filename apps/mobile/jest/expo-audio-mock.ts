/**
 * jest: expo-audio has no jest-expo mock (importing it throws, its native
 * module is missing). This fake behaves like a phone's recorder and player
 * and is driven by the tests through `audioMock` (call `audioMock.reset()`
 * in `beforeEach`). Registered in jest.setup.ts.
 */
import { useEffect, useReducer } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((listener) => listener());

/** Re-renders the calling component whenever the fake's state changes. */
function useFakeUpdates() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const listener = () => force();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

function createRecorder() {
  const recorder = {
    uri: null as string | null,
    isRecording: false,
    durationMillis: 0,
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(() => {
      recorder.isRecording = true;
      recorder.durationMillis = 0;
      notify();
    }),
    stop: jest.fn(async () => {
      recorder.isRecording = false;
      recorder.uri = audioMock.nextRecordingUri;
      notify();
    }),
  };
  return recorder;
}

function createPlayer() {
  const player = {
    playing: false,
    currentTime: 0,
    duration: 42,
    play: jest.fn(() => {
      player.playing = true;
      notify();
    }),
    pause: jest.fn(() => {
      player.playing = false;
      notify();
    }),
    seekTo: jest.fn(async (seconds: number) => {
      player.currentTime = seconds;
      notify();
    }),
    replace: jest.fn(),
  };
  return player;
}

const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" } as const;

export const audioMock = {
  recorder: createRecorder(),
  player: createPlayer(),
  /** The file `stop()` produces. */
  nextRecordingUri: "file:///cache/voice-summary.m4a",
  /** The source the component last asked the player for. */
  lastPlayerSource: null as unknown,
  requestRecordingPermissionsAsync: jest.fn(async () => granted as { status: string; granted: boolean; canAskAgain: boolean; expires: string }),
  setAudioModeAsync: jest.fn(async (_mode: Record<string, unknown>) => undefined),
  /** Moves the recording clock forward (as the native recorder's status would). */
  setRecordingDuration(ms: number) {
    audioMock.recorder.durationMillis = ms;
    notify();
  },
  /** The playback reached the end. */
  finishPlayback() {
    audioMock.player.playing = false;
    audioMock.player.currentTime = audioMock.player.duration;
    notify();
  },
  reset() {
    audioMock.recorder = createRecorder();
    audioMock.player = createPlayer();
    audioMock.nextRecordingUri = "file:///cache/voice-summary.m4a";
    audioMock.lastPlayerSource = null;
    audioMock.requestRecordingPermissionsAsync = jest.fn(async () => granted as { status: string; granted: boolean; canAskAgain: boolean; expires: string });
    audioMock.setAudioModeAsync = jest.fn(async (_mode: Record<string, unknown>) => undefined);
  },
};

// ── The expo-audio surface the app uses ─────────────────────────────────────

export function useAudioRecorder() {
  return audioMock.recorder;
}

export function useAudioRecorderState(recorder: { isRecording: boolean; durationMillis: number; uri: string | null }) {
  useFakeUpdates();
  return { canRecord: true, isRecording: recorder.isRecording, durationMillis: recorder.durationMillis, mediaServicesDidReset: false, url: recorder.uri };
}

export function useAudioPlayer(source: unknown = null) {
  audioMock.lastPlayerSource = source;
  return audioMock.player;
}

export function useAudioPlayerStatus(player: { playing: boolean; currentTime: number; duration: number }) {
  useFakeUpdates();
  return {
    playing: player.playing,
    currentTime: player.currentTime,
    duration: player.duration,
    didJustFinish: !player.playing && player.currentTime >= player.duration,
    isLoaded: true,
  };
}

export function requestRecordingPermissionsAsync() {
  return audioMock.requestRecordingPermissionsAsync();
}

export function setAudioModeAsync(mode: Record<string, unknown>) {
  return audioMock.setAudioModeAsync(mode);
}

export const AudioQuality = { MIN: 0, LOW: 32, MEDIUM: 64, HIGH: 96, MAX: 127 };
export const IOSOutputFormat = { MPEG4AAC: "aac " };
export const RecordingPresets = {
  HIGH_QUALITY: {
    extension: ".m4a",
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
    android: { outputFormat: "mpeg4", audioEncoder: "aac" },
    ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MAX, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
    web: { mimeType: "audio/webm", bitsPerSecond: 128000 },
  },
};
