import { UPLOAD_CONTENT_TYPES } from "@fieldmaster/shared-types";
import { detectContentType, isAudioContentType } from "../content-type";
import { stripMetadata } from "../image-metadata";

/** The first bytes of real recordings of each container (as the phone, the web target or a desktop recorder writes them). */
const SAMPLES = {
  // iOS / Android (expo-audio, AAC in MP4): size 0x1C, "ftyp", major brand "M4A ".
  m4a: Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00, 0x4d, 0x34, 0x41, 0x20]),
  // An MP4 written with the generic brand "isom" (some Android recorders).
  isom: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from("ftypisom\x00\x00\x02\x00isomiso2mp41", "latin1")]),
  // Chrome's MediaRecorder: the EBML header of a WebM file.
  webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]),
  // Firefox's MediaRecorder: an Ogg page (Opus).
  ogg: Buffer.from("OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00OpusHead", "latin1"),
  // PCM WAV: "RIFF" + little-endian size + "WAVE" + the fmt chunk.
  wav: Buffer.from("RIFF\x24\x08\x00\x00WAVEfmt \x10\x00\x00\x00", "latin1"),
  // MP3 with an ID3v2.4 tag.
  mp3Id3: Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1"),
  // MP3 without a tag: MPEG-1 Layer III, 128 kbit/s, 44.1 kHz frame header (FF FB 90 64).
  mp3Frame: Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]),
} as const;

describe("detectContentType: Step 9 audio (magic bytes, never the name or the claimed mimetype)", () => {
  it("recognizes MP4/M4A by `ftyp` at offset 4", () => {
    expect(detectContentType(SAMPLES.m4a)).toBe("audio/mp4");
    expect(detectContentType(SAMPLES.isom)).toBe("audio/mp4");
  });

  it("recognizes WebM/Matroska, Ogg and WAV", () => {
    expect(detectContentType(SAMPLES.webm)).toBe("audio/webm");
    expect(detectContentType(SAMPLES.ogg)).toBe("audio/ogg");
    expect(detectContentType(SAMPLES.wav)).toBe("audio/wav");
  });

  it("recognizes MP3 by an ID3 tag or an MPEG audio frame header", () => {
    expect(detectContentType(SAMPLES.mp3Id3)).toBe("audio/mpeg");
    expect(detectContentType(SAMPLES.mp3Frame)).toBe("audio/mpeg");
  });

  it("refuses look-alikes: a HEIC photo, a WebP image, an AAC ADTS stream, reserved frame headers, truncated signatures", () => {
    for (const bytes of [
      // HEIC (an iPhone photo) is an ISO base media file too, but its brand is an image one.
      Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypheic\x00\x00\x00\x00mif1heic", "latin1")]),
      Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x1c]), Buffer.from("ftypavif\x00\x00\x00\x00avifmif1", "latin1")]),
      // RIFF, but not WAVE.
      Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1"),
      Buffer.from("RIFF\x00\x00\x00\x00AVI LIST", "latin1"),
      // AAC ADTS (layer 00) is not MPEG audio layer I-III.
      Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]),
      // Bitrate index 1111 (bad) and sample rate index 11 (reserved).
      Buffer.from([0xff, 0xfb, 0xf0, 0x64]),
      Buffer.from([0xff, 0xfb, 0x9c, 0x64]),
      // MPEG version 01 (reserved).
      Buffer.from([0xff, 0xeb, 0x90, 0x64]),
      Buffer.from("ftyp", "latin1"),
      Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79]),
      Buffer.from("Ogg", "latin1"),
      Buffer.from([0x1a, 0x45, 0xdf]),
      Buffer.from("ID", "latin1"),
      Buffer.from([0xff, 0xfb]),
    ]) {
      expect(detectContentType(bytes)).toBeNull();
    }
  });

  it("keeps the image and PDF signatures first: a JPEG is never read as an MPEG frame", () => {
    expect(detectContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("image/jpeg");
    expect(isAudioContentType("image/jpeg")).toBe(false);
    expect(isAudioContentType("audio/mp4")).toBe(true);
  });

  it("every detected audio type is one the voice summary accepts, and none of them is an attendance photo or an onboarding file", () => {
    const voice: readonly string[] = UPLOAD_CONTENT_TYPES.VOICE_SUMMARY;
    const photo: readonly string[] = UPLOAD_CONTENT_TYPES.ATTENDANCE_PHOTO;
    const onboarding: readonly string[] = [...UPLOAD_CONTENT_TYPES.IDENTITY_DOCUMENT, ...UPLOAD_CONTENT_TYPES.PROFILE_PHOTO];
    for (const sample of Object.values(SAMPLES)) {
      const type = detectContentType(sample)!;
      expect(voice).toContain(type);
      expect(photo).not.toContain(type);
      expect(onboarding).not.toContain(type);
    }
  });

  it("stores audio exactly as received", () => {
    for (const sample of Object.values(SAMPLES)) {
      expect(stripMetadata(sample, detectContentType(sample)!)).toBe(sample);
    }
  });
});
