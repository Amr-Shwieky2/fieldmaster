import { DetectedContentType, PNG_MAGIC, startsWith } from "./content-type";

/**
 * Metadata stripping for uploaded images (Step 8), without a native
 * dependency: the file is walked segment by segment (JPEG) or chunk by chunk
 * (PNG) and the metadata parts are left out. Everything else -- in
 * particular the compressed image data -- is copied byte for byte, so the
 * result decodes to exactly the same pixels.
 */

/** The bytes start like the detected type but are not a well-formed file of it. */
export class InvalidFileStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFileStructureError";
  }
}

const MARKER_PREFIX = 0xff;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const TEM = 0x01;
/** Exif and XMP (including extended XMP). */
const APP1 = 0xe1;
/** ICC color profile (kept) or the multi-picture index "MPF" (dropped). */
const APP2 = 0xe2;
/** Photoshop image resources: IPTC captions, keywords, locations. */
const APP13 = 0xed;
const COM = 0xfe;
const MPF_IDENTIFIER = Buffer.from("MPF\0", "latin1");

function isRestartMarker(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

function isJpegMetadataSegment(marker: number, payload: Buffer): boolean {
  if (marker === APP1 || marker === APP13 || marker === COM) return true;
  // The multi-picture index points at extra images stored after EOI, which are dropped with the rest of the trailer.
  return marker === APP2 && startsWith(payload, MPF_IDENTIFIER);
}

/**
 * Where the entropy-coded data that starts at `start` ends: the offset of the
 * next marker. Inside scan data a 0xFF data byte is always followed by a
 * stuffed 0x00, and restart markers (FFD0-FFD7) are part of the data;
 * anything else after 0xFF (and its fill bytes) is a marker. Without one, the
 * data runs to the end of the file (a truncated JPEG).
 */
function endOfScanData(bytes: Buffer, start: number): number {
  let i = start;
  while (i < bytes.length) {
    if (bytes[i] !== MARKER_PREFIX) {
      i++;
      continue;
    }
    let next = i + 1;
    while (next < bytes.length && bytes[next] === MARKER_PREFIX) next++;
    if (next >= bytes.length) return bytes.length;
    const code = bytes[next];
    if (code === 0x00 || isRestartMarker(code)) {
      i = next + 1;
      continue;
    }
    return i;
  }
  return bytes.length;
}

/**
 * A JPEG without its metadata: APP1 (Exif -- camera, time, GPS location,
 * embedded thumbnail -- and XMP), APP13 (IPTC) and COM segments are left out,
 * wherever they appear (normally before the scan data, in progressive files
 * possibly between scans). Every other segment (JFIF, quantization and
 * Huffman tables, frame and scan headers, ICC profile, Adobe color transform)
 * and all entropy-coded scan data are copied unchanged. Bytes after EOI
 * (multi-picture images, motion-photo videos and other trailers) are not part
 * of the image and are dropped too.
 */
export function stripJpegMetadata(bytes: Buffer): Buffer {
  if (bytes.length < 4 || bytes[0] !== MARKER_PREFIX || bytes[1] !== SOI) {
    throw new InvalidFileStructureError("Not a JPEG file.");
  }
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let sawScan = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== MARKER_PREFIX) throw new InvalidFileStructureError("Malformed JPEG: expected a marker.");
    // A marker may be preceded by fill bytes (extra 0xFF); they are not copied.
    while (offset < bytes.length && bytes[offset] === MARKER_PREFIX) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset++;

    if (marker === EOI) {
      kept.push(Buffer.from([MARKER_PREFIX, EOI]));
      return withImageData(kept, sawScan);
    }
    if (marker === SOI || marker === 0x00) throw new InvalidFileStructureError("Malformed JPEG: unexpected marker.");
    if (isRestartMarker(marker) || marker === TEM) {
      // Standalone markers: no length field.
      kept.push(Buffer.from([MARKER_PREFIX, marker]));
      continue;
    }

    if (offset + 2 > bytes.length) throw new InvalidFileStructureError("Malformed JPEG: truncated segment.");
    const length = bytes.readUInt16BE(offset);
    const segmentEnd = offset + length;
    if (length < 2 || segmentEnd > bytes.length) throw new InvalidFileStructureError("Malformed JPEG: bad segment length.");
    if (!isJpegMetadataSegment(marker, bytes.subarray(offset + 2, segmentEnd))) {
      kept.push(Buffer.from([MARKER_PREFIX, marker]), bytes.subarray(offset, segmentEnd));
    }
    offset = segmentEnd;

    if (marker === SOS) {
      sawScan = true;
      const dataEnd = endOfScanData(bytes, offset);
      kept.push(bytes.subarray(offset, dataEnd));
      offset = dataEnd;
    }
  }
  // No EOI: a truncated file, whose image data is kept as received.
  return withImageData(kept, sawScan);
}

