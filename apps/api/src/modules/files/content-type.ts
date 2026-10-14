/**
 * The type of an uploaded file, decided by its content (magic bytes) -- never by
 * its name or by the mimetype the browser claims (Step 8). Recognized: the
 * three types the onboarding page accepts (JPEG, PNG, PDF) and, since Step 9,
 * the recorded voice summaries of the mobile app (MP4/M4A, WebM, Ogg, WAV,
 * MP3). Anything else is null. Which type a purpose accepts is decided by
 * UPLOAD_CONTENT_TYPES, not here.
 */
export const DetectedContentType = {
  JPEG: "image/jpeg",
  PNG: "image/png",
  PDF: "application/pdf",
  /** AAC in an MP4 (M4A) container: what iOS and Android record. */
  MP4_AUDIO: "audio/mp4",
  /** WebM/Matroska: the web target's MediaRecorder (Chrome, Firefox). */
  WEBM_AUDIO: "audio/webm",
  OGG_AUDIO: "audio/ogg",
  WAV_AUDIO: "audio/wav",
  MP3_AUDIO: "audio/mpeg",
} as const;
export type DetectedContentType = (typeof DetectedContentType)[keyof typeof DetectedContentType];

/** JPEG: SOI (FF D8) followed by the first marker's FF. */
export const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
/** PNG: the 8-byte signature. */
export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** PDF: the "%PDF-" header at offset 0. */
export const PDF_MAGIC = Buffer.from("%PDF-", "latin1");
/** ISO base media (MP4, M4A): the first box is `ftyp`, its type at offset 4 (after the 4-byte box size). */
export const MP4_FTYP = Buffer.from("ftyp", "latin1");
/** EBML header of WebM / Matroska. */
export const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
/** Ogg page capture pattern. */
export const OGG_MAGIC = Buffer.from("OggS", "latin1");
/** WAV: a RIFF container ("RIFF" + size) whose form type at offset 8 is "WAVE". */
export const RIFF_MAGIC = Buffer.from("RIFF", "latin1");
export const WAVE_FORM = Buffer.from("WAVE", "latin1");
/** MP3 with an ID3v2 tag in front of the first frame. */
export const ID3_MAGIC = Buffer.from("ID3", "latin1");

/**
 * Major brands of `ftyp` boxes that hold still images (HEIF / HEIC / AVIF),
 * not audio: a phone photo must never pass as a voice recording.
 */
const IMAGE_FTYP_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "avif", "avis"]);

export function startsWith(bytes: Buffer, prefix: Buffer, offset = 0): boolean {
  return bytes.length >= offset + prefix.length && bytes.subarray(offset, offset + prefix.length).equals(prefix);
}

/** An MP4/M4A file: `ftyp` at offset 4, with a major brand that is not a still-image one. */
function isMp4Audio(bytes: Buffer): boolean {
  if (!startsWith(bytes, MP4_FTYP, 4) || bytes.length < 12) return false;
  return !IMAGE_FTYP_BRANDS.has(bytes.toString("latin1", 8, 12));
}

/**
 * An MPEG audio frame header at offset 0 (an MP3 without an ID3 tag): the
 * 11-bit frame sync, then a version, layer, bitrate and sample rate that are
 * not the reserved/invalid values -- a JPEG (FF D8) or an AAC ADTS stream
 * (layer 00) does not qualify.
 */
function isMpegAudioFrame(bytes: Buffer): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[1] >> 3) & 0x03;
  const layer = (bytes[1] >> 1) & 0x03;
  const bitrateIndex = (bytes[2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[2] >> 2) & 0x03;
  return version !== 0x01 && layer !== 0x00 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03;
}

export function detectContentType(bytes: Buffer): DetectedContentType | null {
  if (startsWith(bytes, JPEG_MAGIC)) return DetectedContentType.JPEG;
  if (startsWith(bytes, PNG_MAGIC)) return DetectedContentType.PNG;
  if (startsWith(bytes, PDF_MAGIC)) return DetectedContentType.PDF;
  if (isMp4Audio(bytes)) return DetectedContentType.MP4_AUDIO;
  if (startsWith(bytes, EBML_MAGIC)) return DetectedContentType.WEBM_AUDIO;
  if (startsWith(bytes, OGG_MAGIC)) return DetectedContentType.OGG_AUDIO;
  if (startsWith(bytes, RIFF_MAGIC) && startsWith(bytes, WAVE_FORM, 8)) return DetectedContentType.WAV_AUDIO;
  if (startsWith(bytes, ID3_MAGIC) || isMpegAudioFrame(bytes)) return DetectedContentType.MP3_AUDIO;
  return null;
}

/** True for the audio types (stored as received: there is no image metadata to strip). */
export function isAudioContentType(contentType: DetectedContentType): boolean {
  return contentType.startsWith("audio/");
}
