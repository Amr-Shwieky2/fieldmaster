import {
  MOCK_TRANSCRIPT,
  MockTranscriptionService,
  TranscriptionUnavailableError,
  UnavailableTranscriptionService,
  resolveTranscriptionProvider,
} from "../transcription";

const input = { fileAssetId: "f-1", contentType: "audio/mp4", sizeBytes: 10, language: "ar" as const, load: jest.fn() };

describe("resolveTranscriptionProvider (TRANSCRIPTION_PROVIDER)", () => {
  it("defaults to the mock in development, staging and tests, and to none in production", () => {
    expect(resolveTranscriptionProvider({ APP_ENV: "development" })).toBe("mock");
    expect(resolveTranscriptionProvider({ APP_ENV: "staging" })).toBe("mock");
    expect(resolveTranscriptionProvider({ NODE_ENV: "test" })).toBe("mock");
    expect(resolveTranscriptionProvider({ APP_ENV: "production", NODE_ENV: "test" })).toBe("mock");
    expect(resolveTranscriptionProvider({ APP_ENV: "production", NODE_ENV: "production" })).toBe("none");
    // APP_ENV unset follows NODE_ENV.
    expect(resolveTranscriptionProvider({ NODE_ENV: "production" })).toBe("none");
  });

  it("takes an explicit value, case-insensitively", () => {
    expect(resolveTranscriptionProvider({ APP_ENV: "development", TRANSCRIPTION_PROVIDER: "none" })).toBe("none");
    expect(resolveTranscriptionProvider({ APP_ENV: "staging", TRANSCRIPTION_PROVIDER: " Mock " })).toBe("mock");
    expect(resolveTranscriptionProvider({ APP_ENV: "production", TRANSCRIPTION_PROVIDER: "none" })).toBe("none");
  });

  it("refuses an unknown provider, and the mock in production (it would put one sentence into every real summary)", () => {
    expect(() => resolveTranscriptionProvider({ APP_ENV: "development", TRANSCRIPTION_PROVIDER: "whisper" })).toThrow(/TRANSCRIPTION_PROVIDER must be one of mock, none/);
    expect(() => resolveTranscriptionProvider({ APP_ENV: "production", TRANSCRIPTION_PROVIDER: "mock" })).toThrow(/not allowed when APP_ENV=production/);
  });
});

describe("transcription providers", () => {
  it("the mock answers a fixed Arabic sentence without reading the recording", async () => {
    const mock = new MockTranscriptionService();
    expect(mock.name).toBe("mock");
    await expect(mock.transcribe()).resolves.toEqual({ text: MOCK_TRANSCRIPT });
    expect(MOCK_TRANSCRIPT).toMatch(/^[؀-ۿ\s.،]+$/);
    expect(input.load).not.toHaveBeenCalled();
  });

  it("none is always unavailable", async () => {
    const none = new UnavailableTranscriptionService();
    expect(none.name).toBe("none");
    await expect(none.transcribe()).rejects.toBeInstanceOf(TranscriptionUnavailableError);
  });
});
