import { Injectable } from "@nestjs/common";
import { resolveAppEnvironment } from "../../common/config/app-environment";

/** The longest transcript returned and kept with a summary (the clock-out's `transcription` field has the same limit). */
export const MAX_TRANSCRIPTION_LENGTH = 5000;

/** A voice summary to transcribe. The bytes are read only when a provider needs them (the mock never does). */
export interface TranscriptionInput {
  fileAssetId: string;
  contentType: string;
  sizeBytes: number;
  language: "ar";
  load: () => Promise<Buffer>;
}

export interface TranscriptionResult {
  text: string;
}

/**
 * Turns a recorded voice summary into Arabic text that the worker checks and
 * edits before sending it with the clock-out (Step 9). Implementations must
 * never log the transcript or the audio: it is a worker's own words.
 */
export interface TranscriptionService {
  /** "mock", "none", or the name of a real provider; returned to the app as `provider`. */
  readonly name: string;
  /** Throws `TranscriptionUnavailableError` when no text can be produced (not configured, provider down). */
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

/** Injection token of the configured transcription provider (TRANSCRIPTION_PROVIDER). */
export const TRANSCRIPTION_SERVICE = Symbol("TRANSCRIPTION_SERVICE");

export class TranscriptionUnavailableError extends Error {
  constructor(message = "Transcription is not available.") {
    super(message);
    this.name = "TranscriptionUnavailableError";
  }
}

/** The sentence the development provider returns for every recording. */
export const MOCK_TRANSCRIPT = "أنهيت تركيب لافتات تحويل السير وفحص الإشارات الضوئية في الموقع.";

/** Development, staging and tests: a fixed Arabic sentence, so the whole flow can be tried without a provider account. */
@Injectable()
export class MockTranscriptionService implements TranscriptionService {
  readonly name = "mock";

  async transcribe(): Promise<TranscriptionResult> {
    return { text: MOCK_TRANSCRIPT };
  }
}

/**
 * Production until a real provider is bound: every request answers
 * 503 TRANSCRIPTION_UNAVAILABLE, and the app asks the worker to type the
 * summary instead. A real adapter implements TranscriptionService and is
 * selected here by a new TRANSCRIPTION_PROVIDER value.
 */
@Injectable()
export class UnavailableTranscriptionService implements TranscriptionService {
  readonly name = "none";

  async transcribe(): Promise<TranscriptionResult> {
    throw new TranscriptionUnavailableError("No transcription provider is configured (TRANSCRIPTION_PROVIDER=none).");
  }
}

export const TRANSCRIPTION_PROVIDERS = ["mock", "none"] as const;
export type TranscriptionProviderKind = (typeof TRANSCRIPTION_PROVIDERS)[number];

/**
 * TRANSCRIPTION_PROVIDER: `mock` | `none`. Unset: `mock` in development,
 * staging and tests (APP_ENV, or NODE_ENV=test), `none` in production. The
 * mock is refused in production: it would put the same sentence into every
 * real worker's summary.
 */
export function resolveTranscriptionProvider(env: NodeJS.ProcessEnv = process.env): TranscriptionProviderKind {
  const appEnv = resolveAppEnvironment(env).appEnv;
  const raw = env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  if (!raw) return appEnv === "production" && env.NODE_ENV !== "test" ? "none" : "mock";
  if (!(TRANSCRIPTION_PROVIDERS as readonly string[]).includes(raw)) {
    throw new Error(`TRANSCRIPTION_PROVIDER must be one of ${TRANSCRIPTION_PROVIDERS.join(", ")} (got "${env.TRANSCRIPTION_PROVIDER}").`);
  }
  if (raw === "mock" && appEnv === "production") {
    throw new Error("TRANSCRIPTION_PROVIDER=mock is not allowed when APP_ENV=production: it returns a fixed sentence for every recording.");
  }
  return raw as TranscriptionProviderKind;
}
