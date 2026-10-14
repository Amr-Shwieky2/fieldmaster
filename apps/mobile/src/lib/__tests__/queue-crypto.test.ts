import { base64ToBytes, bytesToBase64 } from "@fieldmaster/shared-validation";
import {
  QUEUE_KEY_BYTES,
  QUEUE_NONCE_BYTES,
  QueueDecryptError,
  decodeQueueKey,
  generateQueueKey,
  isQueueEnvelope,
  openJson,
  sealJson,
  utf8Decode,
  utf8Encode,
} from "../queue-crypto";

const randomBytes = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length));
const newKey = () => decodeQueueKey(generateQueueKey(randomBytes)) as Uint8Array;

const EVENTS = [
  { clientEventId: "evt-1", eventType: "CLOCK_OUT", summaryText: "ركّبنا إشارتين جديدتين في شارع يافا 🚦", localStatus: "PENDING" },
  { clientEventId: "evt-2", eventType: "CLOCK_IN", latitude: 32.0853, longitude: 34.7818, localStatus: "VERIFIED" },
];

/** The same envelope with one bit of its ciphertext flipped. */
function tampered(envelope: { v: 1; nonce: string; box: string }, index = 20) {
  const box = base64ToBytes(envelope.box);
  box[index] ^= 0x01;
  return { ...envelope, box: bytesToBase64(box) };
}

describe("queue encryption (XSalsa20-Poly1305 secretbox)", () => {
  it("round-trips the queue (Arabic text and emoji included) and keeps only an opaque envelope", () => {
    const key = newKey();
    const envelope = sealJson(EVENTS, key, randomBytes);

    expect(Object.keys(envelope).sort()).toEqual(["box", "nonce", "v"]);
    expect(envelope.v).toBe(1);
    expect(base64ToBytes(envelope.nonce)).toHaveLength(QUEUE_NONCE_BYTES);
    // Nothing readable is left in what is stored.
    const stored = JSON.stringify(envelope);
    for (const secret of ["evt-1", "CLOCK_OUT", "32.0853", "شارع", "PENDING"]) expect(stored).not.toContain(secret);
    expect(isQueueEnvelope(envelope)).toBe(true);

    expect(openJson(envelope, key)).toEqual(EVENTS);
  });

  it("uses a fresh random nonce on every write, so the same queue never looks the same twice", () => {
    const key = newKey();
    const first = sealJson(EVENTS, key, randomBytes);
    const second = sealJson(EVENTS, key, randomBytes);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.box).not.toBe(second.box);
    expect(openJson(first, key)).toEqual(openJson(second, key));
  });

  it("detects any change to the stored bytes (tampered ciphertext, tag or nonce)", () => {
    const key = newKey();
    const envelope = sealJson(EVENTS, key, randomBytes);

    expect(() => openJson(tampered(envelope), key)).toThrow(QueueDecryptError);
    // The first 16 bytes are the Poly1305 tag itself.
    expect(() => openJson(tampered(envelope, 0), key)).toThrow(QueueDecryptError);
    const nonce = base64ToBytes(envelope.nonce);
    nonce[0] ^= 0xff;
    expect(() => openJson({ ...envelope, nonce: bytesToBase64(nonce) }, key)).toThrow(QueueDecryptError);
  });

  it("refuses another key", () => {
    const envelope = sealJson(EVENTS, newKey(), randomBytes);
    expect(() => openJson(envelope, newKey())).toThrow(QueueDecryptError);
  });

  it("refuses anything that is not an envelope (plain JSON, a wrong version, a short nonce)", () => {
    const key = newKey();
    const envelope = sealJson(EVENTS, key, randomBytes);
    expect(() => openJson(EVENTS, key)).toThrow(QueueDecryptError);
    expect(() => openJson({ ...envelope, v: 2 }, key)).toThrow(QueueDecryptError);
    expect(() => openJson({ ...envelope, nonce: bytesToBase64(new Uint8Array(8)) }, key)).toThrow(QueueDecryptError);
    expect(isQueueEnvelope(null)).toBe(false);
    expect(isQueueEnvelope({ v: 1, nonce: "x" })).toBe(false);
  });

  it("generates 32-byte keys and rejects a stored key of the wrong length", () => {
    const stored = generateQueueKey(randomBytes);
    expect(decodeQueueKey(stored)).toHaveLength(QUEUE_KEY_BYTES);
    expect(generateQueueKey(randomBytes)).not.toBe(stored);
    expect(decodeQueueKey(bytesToBase64(new Uint8Array(16)))).toBeNull();
    expect(decodeQueueKey("")).toBeNull();
  });

  it("encodes UTF-8 exactly like the platform (without needing TextEncoder on Hermes)", () => {
    const text = "Arabic عربي — ₪ 1,234.50 🚦 «يافا»";
    const encoded = utf8Encode(text);
    expect(Array.from(encoded)).toEqual(Array.from(new TextEncoder().encode(text)));
    expect(utf8Decode(encoded)).toBe(text);
    const long = "ي".repeat(10_000);
    expect(utf8Decode(utf8Encode(long))).toBe(long);
  });
});
