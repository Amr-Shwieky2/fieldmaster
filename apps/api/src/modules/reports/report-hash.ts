import { createHash } from "node:crypto";

/**
 * A deterministic serialization of a report's source data: object keys in
 * sorted order at every depth, dates as ISO strings, undefined properties
 * left out (as in JSON), array order kept (the loaders order every list).
 * The same data always gives the same bytes, so the same SHA-256.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : normalize(item)));
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) sorted[key] = normalize(item);
    }
    return sorted;
  }
  return value;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
