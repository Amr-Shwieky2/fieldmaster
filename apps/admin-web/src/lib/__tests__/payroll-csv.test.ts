import { describe, expect, it } from "vitest";
import type { PayrollTotals, PayrollWorkerLine } from "@fieldmaster/api-client";
import { CSV_BOM, buildPayrollCsv, csvField, csvMoney, csvText, payrollCsvFileName, type PayrollCsvLabels } from "../payroll-csv";

const LABELS: PayrollCsvLabels = {
  worker: "العامل",
  approvedShifts: "الورديات المعتمدة",
  standardDays: "الأيام المحتسبة",
  regularMinutes: "الدقائق العادية",
  overtimeMinutes: "الدقائق الإضافية",
  emergencyRetroactiveMinutes: "دقائق الطوارئ قبل البدء",
  emergencyReturnMinutes: "دقائق الطوارئ بعد الإنهاء",
  grossBase: "الأجر الأساسي",
  overtimePay: "أجر الساعات الإضافية",
  positiveAdjustments: "إضافات",
  forgottenStampPenalties: "خصم نسيان التسجيل",
  reversals: "إلغاء خصومات",
  otherDeductions: "خصومات أخرى",
  net: "الصافي",
  totals: "الإجمالي",
};

function line(overrides: Partial<PayrollWorkerLine>): PayrollWorkerLine {
  return {
    workerProfileId: "wp-1",
    fullLegalName: "سامي حداد",
    approvedShifts: 21,
    standardDaysCredited: 21,
    regularMinutes: 10080,
    overtimeMinutes: 150,
    emergencyRetroactiveMinutes: 60,
    emergencyReturnMinutes: 15,
    grossBaseAgorot: 1234567,
    overtimeAgorot: 12350,
    positiveAdjustmentsAgorot: 5000,
    forgottenStampPenaltiesAgorot: 2000,
    reversalsAgorot: 2000,
    otherDeductionsAgorot: 7,
    netPayableAgorot: 1251910,
    pendingEntries: 0,
    entriesWithoutCompensation: 0,
    ...overrides,
  };
}

const SAMI = line({});
const LAYLA = line({
  workerProfileId: "wp-2",
  fullLegalName: "ليلى خوري",
  approvedShifts: 2,
  standardDaysCredited: 2,
  regularMinutes: 960,
  overtimeMinutes: 0,
  emergencyRetroactiveMinutes: 0,
  emergencyReturnMinutes: 0,
  grossBaseAgorot: 45000,
  overtimeAgorot: 0,
  positiveAdjustmentsAgorot: 0,
  forgottenStampPenaltiesAgorot: 0,
  reversalsAgorot: 0,
  otherDeductionsAgorot: 0,
  netPayableAgorot: 45000,
});

const TOTALS: PayrollTotals = {
  workers: 2,
  approvedShifts: 23,
  standardDaysCredited: 23,
  regularMinutes: 11040,
  overtimeMinutes: 150,
  emergencyRetroactiveMinutes: 60,
  emergencyReturnMinutes: 15,
  grossBaseAgorot: 1279567,
  overtimeAgorot: 12350,
  positiveAdjustmentsAgorot: 5000,
  forgottenStampPenaltiesAgorot: 2000,
  reversalsAgorot: 2000,
  otherDeductionsAgorot: 7,
  netPayableAgorot: 1296910,
};

