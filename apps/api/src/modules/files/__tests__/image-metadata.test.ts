import { deflateSync } from "node:zlib";
import { InvalidFileStructureError, stripJpegMetadata, stripMetadata, stripPngMetadata } from "../image-metadata";

/** 8x8 baseline JPEG (ImageMagick, -strip): APP0 JFIF, 2 DQT, SOF0, 4 DHT, SOS, scan data, EOI. */
const BASELINE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCCAtQL/9k=",
  "base64",
);
/** 16x16 progressive JPEG (ImageMagick, -interlace JPEG): ten scans, with Huffman tables between them. */
const PROGRESSIVE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAAQABADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAQG/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/aAAwDAQACEAMQAAABz6Mmv//EABUQAQEAAAAAAAAAAAAAAAAAAAAS/9oACAEBAAEFAqUpT//EABYRAAMAAAAAAAAAAAAAAAAAAAAVYf/aAAgBAwEBPwFpT//EABYRAAMAAAAAAAAAAAAAAAAAAAAVYf/aAAgBAgEBPwFRD//EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEABj8CH//EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEAAT8hB//aAAwDAQACAAMAAAAQx//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8QH//EABUQAQEAAAAAAAAAAAAAAAAAAABx/9oACAEBAAE/ELWpT//Z",
  "base64",
);

const SECRET = "GPS 31.7683N 35.2137E home-address";

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** A real (minimal) Exif block: "Exif\0\0" and a little-endian TIFF with one IFD0 entry, ImageDescription. */
function exifPayload(text: string): Buffer {
  const description = Buffer.from(`${text}\0`, "latin1");
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x010e, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(description.length, 14);
  tiff.writeUInt32LE(tiff.length, 18);
  tiff.writeUInt32LE(0, 22);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff, description]);
}

const EXIF = segment(0xe1, exifPayload(SECRET));
const XMP = segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description exif:GPSLatitude="${SECRET}"/></x:xmpmeta>`, "latin1"));
const IPTC = segment(0xed, Buffer.from(`Photoshop 3.0\x008BIM\x04\x04\x00\x00\x00\x00\x00\x10${SECRET}`, "latin1"));
const COMMENT = segment(0xfe, Buffer.from(SECRET, "latin1"));
const ICC = segment(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01fake-color-profile", "latin1"));
const MPF = segment(0xe2, Buffer.from(`MPF\0II*\0${SECRET}`, "latin1"));
const ADOBE = segment(0xee, Buffer.from("Adobe\0\x64\x00\x00\x00\x00\x01", "latin1"));

const SOI = Buffer.from([0xff, 0xd8]);
/** The baseline JPEG's APP0 (JFIF) segment: bytes 2..19. */
const JFIF = BASELINE_JPEG.subarray(2, 20);
const AFTER_JFIF = BASELINE_JPEG.subarray(20);

function hasSecret(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from(SECRET, "latin1")) || bytes.includes(Buffer.from("Exif\0\0", "latin1"));
}

describe("stripJpegMetadata", () => {
  it("drops Exif and XMP (APP1), IPTC (APP13) and comments (COM), keeping every other byte", () => {
    const withMetadata = Buffer.concat([SOI, EXIF, JFIF, XMP, COMMENT, IPTC, AFTER_JFIF]);
    expect(hasSecret(withMetadata)).toBe(true);

    const stripped = stripJpegMetadata(withMetadata);
    expect(stripped.equals(BASELINE_JPEG)).toBe(true);
    expect(hasSecret(stripped)).toBe(false);
  });

  it("keeps the ICC profile (APP2) and the Adobe color transform (APP14), drops the multi-picture index", () => {
    const stripped = stripJpegMetadata(Buffer.concat([SOI, JFIF, ICC, MPF, ADOBE, EXIF, AFTER_JFIF]));
    expect(stripped.equals(Buffer.concat([SOI, JFIF, ICC, ADOBE, AFTER_JFIF]))).toBe(true);
  });

  it("drops whatever follows EOI (multi-picture images, motion-photo videos)", () => {
    const trailer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from(`ftypmp42 ${SECRET}`, "latin1")]);
    expect(stripJpegMetadata(Buffer.concat([BASELINE_JPEG, trailer])).equals(BASELINE_JPEG)).toBe(true);
  });

  it("an image without metadata comes back byte for byte", () => {
    expect(stripJpegMetadata(BASELINE_JPEG).equals(BASELINE_JPEG)).toBe(true);
    expect(stripJpegMetadata(PROGRESSIVE_JPEG).equals(PROGRESSIVE_JPEG)).toBe(true);
  });

  it("walks every scan of a progressive JPEG and drops metadata between scans too", () => {
    // Insert a comment and an Exif segment right before the second scan's Huffman table.
    const secondScanTables = PROGRESSIVE_JPEG.indexOf(Buffer.from([0xff, 0xc4]), PROGRESSIVE_JPEG.indexOf(Buffer.from([0xff, 0xda])));
    const withMetadata = Buffer.concat([PROGRESSIVE_JPEG.subarray(0, secondScanTables), COMMENT, EXIF, PROGRESSIVE_JPEG.subarray(secondScanTables)]);
    expect(stripJpegMetadata(withMetadata).equals(PROGRESSIVE_JPEG)).toBe(true);
  });

  it("copies scan data with stuffed bytes and restart markers unchanged, and tolerates fill bytes before markers", () => {
    const scanHeader = segment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
    const scanData = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56, 0xff, 0x00]);
    const secondScan = Buffer.from([0x78, 0x9a]);
    const input = Buffer.concat([
      SOI,
      JFIF,
      scanHeader,
      scanData,
      Buffer.from([0xff, 0xff]),
      COMMENT,
      scanHeader,
      secondScan,
      Buffer.from([0xff, 0xff, 0xd9]),
      Buffer.from("trailer"),
    ]);
    const expected = Buffer.concat([SOI, JFIF, scanHeader, scanData, scanHeader, secondScan, Buffer.from([0xff, 0xd9])]);
    expect(stripJpegMetadata(input).equals(expected)).toBe(true);
  });

  it("keeps the image data of a truncated JPEG (no EOI) as received", () => {
    const truncated = BASELINE_JPEG.subarray(0, BASELINE_JPEG.length - 2);
    expect(stripJpegMetadata(Buffer.concat([SOI, EXIF, truncated.subarray(2)])).equals(truncated)).toBe(true);
  });

  it("refuses files that only start like a JPEG", () => {
    const malformed = [
      Buffer.from([0xff, 0xd8, 0xff]),
      // A segment longer than the file.
      Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0x40, 0x00]), Buffer.from("Exif")]),
      // A length below 2.
      Buffer.concat([SOI, Buffer.from([0xff, 0xe0, 0x00, 0x01, 0x00])]),
      // Bytes where a marker must be.
      Buffer.concat([SOI, Buffer.from("this is not a marker")]),
      // Headers only: no scan, so no image.
      Buffer.concat([SOI, JFIF, Buffer.from([0xff, 0xd9])]),
      // A second SOI.
      Buffer.concat([SOI, JFIF, SOI, AFTER_JFIF]),
      Buffer.from("not a jpeg at all"),
    ];
    for (const bytes of malformed) expect(() => stripJpegMetadata(bytes)).toThrow(InvalidFileStructureError);
  });
});

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

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function chunkCrcIsValid(bytes: Buffer, offset: number): boolean {
  const length = bytes.readUInt32BE(offset);
  return crc32(bytes.subarray(offset + 4, offset + 8 + length)) === bytes.readUInt32BE(offset + 8 + length);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 1x1, 8-bit RGB. */
const IHDR = chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
const IDAT = chunk("IDAT", deflateSync(Buffer.from([0, 0x33, 0x66, 0xcc])));
const IEND = chunk("IEND", Buffer.alloc(0));
const GAMA = chunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f]));
const PHYS = chunk("pHYs", Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]));
const TEXT = chunk("tEXt", Buffer.from(`Comment\0${SECRET}`, "latin1"));
const ZTXT = chunk("zTXt", Buffer.concat([Buffer.from("Author\0\0", "latin1"), deflateSync(Buffer.from(SECRET))]));
const ITXT = chunk("iTXt", Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${SECRET}`, "latin1"));
const EXIF_CHUNK = chunk("eXIf", exifPayload(SECRET).subarray(6));
const TIME = chunk("tIME", Buffer.from([0x07, 0xea, 10, 13, 4, 22, 0]));

