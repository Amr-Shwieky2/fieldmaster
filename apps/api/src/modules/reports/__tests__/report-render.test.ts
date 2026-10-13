import { attemptReason, enumLabel, formatMessage, parseMessage, rd } from "../render/messages";
import { buildCsv, csv, CSV_BOM, shekels } from "../render/csv";
import { escapeHtml, markup, ltr, rdHtml, reportDocument, SafeHtml, userText } from "../render/html";
import { REPORT_FONT_FAMILY } from "../render/fonts";
import { countPdfPages } from "../render/pdf-renderer";
import { canonicalJson, sha256Hex } from "../report-hash";
import { DATA_HASH, REPORT_ID } from "./report-fixtures";

describe("report messages (the shared Arabic messages, a small ICU subset)", () => {
  it("fills simple arguments and refuses plural/select messages", () => {
    expect(formatMessage("من {from} إلى {to}", { from: "1", to: "2" })).toBe("من 1 إلى 2");
    expect(() => formatMessage("{a} و{b}", { a: "x" })).toThrow(/Missing value for \{b\}/);
    expect(() => parseMessage("{count, plural, one {سجل} other {سجلات}}")).toThrow(/Unsupported ICU message/);
    expect(rd("header.periodRange", { from: "أ", to: "ب" })).toBe("من أ إلى ب");
    expect(() => rd("no.such.key")).toThrow(/Missing Arabic message "reportDocuments.no.such.key"/);
  });

  it("labels enums in Arabic, an unknown value as its code, nothing as a dash", () => {
    expect(enumLabel("ReportType", "WORKER_ATTENDANCE_LEDGER")).toBe("سجل حضور العامل");
    expect(enumLabel("CorrectionReason", "BRAND_NEW_REASON")).toBe("BRAND_NEW_REASON");
    expect(enumLabel("CorrectionReason", null)).toBe("—");
  });

  it("gives a refused attempt the message the worker received, with the stored numbers", () => {
    expect(attemptReason("GEOFENCE_OUTSIDE_ALLOWED_RADIUS", { distanceMeters: 1067.4, allowedRadiusMeters: 100 })).toBe(
      "أنت خارج نطاق الموقع. المسافة: 1,067 م، المسموح: 100 م.",
    );
    expect(attemptReason("GEOFENCE_OUTSIDE_ALLOWED_RADIUS", { distanceMeters: null, allowedRadiusMeters: 100 })).toBe(
      "موقعك الحالي خارج نطاق الموقع المسموح به.",
    );
    expect(attemptReason("MOCK_LOCATION_BLOCKED", {})).toMatch(/موقعًا وهميًا/);
    expect(attemptReason("SOMETHING_NEW", {})).toBe("SOMETHING_NEW");
  });
});

describe("report HTML", () => {
  it("escapes every interpolated value and passes only SafeHtml through", () => {
    const name = '<img src=x onerror="alert(1)">';
    expect(markup`<td>${name}</td>`.value).toBe("<td>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</td>");
    expect(markup`<td>${ltr("₪ 1.00")}</td>`.value).toBe('<td><bdi dir="ltr">₪ 1.00</bdi></td>');
    expect(userText(name).value).toBe(`<bdi>${escapeHtml(name)}</bdi>`);
    expect(userText("  ").value).toBe("—");
    expect(rdHtml("values.by", { name: userText("<b>") }).value).toBe("بواسطة <bdi>&lt;b&gt;</bdi>");
  });

  it("is an Arabic RTL document with the embedded font and the footer on every page", () => {
    const document = reportDocument({
      title: "سجل <حضور>",
      orientation: "portrait",
      reportId: REPORT_ID,
      dataHash: DATA_HASH,
      body: new SafeHtml("<p>نص</p>"),
    });
    expect(document).toContain('<html lang="ar" dir="rtl">');
    expect(document).toContain("<title>سجل &lt;حضور&gt;</title>");
    // Three subsets x two weights, one family, each with its unicode-range.
    expect(document.match(/@font-face \{ font-family: "FieldMaster Report";/g)).toHaveLength(6);
    expect(document.match(/unicode-range: U\+/g)).toHaveLength(6);
    expect(document).not.toMatch(/font-family:[^;"]*(Arial|Helvetica|sans-serif|serif)/);
    expect(document).toContain(`font-family: "${REPORT_FONT_FAMILY}"`);
    // «صفحة N من M» from the shared common.pageOf, with page counters; the id and hash isolated left-to-right.
    expect(document).toContain('content: "صفحة " counter(page) " من " counter(pages);');
    expect(document).toContain(`"معرّف التقرير: " "\\002066" "${REPORT_ID}" "\\002069"`);
    expect(document).toContain(`"\\002066" "${DATA_HASH}" "\\002069"`);
    expect(document).toContain("size: A4;");
    expect(reportDocument({ title: "x", orientation: "landscape", reportId: REPORT_ID, dataHash: DATA_HASH, body: new SafeHtml("") })).toContain(
      "size: A4 landscape;",
    );
  });
});

describe("report CSV", () => {
  it("is UTF-8 with a BOM, CRLF lines and RFC 4180 quoting", () => {
    const file = buildCsv(
      ["العامل", "ملاحظة"],
      [
        ["خالد", 'قال "نعم", ثم\nغادر'],
        [null, 3],
      ],
    );
    expect(file.startsWith(CSV_BOM)).toBe(true);
    expect(file).toBe(`${CSV_BOM}العامل,ملاحظة\r\nخالد,"قال ""نعم"", ثم\nغادر"\r\n,3\r\n`);
  });

  it("guards text cells against formula injection, never numbers", () => {
    const file = buildCsv(["أ"], [['=HYPERLINK("http://evil")'], ["+1"], ["-cmd"], ["@SUM(A1)"], ["\tx"], [-60], [csv.money(-2_000)]]);
    const cells = file.slice(1).split("\r\n").slice(1, -1);
    expect(cells).toEqual([`"'=HYPERLINK(""http://evil"")"`, "'+1", "'-cmd", "'@SUM(A1)", "'\tx", "-60", "-20.00"]);
  });

  it("writes Western digits and shekels with two decimals from integer agorot", () => {
    expect(buildCsv(["أ"], [["\u0663 أيام"]])).toContain("3 أيام");
    expect([shekels(0), shekels(5), shekels(123_450), shekels(-2_000), shekels(-5)]).toEqual(["0.00", "0.05", "1234.50", "-20.00", "-0.05"]);
    expect(csv.dateTime("2026-10-13T05:02:00Z")).toBe("2026-10-13 08:02");
    expect(csv.coordinates(32.0858, 34.7818)).toBe("32.08580, 34.78180");
  });
});

describe("report hashes and page count", () => {
  it("serializes the source data deterministically", () => {
    const a = canonicalJson({ b: 1, a: { d: new Date("2026-10-13T00:00:00Z"), c: [2, 1] }, skipped: undefined });
    const b = canonicalJson({ a: { c: [2, 1], d: "2026-10-13T00:00:00.000Z" }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":[2,1],"d":"2026-10-13T00:00:00.000Z"},"b":1}');
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(a)).not.toBe(sha256Hex(canonicalJson({ a: { c: [1, 2] }, b: 1 })));
  });

  it("counts page objects, not the page tree", () => {
    const pdf = Buffer.from(
      "1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >> 2 0 obj << /Type /Page /Parent 1 0 R >> 3 0 obj <</Type/Page/Parent 1 0 R>>",
      "latin1",
    );
    expect(countPdfPages(pdf)).toBe(2);
    expect(countPdfPages(Buffer.from("no pages"))).toBe(0);
  });
});
