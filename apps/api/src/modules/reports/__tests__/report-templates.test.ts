import { ReportType } from "@fieldmaster/shared-types";
import { REPORT_DEFINITIONS, reportDefinition, templateVersionFor } from "../report-definitions";
import { CSV_BOM } from "../render/csv";
import * as fx from "./report-fixtures";

/**
 * Every template rendered with realistic data (no database, no Chromium):
 * every message it uses exists, the operational versions carry no amount at
 * all, the financial ones do, and hostile text stays text.
 */

const PERIOD = { fromDate: "2026-10-01", toDate: "2026-10-31" };

const CASES: { type: ReportType; financial: boolean; data: unknown; filters?: Record<string, unknown> }[] = [
  {
    type: ReportType.WORKER_ATTENDANCE_LEDGER,
    financial: false,
    data: fx.ledgerOperational,
    filters: { ...PERIOD, workerProfileId: "0192cccc-0000-7000-8000-000000000001" },
  },
  {
    type: ReportType.WORKER_ATTENDANCE_LEDGER,
    financial: true,
    data: fx.ledgerFinancial,
    filters: { ...PERIOD, workerProfileId: "0192cccc-0000-7000-8000-000000000001" },
  },
  { type: ReportType.OPERATIONAL_ATTENDANCE, financial: false, data: fx.attendance },
  { type: ReportType.OVERTIME, financial: false, data: fx.overtimeOperational },
  { type: ReportType.OVERTIME, financial: true, data: fx.overtimeFinancial },
  { type: ReportType.EMERGENCY_CALLOUTS, financial: false, data: fx.emergencyOperational },
  { type: ReportType.EMERGENCY_CALLOUTS, financial: true, data: fx.emergencyFinancial },
  { type: ReportType.SITE_VIOLATIONS, financial: false, data: fx.siteViolations },
  { type: ReportType.FORGOTTEN_STAMPS, financial: false, data: fx.forgottenStampsOperational },
  { type: ReportType.FORGOTTEN_STAMPS, financial: true, data: fx.forgottenStampsFinancial },
  { type: ReportType.PAYROLL, financial: true, data: fx.payroll, filters: { yearMonth: "2026-10", version: 2 } },
];

/** An amount as the reports print it: "₪ 1,234.50" in the PDF, "1234.50" in the CSV (coordinates have 5 decimals, minutes none). */
const AMOUNT = /\d\.\d{2}(?!\d)/;

function render(testCase: (typeof CASES)[number]) {
  const definition = reportDefinition(testCase.type, testCase.financial);
  const meta = fx.meta(testCase.type, testCase.financial, testCase.filters ?? PERIOD);
  return { html: definition.body(testCase.data, meta).value, csv: definition.csv(testCase.data, meta) };
}

describe("report templates", () => {
  it("has an operational and a financial version where the type has both, and none that must not exist", () => {
    expect(REPORT_DEFINITIONS[ReportType.PAYROLL].operational).toBeNull();
    expect(REPORT_DEFINITIONS[ReportType.OPERATIONAL_ATTENDANCE].financial).toBeNull();
    expect(REPORT_DEFINITIONS[ReportType.SITE_VIOLATIONS].financial).toBeNull();
    for (const type of [ReportType.WORKER_ATTENDANCE_LEDGER, ReportType.OVERTIME, ReportType.EMERGENCY_CALLOUTS, ReportType.FORGOTTEN_STAMPS]) {
      const versions = REPORT_DEFINITIONS[type];
      // Separate loaders and templates, not one template with sections hidden.
      expect(versions.operational?.load).not.toBe(versions.financial?.load);
      expect(versions.operational?.body).not.toBe(versions.financial?.body);
      expect(versions.operational?.csv).not.toBe(versions.financial?.csv);
    }
    expect(() => reportDefinition(ReportType.PAYROLL, false)).toThrow();
    expect(templateVersionFor(ReportType.WORKER_ATTENDANCE_LEDGER)).toBe("worker-attendance-ledger-ar-v1");
  });

  it.each(CASES.map((testCase) => [`${testCase.type} ${testCase.financial ? "financial" : "operational"}`, testCase] as const))(
    "%s renders with the shared messages, its header and version, and Arabic CSV headers",
    (_name, testCase) => {
      const { html, csv } = render(testCase);
      expect(html).toContain(testCase.financial ? "نسخة مالية" : "نسخة تشغيلية — بدون مبالغ");
      expect(html).toContain("شركة الطرق الوطنية");
      expect(html).toContain(fx.REPORT_ID);
      expect(html).toContain(fx.DATA_HASH);
      // Never the raw English of a generated shift title or an enum code in the visible text.
      expect(html).not.toContain(">Emergency Call-out<");
      expect(html).not.toMatch(/>(APPROVED|PENDING_APPROVAL|GEOFENCED|FLEXI_CHECK|CLOCK_IN|CLOCK_OUT|NIGHT_TURAN_ASSIGNMENT|FORGOTTEN_CLOCK_IN)</);

      expect(csv.startsWith(CSV_BOM)).toBe(true);
      const [header, ...lines] = csv.slice(1).split("\r\n");
      expect(header).toMatch(/[\u0600-\u06FF]/);
      // Arabic only, apart from the acronym GPS (as in the shared messages).
      expect(header.replace(/GPS/g, "")).not.toMatch(/[A-Za-z]/);
      expect(lines.at(-1)).toBe("");
      expect(csv).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
    },
  );

  it.each(CASES.filter((testCase) => !testCase.financial).map((testCase) => [testCase.type, testCase] as const))(
    "the operational %s has no ₪ and no amount, in the PDF or the CSV",
    (_type, testCase) => {
      const { html, csv } = render(testCase);
      const visible = html.replace(/<[^>]+>/g, " ");
      expect(visible).not.toContain("₪");
      expect(visible).not.toMatch(AMOUNT);
      expect(csv).not.toContain("₪");
      expect(csv).not.toMatch(AMOUNT);
    },
  );

  it.each(CASES.filter((testCase) => testCase.financial).map((testCase) => [testCase.type, testCase] as const))(
    "the financial %s shows its amounts",
    (_type, testCase) => {
      const { html, csv } = render(testCase);
      expect(html).toContain("₪");
      expect(csv).toMatch(AMOUNT);
    },
  );

  it("prints the known amounts of the financial ledger: the entry's pay, the stamp's deduction and the net", () => {
    const { html, csv } = render(CASES[1]);
    expect(html).toContain("₪ 555.00");
    expect(html).toContain("₪ 450.00");
    expect(html).toContain("₪ 105.00");
    expect(html).toContain("-₪ 10.00");
    expect(csv).toContain(",450.00,105.00,555.00,10.00,10.00\r\n");
  });

  it("keeps hostile text as text: escaped in the PDF, formula-guarded in the CSV", () => {
    const { html, csv } = render(CASES[2]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(csv).toContain(`"<script>alert(""x"")</script> =HYPERLINK(""http://evil"")"`);
    const ledger = render(CASES[0]);
    expect(ledger.html).not.toContain("<script>");
  });

  it("shows the emergency rule and the call-out's -60 / +15 minutes", () => {
    const { html } = render(CASES[6]);
    expect(html).toContain("تبدأ المدة المحتسبة قبل 60 دقيقة من الضغط على البدء");
    expect(html).toContain("60 د");
    expect(html).toContain("15 د");
    expect(html).toContain("₪ 112.50");
  });
});
