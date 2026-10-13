import { deflateSync } from "node:zlib";

/**
 * Small, real files for the onboarding e2e tests (Step 8): images that
 * decode, with the metadata a phone camera would add where a test needs it.
 */

/** 8x8 baseline JPEG without metadata (ImageMagick, -strip). */
export const BASELINE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCCAtQL/9k=",
  "base64",
);

/** What the metadata of the test photos says (a camera's GPS position). */
export const PHOTO_METADATA_SECRET = "GPS 31.7683N 35.2137E home of the applicant";

/** The baseline JPEG with an Exif block (APP1) right after SOI, as a phone camera writes it. */
export function jpegWithExif(text = PHOTO_METADATA_SECRET): Buffer {
  const description = Buffer.from(`${text}\0`, "latin1");
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  // IFD0, one entry: ImageDescription (ASCII), stored after the IFD.
  tiff.writeUInt16LE(0x010e, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(description.length, 14);
  tiff.writeUInt32LE(tiff.length, 18);
  tiff.writeUInt32LE(0, 22);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff, description]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([BASELINE_JPEG.subarray(0, 2), header, payload, BASELINE_JPEG.subarray(2)]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A 2x2 RGB PNG without metadata. */
export const CLEAN_PNG = Buffer.concat([
  PNG_SIGNATURE,
  pngChunk("IHDR", Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0])),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 0x33, 0x66, 0xcc, 0xcc, 0x66, 0x33, 0, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60]))),
  pngChunk("IEND", Buffer.alloc(0)),
]);

/** CLEAN_PNG with a tEXt chunk (and a modification time) after IHDR, as an editor writes them. */
export function pngWithText(text = PHOTO_METADATA_SECRET): Buffer {
  const afterHeader = PNG_SIGNATURE.length + 25;
  return Buffer.concat([
    CLEAN_PNG.subarray(0, afterHeader),
    pngChunk("tEXt", Buffer.from(`Comment\0${text}`, "latin1")),
    pngChunk("tIME", Buffer.from([0x07, 0xea, 10, 13, 9, 30, 0])),
    CLEAN_PNG.subarray(afterHeader),
  ]);
}

/** A one-page PDF (stored as received). */
export const SMALL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
  "latin1",
);

/** A PDF of exactly `size` bytes (padded with a comment). */
export function pdfOfSize(size: number): Buffer {
  const head = Buffer.from("%PDF-1.4\n%", "latin1");
  const tail = Buffer.from("\n%%EOF\n", "latin1");
  return Buffer.concat([head, Buffer.alloc(size - head.length - tail.length, 0x41), tail]);
}

/** A 1x1 GIF: a real image, but not a type the page accepts. */
export const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** A text file a user renamed to .jpg. */
export const TEXT_FILE = Buffer.from("Shopping list: milk, bread, olives.\n", "utf8");
