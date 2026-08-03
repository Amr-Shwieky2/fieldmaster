const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Dependency-free base64 codec (no `Buffer`, no `atob`/`btoa`) so it behaves
 * identically on the API (Node), the admin web app (browser), and the
 * mobile app (Hermes/React Native, where neither global is guaranteed to
 * exist) -- all three need to agree byte-for-byte when encoding/decoding
 * Ed25519 keys and signatures for offline-event verification.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    const triplet = (b1 << 16) | ((b2 ?? 0) << 8) | (b3 ?? 0);
    result += BASE64_CHARS[(triplet >> 18) & 0x3f];
    result += BASE64_CHARS[(triplet >> 12) & 0x3f];
    result += b2 !== undefined ? BASE64_CHARS[(triplet >> 6) & 0x3f] : "=";
    result += b3 !== undefined ? BASE64_CHARS[triplet & 0x3f] : "=";
  }
  return result;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "").replace(/[^A-Za-z0-9+/]/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
