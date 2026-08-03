import nacl from "tweetnacl";
import { base64ToBytes, bytesToBase64 } from "./base64";

export interface OfflineEventSignablePayload {
  clientEventId: string;
  eventType: string;
  shiftId?: string | null;
  temporaryCheckInPointId?: string | null;
  deviceTimestamp: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  altitude?: number | null;
  locationProvider?: string | null;
  mockLocationSuspected?: boolean;
  appVersion?: string | null;
  summaryText?: string | null;
  voiceNoteUrl?: string | null;
  taskCategory?: string | null;
  materialsUsed?: string | null;
  problemsEncountered?: string | null;
  followUpRequired?: boolean;
}

/**
 * Deterministic (sorted-key, `undefined`-stripped) JSON encoding of an
 * offline clock event. Both the mobile client (signing, while offline) and
 * the API (verifying, at sync time) call this exact function so they always
 * hash/sign identical bytes for the same logical event -- object key order
 * in the caller's source code must never matter.
 */
export function canonicalizeOfflineEvent(payload: OfflineEventSignablePayload): string {
  const record = payload as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined) sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

export interface OfflineSigningKeyPair {
  publicKeyBase64: string;
  secretKeyBase64: string;
}

/**
 * Ed25519 keypair generation for a device's offline-event signing key.
 * `randomBytes` must be a cryptographically secure source (Node's
 * `crypto.randomBytes` on the API -- not actually used there, keys are only
 * ever generated on-device -- or `expo-crypto`'s `getRandomBytes` on
 * mobile). tweetnacl itself has no ambient RNG in React Native, unlike Node
 * or a browser, so the caller must supply one explicitly rather than
 * relying on tweetnacl's environment auto-detection.
 */
export function generateOfflineSigningKeyPair(randomBytes: (length: number) => Uint8Array): OfflineSigningKeyPair {
  const seed = randomBytes(32);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  return {
    publicKeyBase64: bytesToBase64(keyPair.publicKey),
    secretKeyBase64: bytesToBase64(keyPair.secretKey),
  };
}

/** Signs the canonical bytes of an offline event with the device's private key. */
export function signOfflineEvent(canonicalPayload: string, secretKeyBase64: string): string {
  const message = utf8ToBytes(canonicalPayload);
  const secretKey = base64ToBytes(secretKeyBase64);
  const signature = nacl.sign.detached(message, secretKey);
  return bytesToBase64(signature);
}

/** Verifies an offline event's signature against the device's registered public key. */
export function verifyOfflineEventSignature(canonicalPayload: string, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    const message = utf8ToBytes(canonicalPayload);
    const signature = base64ToBytes(signatureBase64);
    const publicKey = base64ToBytes(publicKeyBase64);
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

/** Minimal UTF-8 encoder that doesn't depend on `TextEncoder` being global (Hermes has it, but keep this self-contained). */
function utf8ToBytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.codePointAt(i)!;
    if (code > 0xffff) i++; // surrogate pair already consumed by codePointAt
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}