describe("stripPngMetadata", () => {
  it("drops tEXt, zTXt, iTXt, eXIf and tIME, keeping every other chunk byte for byte (CRCs unchanged)", () => {
    const input = Buffer.concat([PNG_SIGNATURE, IHDR, TEXT, GAMA, ZTXT, ITXT, EXIF_CHUNK, TIME, PHYS, IDAT, TEXT, IEND]);
    expect(input.includes(Buffer.from(SECRET, "latin1"))).toBe(true);

    const stripped = stripPngMetadata(input);
    expect(stripped.equals(Buffer.concat([PNG_SIGNATURE, IHDR, GAMA, PHYS, IDAT, IEND]))).toBe(true);
    expect(stripped.includes(Buffer.from(SECRET, "latin1"))).toBe(false);

    let offset = PNG_SIGNATURE.length;
    while (offset < stripped.length) {
      expect(chunkCrcIsValid(stripped, offset)).toBe(true);
      offset += 12 + stripped.readUInt32BE(offset);
    }
  });

  it("drops bytes after IEND", () => {
    const clean = Buffer.concat([PNG_SIGNATURE, IHDR, IDAT, IEND]);
    expect(stripPngMetadata(Buffer.concat([clean, Buffer.from(SECRET)])).equals(clean)).toBe(true);
  });

  it("refuses files that only start like a PNG", () => {
    const malformed = [
      // No IEND.
      Buffer.concat([PNG_SIGNATURE, IHDR, IDAT]),
      // IHDR is not first.
      Buffer.concat([PNG_SIGNATURE, GAMA, IHDR, IDAT, IEND]),
      // No image data.
      Buffer.concat([PNG_SIGNATURE, IHDR, IEND]),
      // A chunk longer than the file.
      Buffer.concat([PNG_SIGNATURE, IHDR, Buffer.from([0, 0, 0x10, 0, 0x74, 0x45, 0x58, 0x74]), Buffer.alloc(8)]),
      // A chunk type that is not four letters.
      Buffer.concat([PNG_SIGNATURE, IHDR, chunk("t3Xt", Buffer.from("x")), IDAT, IEND]),
      PNG_SIGNATURE,
    ];
    for (const bytes of malformed) expect(() => stripPngMetadata(bytes)).toThrow(InvalidFileStructureError);
  });
});

describe("stripMetadata", () => {
  it("strips images by their detected type and stores PDFs as received", () => {
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj << /Author (${SECRET}) >> endobj\n%%EOF\n`, "latin1");
    expect(stripMetadata(pdf, "application/pdf")).toBe(pdf);
    expect(stripMetadata(Buffer.concat([SOI, EXIF, BASELINE_JPEG.subarray(2)]), "image/jpeg").equals(BASELINE_JPEG)).toBe(true);
    expect(stripMetadata(Buffer.concat([PNG_SIGNATURE, IHDR, TEXT, IDAT, IEND]), "image/png").equals(Buffer.concat([PNG_SIGNATURE, IHDR, IDAT, IEND]))).toBe(
      true,
    );
  });
});
