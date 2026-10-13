/**
 * The type of an uploaded file, decided by its content (magic bytes) -- never by
 * its name or by the mimetype the browser claims (Step 8). Only the three
 * types the onboarding page accepts are recognized; anything else is null.
 */
export const DetectedContentType = {
  JPEG: "image/jpeg",
  PNG: "image/png",
  PDF: "application/pdf",
} as const;
export type DetectedContentType = (typeof DetectedContentType)[keyof typeof DetectedContentType];

/** JPEG: SOI (FF D8) followed by the first marker's FF. */
export const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
/** PNG: the 8-byte signature. */
export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** PDF: the "%PDF-" header at offset 0. */
export const PDF_MAGIC = Buffer.from("%PDF-", "latin1");

export function startsWith(bytes: Buffer, prefix: Buffer): boolean {
  return bytes.length >= prefix.length && bytes.subarray(0, prefix.length).equals(prefix);
}

export function detectContentType(bytes: Buffer): DetectedContentType | null {
  if (startsWith(bytes, JPEG_MAGIC)) return DetectedContentType.JPEG;
  if (startsWith(bytes, PNG_MAGIC)) return DetectedContentType.PNG;
  if (startsWith(bytes, PDF_MAGIC)) return DetectedContentType.PDF;
  return null;
}
