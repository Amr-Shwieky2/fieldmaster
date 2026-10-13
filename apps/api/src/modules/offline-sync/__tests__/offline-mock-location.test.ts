import { randomBytes } from "node:crypto";
import {
  canonicalizeOfflineEvent,
  generateOfflineSigningKeyPair,
  signOfflineEvent,
  verifyOfflineEventSignature,
  type OfflineEventSignablePayload,
} from "@fieldmaster/shared-validation";

/** An offline clock-in as a pre-Step 9 app signed it (no mockLocationState). */
const LEGACY_EVENT: OfflineEventSignablePayload = {
  clientEventId: "evt-1",
  eventType: "CLOCK_IN",
  shiftId: "0192f0aa-0000-7000-8000-000000000001",
  deviceTimestamp: "2026-10-13T05:00:00.000Z",
  latitude: 32.0858,
  longitude: 34.7818,
  accuracyMeters: 12,
  mockLocationSuspected: false,
};

/** The exact bytes such an event was signed over before Step 9 (sorted keys, no undefined fields). */
const LEGACY_CANONICAL =
  '{"accuracyMeters":12,"clientEventId":"evt-1","deviceTimestamp":"2026-10-13T05:00:00.000Z","eventType":"CLOCK_IN",' +
  '"latitude":32.0858,"longitude":34.7818,"mockLocationSuspected":false,"shiftId":"0192f0aa-0000-7000-8000-000000000001"}';

const keyPair = generateOfflineSigningKeyPair((length) => new Uint8Array(randomBytes(length)));

describe("offline events: the optional mockLocationState (Step 9)", () => {
  it("leaves the canonical form of an event without it unchanged, also when the server passes the absent field through as undefined", () => {
    expect(canonicalizeOfflineEvent(LEGACY_EVENT)).toBe(LEGACY_CANONICAL);
    // OfflineSyncService rebuilds the payload with `mockLocationState: event.mockLocationState` (undefined here).
    expect(canonicalizeOfflineEvent({ ...LEGACY_EVENT, mockLocationState: undefined })).toBe(LEGACY_CANONICAL);

    const legacySignature = signOfflineEvent(LEGACY_CANONICAL, keyPair.secretKeyBase64);
    const rebuilt = canonicalizeOfflineEvent({ ...LEGACY_EVENT, mockLocationState: undefined });
    expect(verifyOfflineEventSignature(rebuilt, legacySignature, keyPair.publicKeyBase64)).toBe(true);
  });

  it("is signed like every other field: a verdict changed after signing (DETECTED -> NOT_DETECTED) fails verification", () => {
    const signed = { ...LEGACY_EVENT, mockLocationState: "DETECTED" };
    const canonical = canonicalizeOfflineEvent(signed);
    expect(canonical).toContain('"mockLocationState":"DETECTED"');
    const signature = signOfflineEvent(canonical, keyPair.secretKeyBase64);

    expect(verifyOfflineEventSignature(canonicalizeOfflineEvent(signed), signature, keyPair.publicKeyBase64)).toBe(true);
    const tampered = canonicalizeOfflineEvent({ ...signed, mockLocationState: "NOT_DETECTED" });
    expect(verifyOfflineEventSignature(tampered, signature, keyPair.publicKeyBase64)).toBe(false);
    const dropped = canonicalizeOfflineEvent({ ...signed, mockLocationState: undefined });
    expect(verifyOfflineEventSignature(dropped, signature, keyPair.publicKeyBase64)).toBe(false);
  });
});