/** RFC 4180 reader (quoted fields, doubled quotes, CRLF records) to check what a spreadsheet will see. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

const HEADER = [
  "العامل",
  "الورديات المعتمدة",
  "الأيام المحتسبة",
  "الدقائق العادية",
  "الدقائق الإضافية",
  "دقائق الطوارئ قبل البدء",
  "دقائق الطوارئ بعد الإنهاء",
  "الأجر الأساسي",
  "أجر الساعات الإضافية",
  "إضافات",
  "خصم نسيان التسجيل",
  "إلغاء خصومات",
  "خصومات أخرى",
  "الصافي",
];

describe("payroll CSV export", () => {
  it("starts with a UTF-8 byte order mark and uses CRLF line endings, ending with one", () => {
    const csv = buildPayrollCsv({ workers: [SAMI, LAYLA], totals: TOTALS, labels: LABELS });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(CSV_BOM).toBe("﻿");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // Header + 2 workers + totals, each ended by CRLF; no bare LF anywhere.
    expect(csv.split("\r\n")).toHaveLength(5);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    // Encoded as UTF-8 the file starts with EF BB BF.
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("has Arabic headers, one row per worker with every figure and a totals row from the version's totals", () => {
    const rows = parseCsv(buildPayrollCsv({ workers: [SAMI, LAYLA], totals: TOTALS, labels: LABELS }).slice(1));
    expect(rows).toEqual([
      HEADER,
      ["سامي حداد", "21", "21", "10080", "150", "60", "15", "12345.67", "123.50", "50.00", "-20.00", "20.00", "-0.07", "12519.10"],
      ["ليلى خوري", "2", "2", "960", "0", "0", "0", "450.00", "0.00", "0.00", "0.00", "0.00", "0.00", "450.00"],
      ["الإجمالي", "23", "23", "11040", "150", "60", "15", "12795.67", "123.50", "50.00", "-20.00", "20.00", "-0.07", "12969.10"],
    ]);
  });

  it("writes money as shekels with exactly two decimals, no thousands separator and no shekel sign, from integer agorot", () => {
    expect(csvMoney(45000)).toBe("450.00");
    expect(csvMoney(-2000)).toBe("-20.00");
    expect(csvMoney(7)).toBe("0.07");
    expect(csvMoney(-7)).toBe("-0.07");
    expect(csvMoney(10)).toBe("0.10");
    expect(csvMoney(0)).toBe("0.00");
    expect(csvMoney(-0)).toBe("0.00");
    expect(csvMoney(123456789)).toBe("1234567.89");
    // 0.1 + 0.2 style float errors cannot happen: the value is never divided as a float.
    expect(csvMoney(30)).toBe("0.30");
    const csv = buildPayrollCsv({ workers: [SAMI], totals: null, labels: LABELS });
    expect(csv).not.toContain("₪");
    // Every money cell (base .. net) is a plain number with two decimals: no thousands separator splits it.
    const [header, row, totals] = parseCsv(csv.slice(1));
    expect(row).toHaveLength(header.length);
    for (const cell of [...row.slice(7), ...totals.slice(7)]) expect(cell).toMatch(/^-?\d+\.\d{2}$/);
    expect(row[7]).toBe("12345.67");
  });

  it("writes minutes and counts as whole numbers in Western digits only, even when a name has Arabic-Indic digits", () => {
    const csv = buildPayrollCsv({ workers: [line({ fullLegalName: "عامل ٣", regularMinutes: 600, overtimeMinutes: 45 })], totals: null, labels: LABELS });
    expect(csv).not.toMatch(/[٠-٩۰-۹]/);
    const [, row] = parseCsv(csv.slice(1));
    expect(row[0]).toBe("عامل 3");
    expect(row.slice(3, 7)).toEqual(["600", "45", "60", "15"]);
  });

  it("adds up the totals row from the worker lines when the version has no totals, leaving unknown shift counts empty", () => {
    const rows = parseCsv(buildPayrollCsv({ workers: [SAMI, line({ workerProfileId: "wp-3", approvedShifts: null })], totals: null, labels: LABELS }).slice(1));
    expect(rows[2][1]).toBe("");
    expect(rows[3]).toEqual(["الإجمالي", "", "42", "20160", "300", "120", "30", "24691.34", "247.00", "100.00", "-40.00", "40.00", "-0.14", "25038.20"]);
  });

  it("quotes fields with a comma, a quote, CR or LF (RFC 4180) and doubles inner quotes", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("حداد, سامي")).toBe('"حداد, سامي"');
    expect(csvField('سامي "أبو علي"')).toBe('"سامي ""أبو علي"""');
    expect(csvField("سطر\nثانٍ")).toBe('"سطر\nثانٍ"');
    expect(csvField("سطر\rثانٍ")).toBe('"سطر\rثانٍ"');
    const workers = [line({ fullLegalName: 'حداد, سامي "أبو علي"' }), line({ workerProfileId: "wp-4", fullLegalName: "ليلى\r\nخوري" })];
    const csv = buildPayrollCsv({ workers, totals: null, labels: LABELS });
    expect(csv).toContain('\r\n"حداد, سامي ""أبو علي""",21,');
    expect(csv).toContain('\r\n"ليلى\r\nخوري",21,');
    const rows = parseCsv(csv.slice(1));
    expect(rows).toHaveLength(4);
    expect(rows[1][0]).toBe('حداد, سامي "أبو علي"');
    expect(rows[2][0]).toBe("ليلى\r\nخوري");
    expect(rows.every((row) => row.length === HEADER.length)).toBe(true);
  });

  it("prefixes text cells that a spreadsheet would run as a formula, but never numeric cells", () => {
    for (const name of ['=HYPERLINK("http://x")', "+972", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(csvText(name)).toBe(`'${name}`);
    expect(csvText("سامي")).toBe("سامي");
    expect(csvText("a=b")).toBe("a=b");
    const workers = [
      line({ fullLegalName: "=1+2" }),
      line({ workerProfileId: "wp-5", fullLegalName: "@عامل" }),
      line({ workerProfileId: "wp-6", fullLegalName: "-سامي", forgottenStampPenaltiesAgorot: 2000, netPayableAgorot: -100 }),
      line({ workerProfileId: "wp-7", fullLegalName: "+ليلى" }),
    ];
    const rows = parseCsv(buildPayrollCsv({ workers, totals: null, labels: LABELS }).slice(1));
    expect(rows.slice(1, 5).map((row) => row[0])).toEqual(["'=1+2", "'@عامل", "'-سامي", "'+ليلى"]);
    // Negative amounts stay numbers.
    expect(rows[3][10]).toBe("-20.00");
    expect(rows[3][13]).toBe("-1.00");
    expect(rows.flat().filter((cell) => cell.startsWith("'-") && /^'-\d/.test(cell))).toEqual([]);
  });

  it("exports a legacy version that only stored the net per worker as worker + net, with a total", () => {
    const csv = buildPayrollCsv({
      workers: [],
      totals: null,
      legacyNetByWorker: [
        { fullLegalName: "سامي حداد", netPayableAgorot: 854850 },
        { fullLegalName: "=ليلى", netPayableAgorot: 123450 },
      ],
      labels: LABELS,
    });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(parseCsv(csv.slice(1))).toEqual([
      ["العامل", "الصافي"],
      ["سامي حداد", "8548.50"],
      ["'=ليلى", "1234.50"],
      ["الإجمالي", "9783.00"],
    ]);
  });

  it("names the file after the month and the version", () => {
    expect(payrollCsvFileName("2026-09", 2)).toBe("payroll-2026-09-v2.csv");
  });
});