function withImageData(kept: Buffer[], sawScan: boolean): Buffer {
  if (!sawScan) throw new InvalidFileStructureError("Malformed JPEG: no image data.");
  return Buffer.concat(kept);
}

/** Text (tEXt, zTXt, iTXt), Exif (eXIf) and the last-modification time (tIME). */
const PNG_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
const PNG_CHUNK_TYPE = /^[A-Za-z]{4}$/;
/** Length, type and CRC fields of a chunk. */
const PNG_CHUNK_OVERHEAD = 12;
const PNG_MAX_CHUNK_LENGTH = 0x7fffffff;

/**
 * A PNG without its metadata chunks (tEXt, zTXt, iTXt, eXIf, tIME). Every
 * other chunk -- the critical IHDR, PLTE, IDAT and IEND, and ancillary ones
 * such as gAMA, sRGB, iCCP, pHYs or tRNS -- is copied unchanged, CRC
 * included (a chunk's CRC covers only its own type and data, so leaving
 * other chunks out does not change it). Bytes after IEND are dropped.
 */
export function stripPngMetadata(bytes: Buffer): Buffer {
  if (!startsWith(bytes, PNG_MAGIC)) throw new InvalidFileStructureError("Not a PNG file.");
  const kept: Buffer[] = [bytes.subarray(0, PNG_MAGIC.length)];
  let offset = PNG_MAGIC.length;
  let sawHeader = false;
  let sawImageData = false;

  while (offset + PNG_CHUNK_OVERHEAD <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const chunkEnd = offset + PNG_CHUNK_OVERHEAD + length;
    if (length > PNG_MAX_CHUNK_LENGTH || !PNG_CHUNK_TYPE.test(type) || chunkEnd > bytes.length) {
      throw new InvalidFileStructureError("Malformed PNG chunk.");
    }
    if (!sawHeader && type !== "IHDR") throw new InvalidFileStructureError("Malformed PNG: the first chunk must be IHDR.");
    sawHeader = true;
    if (type === "IDAT") sawImageData = true;
    if (!PNG_METADATA_CHUNKS.has(type)) kept.push(bytes.subarray(offset, chunkEnd));
    offset = chunkEnd;

    if (type === "IEND") {
      if (!sawImageData) throw new InvalidFileStructureError("Malformed PNG: no image data.");
      return Buffer.concat(kept);
    }
  }
  throw new InvalidFileStructureError("Malformed PNG: no IEND chunk.");
}

/**
 * The bytes to store for an upload of a detected type: images without their
 * metadata. PDFs are stored as received: removing a PDF's metadata (the
 * document information dictionary, XMP streams, earlier revisions kept by
 * incremental updates) safely needs a PDF parser and writer, which the API
 * does not ship. A PDF identity document is only ever shown to Owners,
 * through a short-lived signed URL. Audio (Step 9 voice summaries) is stored
 * as received too: a recording the phone just made carries no location or
 * camera data, and rewriting a container needs a media library.
 */
export function stripMetadata(bytes: Buffer, contentType: DetectedContentType): Buffer {
  switch (contentType) {
    case DetectedContentType.JPEG:
      return stripJpegMetadata(bytes);
    case DetectedContentType.PNG:
      return stripPngMetadata(bytes);
    case DetectedContentType.PDF:
    case DetectedContentType.MP4_AUDIO:
    case DetectedContentType.WEBM_AUDIO:
    case DetectedContentType.OGG_AUDIO:
    case DetectedContentType.WAV_AUDIO:
    case DetectedContentType.MP3_AUDIO:
      return bytes;
  }
}
