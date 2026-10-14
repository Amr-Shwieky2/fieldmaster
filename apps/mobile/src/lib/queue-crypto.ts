import nacl from "tweetnacl";
import { base64ToBytes, bytesToBase64 } from "@fieldmaster/shared-validation";

/**
 * Encryption at rest for the offline queue (spec 20.1).
 *
 * The queue is one JSON document, sealed with tweetnacl's `secretbox`
 * (XSalsa20-Poly1305, authenticated encryption) under a random 32-byte key
 * that lives only in the Keychain / Keystore (expo-secure-store, key
 * `fieldmaster.offlineQueueKey`). AsyncStorage holds only the envelope
 * `{ v: 1, nonce, box }` (base64), with a fresh random 24-byte nonce on
 * every write. Any change to the stored bytes makes `open` fail (Poly1305),
 * so tampering is detected, never silently accepted.
 *
 * Why not SQLCipher / expo-sqlite (the storage the spec names):
 * - expo-sqlite is not a dependency of this app, and SQLCipher needs its
 *   config plugin plus a custom native build: it would not run in Expo Go
 *   (the way the app is tried on a phone today), and expo-sqlite's web
 *   backend needs cross-origin isolation headers the web stand-in does not
 *   have.
 * - The queue is small (the waiting events plus at most 100 resolved ones),
 *   so re-sealing the whole document on each change is cheap, and a
 *   database adds nothing a JSON document does not do here.
 * - tweetnacl is the audited pure-JS library the app already uses for the
 *   Ed25519 event signatures: the same code runs on Hermes, the web and Jest,
 *   with no new native module.
 * - The key is as safe as the session tokens (Keychain / Keystore). On the
 *   web stand-in the key sits in AsyncStorage next to the data, so the web
 *   gets no real protection: it is a development target only.
 * - Each event is also signed with the device key (Ed25519), so even someone
 *   holding both keys cannot change an event without the server noticing.
 */

export const QUEUE_ENVELOPE_VERSION = 1;
export const QUEUE_KEY_BYTES = nacl.secretbox.keyLength; // 32
export const QUEUE_NONCE_BYTES = nacl.secretbox.nonceLength; // 24

export interface QueueEnvelope {
  v: typeof QUEUE_ENVELOPE_VERSION;
  /** base64, 24 bytes, new on every write. */
  nonce: string;
  /** base64 secretbox output (ciphertext + 16-byte Poly1305 tag). */
  box: string;
}

/** Thrown when an envelope cannot be opened: tampered bytes, the wrong key, or not an envelope at all. */
export class QueueDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueDecryptError";
  }
}

export type RandomBytes = (length: number) => Uint8Array;

export function isQueueEnvelope(value: unknown): value is QueueEnvelope {
  const candidate = value as Partial<QueueEnvelope> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.v === QUEUE_ENVELOPE_VERSION &&
    typeof candidate.nonce === "string" &&
    typeof candidate.box === "string"
  );
}

/** A new random queue key, base64 (what is stored in secure storage). */
export function generateQueueKey(randomBytes: RandomBytes): string {
  return bytesToBase64(randomBytes(QUEUE_KEY_BYTES));
}

/** The key bytes from their stored base64 form, or null when the stored value is not a 32-byte key. */
export function decodeQueueKey(stored: string): Uint8Array | null {
  const bytes = base64ToBytes(stored);
  return bytes.length === QUEUE_KEY_BYTES ? bytes : null;
}

/** Seals any JSON value. */
export function sealJson(value: unknown, key: Uint8Array, randomBytes: RandomBytes): QueueEnvelope {
  const nonce = randomBytes(QUEUE_NONCE_BYTES);
  const box = nacl.secretbox(utf8Encode(JSON.stringify(value)), nonce, key);
  return { v: QUEUE_ENVELOPE_VERSION, nonce: bytesToBase64(nonce), box: bytesToBase64(box) };
}

/** Opens an envelope sealed by `sealJson`; throws QueueDecryptError when it was changed or the key is wrong. */
export function openJson(envelope: unknown, key: Uint8Array): unknown {
  if (!isQueueEnvelope(envelope)) throw new QueueDecryptError("Not a queue envelope.");
  const nonce = base64ToBytes(envelope.nonce);
  if (nonce.length !== QUEUE_NONCE_BYTES) throw new QueueDecryptError("Malformed nonce.");
  const opened = nacl.secretbox.open(base64ToBytes(envelope.box), nonce, key);
  if (!opened) throw new QueueDecryptError("The queue could not be authenticated (changed, or another key).");
  try {
    return JSON.parse(utf8Decode(opened));
  } catch {
    throw new QueueDecryptError("The queue content is not JSON.");
  }
}

// ── UTF-8 without TextEncoder/TextDecoder (not guaranteed on every Hermes version) ──

export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) as number;
    if (code > 0xffff) i++; // the second half of a surrogate pair is already in `code`
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  const units: number[] = [];
  let out = "";
  const flush = () => {
    out += String.fromCharCode(...units);
    units.length = 0;
  };
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    let code: number;
    if (b0 < 0x80) code = b0;
    else if (b0 >= 0xc0 && b0 < 0xe0) code = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b0 >= 0xe0 && b0 < 0xf0) code = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (b0 >= 0xf0 && b0 < 0xf8)
      code = ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else throw new Error("Invalid UTF-8.");
    if (code > 0xffff) {
      code -= 0x10000;
      units.push(0xd800 | (code >> 10), 0xdc00 | (code & 0x3ff));
    } else {
      units.push(code);
    }
    if (units.length >= 4096) flush();
  }
  flush();
  return out;
}
