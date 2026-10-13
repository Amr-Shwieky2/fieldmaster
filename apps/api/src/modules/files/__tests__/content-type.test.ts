import { detectContentType } from "../content-type";

describe("detectContentType (magic bytes, never the name or the claimed mimetype)", () => {
  it("recognizes JPEG, PNG and PDF by their first bytes", () => {
    expect(detectContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("image/jpeg");
    expect(detectContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("image/png");
    expect(detectContentType(Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"))).toBe("application/pdf");
  });

  it("refuses everything else, including look-alikes and truncated signatures", () => {
    for (const bytes of [
      Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"),
      Buffer.from("This is a text file renamed to photo.jpg"),
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]),
      Buffer.from("%PDF"),
      Buffer.from(" %PDF-1.4"),
      Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1"),
      Buffer.alloc(0),
    ]) {
      expect(detectContentType(bytes)).toBeNull();
    }
  });
});
