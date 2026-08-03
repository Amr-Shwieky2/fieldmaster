import { randomBytes } from "node:crypto";
import {
  canonicalizeOfflineEvent,
  generateOfflineSigningKeyPair,
  signOfflineEvent,
  verifyOfflineEventSignature,
  type OfflineEventSignablePayload,
} from "../offline-sync";
import { base64ToBytes, bytesToBase64 } from "../base64";

const testRandomBytes = (n: number) => new Uint8Array(randomBytes(n));

describe("base64 codec", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = testRandomBytes(64);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips lengths that require padding (1 and 2 extra bytes)", () => {
    for (const len of [1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = testRandomBytes(len);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });
});

describe("offline event signing (Ed25519 via tweetnacl)", () => {
  const payload: OfflineEventSignablePayload = {
    clientEventId: "evt-offline-1",
    eventType: "CLOCK_IN",
    shiftId: "shift-42",
    deviceTimestamp: "2026-02-01T05:30:00.000Z",
    latitude: 32.0809,
    longitude: 34.7806,
    accuracyMeters: 8,
    mockLocationSuspected: false,
  };

  it("generates a verifiable keypair and accepts a genuine signature", () => {
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    const canonical = canonicalizeOfflineEvent(payload);
    const signature = signOfflineEvent(canonical, keyPair.secretKeyBase64);
    expect(verifyOfflineEventSignature(canonical, signature, keyPair.publicKeyBase64)).toBe(true);
  });

  it("rejects a signature if the payload is tampered with after signing", () => {
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    const canonical = canonicalizeOfflineEvent(payload);
    const signature = signOfflineEvent(canonical, keyPair.secretKeyBase64);

    const tamperedCanonical = canonicalizeOfflineEvent({ ...payload, latitude: 40.0 });
    expect(verifyOfflineEventSignature(tamperedCanonical, signature, keyPair.publicKeyBase64)).toBe(false);
  });

  it("rejects a signature verified against the wrong device's public key", () => {
    const ownerKeyPair = generateOfflineSigningKeyPair(testRandomBytes);
    const attackerKeyPair = generateOfflineSigningKeyPair(testRandomBytes);
    const canonical = canonicalizeOfflineEvent(payload);
    const signature = signOfflineEvent(canonical, ownerKeyPair.secretKeyBase64);

    expect(verifyOfflineEventSignature(canonical, signature, attackerKeyPair.publicKeyBase64)).toBe(false);
  });

  it("rejects malformed base64 without throwing", () => {
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    const canonical = canonicalizeOfflineEvent(payload);
    expect(verifyOfflineEventSignature(canonical, "not-a-real-signature", keyPair.publicKeyBase64)).toBe(false);
  });
});
