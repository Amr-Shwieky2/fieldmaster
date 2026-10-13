import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GeneratedReport, PayrollPeriodSummary, PayrollVersionSummary, Project, ReportVerification, Site, Worker } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { createIntlWrapper } from "@/test/render-with-intl";
import {
  UUID,
  apiError,
  hasArabicIndicDigits,
  json,
  latinWordsOnPage,
  mockApi,
  requestedPaths,
  requestsTo,
  seedSession,
  textOf,
  type Handler,
} from "@/test/api-mock";
import ReportsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/reports",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ReportsPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
}

// ── Fixtures (instants are UTC; Asia/Jerusalem is UTC+3 in September) ─────

const OWNER_NAME = "رنا عودة";
const MANAGER_NAME = "خالد منصور";
const DATA_HASH = "1f".repeat(32);
const PDF_HASH = "2e".repeat(32);
const CSV_HASH = "3d".repeat(32);

function worker(id: string, fullLegalName: string, accountStatus: Worker["accountStatus"] = "ACTIVE"): Worker {
  return {
    id,
    organizationId: "org-1",
    fullLegalName,
    preferredName: null,
    phoneNumber: "+972500010001",
    accountStatus,
    role: "WORKER",
    createdAt: "2026-01-01T00:00:00Z",
  };
}
const WORKERS: Worker[] = [worker("wp-1", "Eli Ramzani"), worker("wp-2", "سامي حداد"), worker("wp-3", "ليلى خوري", "SUSPENDED")];
const PROJECTS: Project[] = [
  { id: "pr-1", name: "برج الميناء", client: null, projectCode: "PRJ-1", status: "ACTIVE" },
  { id: "pr-2", name: "مجمع الكرمل", client: null, projectCode: "PRJ-2", status: "ACTIVE" },
];
function site(id: string, projectId: string, name: string): Site {
  return { id, projectId, name, latitude: 32.8, longitude: 35, defaultGeofenceRadiusMeters: 100 };
}
const SITES: Site[] = [site("si-1", "pr-1", "الرصيف الشمالي"), site("si-2", "pr-1", "البوابة الشرقية"), site("si-3", "pr-2", "المبنى أ")];

function report(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    id: "r-ledger",
    reportType: "WORKER_ATTENDANCE_LEDGER",
    status: "READY",
    progress: 100,
    filters: { fromDate: "2026-09-01", toDate: "2026-09-30", workerProfileId: "wp-1" },
    includesFinancials: true,
    templateVersion: "1",
    requestedByUserId: "u-owner",
    requestedByName: OWNER_NAME,
    subjectWorkerProfileId: "wp-1",
    subjectWorkerName: "Eli Ramzani",
    sha256Hash: DATA_HASH,
    pdfSha256: PDF_HASH,
    csvSha256: CSV_HASH,
    pageCount: 3,
    errorCode: null,
    generatedAt: "2026-09-30T07:15:00Z",
    finishedAt: "2026-09-30T07:15:20Z",
    ...overrides,
  };
}

const LEDGER = report();
/** A Field Manager's operational report narrowed to a project and a site, which failed. */
const OVERTIME_FAILED = report({
  id: "r-overtime",
  reportType: "OVERTIME",
  status: "FAILED",
  progress: 30,
  filters: { fromDate: "2026-09-01", toDate: "2026-09-15", projectId: "pr-1", siteId: "si-1" },
  includesFinancials: false,
  requestedByUserId: "u-manager",
  requestedByName: MANAGER_NAME,
  subjectWorkerProfileId: null,
  subjectWorkerName: null,
  sha256Hash: null,
  pdfSha256: null,
  csvSha256: null,
  pageCount: null,
  errorCode: "SERVICE_UNAVAILABLE",
  generatedAt: "2026-09-29T21:30:00Z",
  finishedAt: "2026-09-29T21:31:00Z",
});
const PAYROLL_REPORT = report({
  id: "r-payroll",
  reportType: "PAYROLL",
  filters: { yearMonth: "2026-08", version: 2 },
  subjectWorkerProfileId: null,
  subjectWorkerName: null,
  pageCount: 12,
  generatedAt: "2026-09-28T09:00:00Z",
  finishedAt: "2026-09-28T09:01:00Z",
});
const REPORTS = [PAYROLL_REPORT, LEDGER, OVERTIME_FAILED];

function verification(overrides: Partial<ReportVerification> = {}): ReportVerification {
  return {
    reportId: "r-ledger",
    valid: true,
    checkedAt: "2026-10-13T09:05:00Z",
    dataSha256: DATA_HASH,
    files: [
      { format: "PDF", expectedSha256: PDF_HASH, actualSha256: PDF_HASH, matches: true },
      { format: "CSV", expectedSha256: CSV_HASH, actualSha256: CSV_HASH, matches: true },
    ],
    ...overrides,
  };
}

function period(yearMonth: string, calculatedAt: string | null): PayrollPeriodSummary {
  return {
    id: `pv-${yearMonth}`,
    yearMonth,
    version: 1,
    versionCount: 1,
    status: "OPEN",
    workers: null,
    netPayableAgorot: null,
    calculatedAt,
    finalizedAt: null,
  };
}
/** October is open and not calculated yet; September is the latest calculated month. */
const PERIODS = [period("2026-08", "2026-09-01T06:00:00Z"), period("2026-10", null), period("2026-09", "2026-10-02T08:30:00Z")];

function version(number: number, status: PayrollVersionSummary["status"], fields: Partial<PayrollVersionSummary> = {}): PayrollVersionSummary {
  return {
    id: `pv-9-${number}`,
    version: number,
    status,
    isCurrent: false,
    legacy: false,
    createdAt: "2026-09-30T15:00:00Z",
    createdByName: OWNER_NAME,
    reopenedAt: null,
    reopenedByName: null,
    reopenReason: null,
    calculatedAt: "2026-09-30T15:05:00Z",
    calculatedByName: OWNER_NAME,
    finalizedAt: null,
    finalizedByName: null,
    workers: 2,
    netPayableAgorot: 950000,
    ...fields,
  };
}
/** Version 3 (the current one) was reopened and not calculated yet, so the report starts on version 2. */
const VERSIONS = [version(1, "FINALIZED"), version(2, "FINALIZED"), version(3, "OPEN", { isCurrent: true, calculatedAt: null, calculatedByName: null })];

function baseRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /workers": () => json(200, WORKERS),
    "GET /projects": () => json(200, PROJECTS),
    "GET /sites": () => json(200, SITES),
    "GET /reports": () => json(200, REPORTS),
    "GET /payroll-periods": () => json(200, PERIODS),
    "GET /payroll-periods/2026-09/versions": () => json(200, VERSIONS),
    ...overrides,
  };
}

const TYPE_LABELS = [
  "سجل حضور العامل",
  "تقرير الحضور التشغيلي",
  "تقرير الساعات الإضافية",
  "تقرير استدعاءات الطوارئ",
  "تقرير مخالفات الموقع",
  "تقرير نسيان التسجيل",
];

const typeSelect = () => screen.getByLabelText("نوع التقرير") as HTMLSelectElement;
const optionTexts = (select: HTMLSelectElement) => [...select.options].map((option) => option.textContent);
const submitButton = () => screen.getByRole("button", { name: "إنشاء التقرير" });

async function chooseLedgerWorker(workerId = "wp-1") {
  await screen.findByRole("option", { name: "Eli Ramzani" });
  fireEvent.change(screen.getByLabelText("العامل"), { target: { value: workerId } });
}

describe("Reports page", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * The signed URLs the page followed with a link (served as attachments, they download and the page stays), and the
   * `window.open` calls it made instead (none expected: a popup opened after the API answers can be blocked).
   */
  function trackDownloads() {
    const followed: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      followed.push(this.href);
    });
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);
    return { followed, openMock };
  }

  it("shows an Owner the seven report types, the financial copy note and the history with names, states and times", async () => {
    seedSession(OrgRole.OWNER);
    mockApi(baseRoutes());
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "التقارير" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "إنشاء تقرير" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "التقارير السابقة" })).toBeTruthy();
    await waitFor(() => expect(optionTexts(typeSelect())).toEqual([...TYPE_LABELS, "تقرير الرواتب"]));
    expect(typeSelect().value).toBe("WORKER_ATTENDANCE_LEDGER");
    expect(screen.getByText("سجل عامل واحد بكل إثباتاته: أوقات الدوام والموقع (GPS) والتصحيحات والموافقات.")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe("نسخة مالية: تقارير المالك تتضمن المبالغ.");
    expect(screen.queryByText(/نسخة تشغيلية — بدون مبالغ:/)).toBeNull();

    const table = await screen.findByRole("table", { name: "التقارير التي أُنشئت سابقًا" });
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual(["النوع", "نطاق التقرير", "العامل المعني", "الطلب: من ومتى", "الحالة", "النسخة", "الإجراءات"]);
    for (const th of headers) {
      expect(th.getAttribute("scope")).toBe("col");
      expect(th.className).toContain("text-start");
    }

    // Newest first; names come from the lists (the worker also from the report itself).
    await waitFor(() => expect(within(table).getByText("المشروع:", { exact: false }).textContent).toBe("المشروع: برج الميناء"));
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => textOf(row.querySelector("td")))).toEqual(["سجل حضور العامل", "تقرير الساعات الإضافية", "تقرير الرواتب"]);

    const [ledger, overtime, payroll] = rows.map((row) => within(row).getAllByRole("cell"));
    const scope = (cell: HTMLElement) =>
      within(cell)
        .getAllByRole("listitem")
        .map((item) => textOf(item));
    const lines = (cell: HTMLElement) => [...cell.querySelectorAll("p")].map((line) => textOf(line));
    expect(scope(ledger[1])).toEqual(["من 1 سبتمبر 2026 إلى 30 سبتمبر 2026", "العامل: Eli Ramzani"]);
    expect(textOf(ledger[2])).toBe("Eli Ramzani");
    expect(lines(ledger[3])).toEqual([OWNER_NAME, "30 سبتمبر 2026 في 10:15"]);
    expect(within(ledger[4]).getByText("جاهز")).toBeTruthy();
    expect(lines(ledger[4])).toEqual(["اكتمل في 30 سبتمبر 2026 في 10:15", "الصفحات: 3"]);
    expect(textOf(ledger[5])).toBe("نسخة مالية");
    expect(within(rows[0]).getByRole("button", { name: "تنزيل PDF: سجل حضور العامل (30 سبتمبر 2026 في 10:15)" })).toBeTruthy();
    expect(within(rows[0]).getByRole("button", { name: "تنزيل CSV: سجل حضور العامل (30 سبتمبر 2026 في 10:15)" })).toBeTruthy();
    expect(within(rows[0]).getByRole("button", { name: "تحقق من السلامة: سجل حضور العامل (30 سبتمبر 2026 في 10:15)" })).toBeTruthy();

    // The failed report: its translated reason, no files to download.
    expect(scope(overtime[1])).toEqual(["من 1 سبتمبر 2026 إلى 15 سبتمبر 2026", "المشروع: برج الميناء", "الموقع: الرصيف الشمالي"]);
    expect(textOf(overtime[2])).toBe("—");
    expect(lines(overtime[3])).toEqual([MANAGER_NAME, "30 سبتمبر 2026 في 00:30"]);
    expect(within(overtime[4]).getByText("فشل")).toBeTruthy();
    expect(lines(overtime[4])).toEqual(["الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.", "توقف في 30 سبتمبر 2026 في 00:31"]);
    expect(textOf(overtime[5])).toBe("نسخة تشغيلية — بدون مبالغ");
    expect(within(rows[1]).queryAllByRole("button")).toHaveLength(0);

    // The payroll report: its month and version.
    expect(scope(payroll[1])).toEqual(["رواتب أغسطس 2026 — الإصدار 2"]);
    expect(lines(payroll[4])).toEqual(["اكتمل في 28 سبتمبر 2026 في 12:01", "الصفحات: 12"]);

    // Arabic only, Western digits: the Latin text is data (a worker's name) and the acronyms PDF / CSV / GPS / SHA.
    expect(screen.queryByText("READY")).toBeNull();
    expect(screen.queryByText("WORKER_ATTENDANCE_LEDGER")).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
    expect(latinWordsOnPage()).toEqual({ text: ["CSV", "Eli", "GPS", "PDF", "Ramzani", "SHA"], attributes: ["CSV", "PDF"] });
  });

  it("offers a Field Manager every type but the payroll report, with the operational copy note, and never asks for payroll data", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = mockApi(baseRoutes({ "GET /reports": () => json(200, [OVERTIME_FAILED]) }));
    renderPage();

    await screen.findByRole("table");
    expect(optionTexts(typeSelect())).toEqual(TYPE_LABELS);
    expect(screen.queryByRole("option", { name: "تقرير الرواتب" })).toBeNull();
    expect(screen.getByRole("note").textContent).toBe("نسخة تشغيلية — بدون مبالغ: لا تظهر المبالغ في تقارير مدير الميدان.");
    expect(screen.queryByText(/نسخة مالية:/)).toBeNull();
    expect(requestedPaths(fetchMock).filter((path) => path.includes("payroll"))).toEqual([]);
  });

  it("defaults the date range to the current month in Asia/Jerusalem and keeps the date inputs LTR", async () => {
    // 22:30 UTC on Sep 30 is already 01:30 on Oct 1 in Israel.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
    seedSession(OrgRole.OWNER);
    mockApi(baseRoutes());
    renderPage();

    const from = screen.getByLabelText("من تاريخ") as HTMLInputElement;
    const to = screen.getByLabelText("إلى تاريخ") as HTMLInputElement;
    expect(from.value).toBe("2026-10-01");
    expect(to.value).toBe("2026-10-31");
    expect(from.getAttribute("dir")).toBe("ltr");
    expect(to.getAttribute("dir")).toBe("ltr");
    expect(from.className).toContain("text-start");
  });

  it("checks the form before sending: the ledger needs a worker, and the range must not end before it starts", async () => {
    seedSession(OrgRole.OWNER);
    const fetchMock = mockApi(baseRoutes());
    renderPage();
    await screen.findByRole("option", { name: "Eli Ramzani" });

    fireEvent.click(submitButton());
    const workerSelect = screen.getByLabelText("العامل");
    const workerError = screen.getByText("اختر العامل.");
    expect(workerSelect.getAttribute("aria-invalid")).toBe("true");
    expect(workerSelect.getAttribute("aria-describedby")).toBe(workerError.id);
    expect(document.activeElement).toBe(workerSelect);

    fireEvent.change(workerSelect, { target: { value: "wp-1" } });
    expect(screen.queryByText("اختر العامل.")).toBeNull();
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-09-01" } });
    fireEvent.click(submitButton());
    expect(screen.getByText("يجب ألا يسبق تاريخ النهاية تاريخ البداية.")).toBeTruthy();
    expect(screen.getByLabelText("إلى تاريخ").getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "" } });
    expect(screen.getByText("أدخل تاريخ البداية.")).toBeTruthy();
    expect(requestsTo(fetchMock, "POST", "/reports")).toEqual([]);
  });

  it("narrows the operational reports by project, a site of that project and a worker, and sends only the filters a type takes", async () => {
    seedSession(OrgRole.OWNER);
    const queued = report({ id: "r-ops", status: "QUEUED", progress: 0 });
    const fetchMock = mockApi(baseRoutes({ "POST /reports": () => json(202, queued), "GET /reports/r-ops": () => json(200, queued) }));
    renderPage();

    fireEvent.change(typeSelect(), { target: { value: "OPERATIONAL_ATTENDANCE" } });
    const project = screen.getByLabelText("المشروع") as HTMLSelectElement;
    const siteSelect = screen.getByLabelText("الموقع") as HTMLSelectElement;
    expect(siteSelect.disabled).toBe(true);
    expect(optionTexts(siteSelect)).toEqual(["اختر مشروعًا أولًا"]);
    await screen.findByRole("option", { name: "برج الميناء" });
    expect(optionTexts(project)).toEqual(["كل المشاريع", "برج الميناء", "مجمع الكرمل"]);
    // The worker is optional here; names in Arabic order, a suspended worker marked.
    expect(optionTexts(screen.getByLabelText("العامل") as HTMLSelectElement)).toEqual(["كل العمال", "سامي حداد", "ليلى خوري (موقوف)", "Eli Ramzani"]);

    fireEvent.change(project, { target: { value: "pr-1" } });
    expect(siteSelect.disabled).toBe(false);
    expect(optionTexts(siteSelect)).toEqual(["كل مواقع المشروع", "البوابة الشرقية", "الرصيف الشمالي"]);
    fireEvent.change(siteSelect, { target: { value: "si-1" } });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-2" } });
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-09-15" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(requestsTo(fetchMock, "POST", "/reports")).toHaveLength(1));
    expect(requestsTo(fetchMock, "POST", "/reports")[0].body).toEqual({
      reportType: "OPERATIONAL_ATTENDANCE",
      filters: { fromDate: "2026-09-01", toDate: "2026-09-15", workerProfileId: "wp-2", projectId: "pr-1", siteId: "si-1" },
    });

    // Changing the project clears the site.
    fireEvent.change(project, { target: { value: "pr-2" } });
    expect(siteSelect.value).toBe("");
    expect(optionTexts(siteSelect)).toEqual(["كل مواقع المشروع", "المبنى أ"]);

    // Emergency call-outs take a range and a worker only: the project and site are not offered or sent.
    fireEvent.change(typeSelect(), { target: { value: "EMERGENCY_CALLOUTS" } });
    expect(screen.queryByLabelText("المشروع")).toBeNull();
    expect(screen.queryByLabelText("الموقع")).toBeNull();
    expect(screen.getByText("استدعاءات الطوارئ في الفترة وأوقاتها المحتسبة.")).toBeTruthy();
    fireEvent.click(submitButton());
    await waitFor(() => expect(requestsTo(fetchMock, "POST", "/reports")).toHaveLength(2));
    expect(requestsTo(fetchMock, "POST", "/reports")[1].body).toEqual({
      reportType: "EMERGENCY_CALLOUTS",
      filters: { fromDate: "2026-09-01", toDate: "2026-09-15", workerProfileId: "wp-2" },
    });
  });

  it("lets an Owner request the payroll report of a month and one of its calculated versions", async () => {
    seedSession(OrgRole.OWNER);
    const queued = report({ id: "r-pay", reportType: "PAYROLL", status: "QUEUED", progress: 0, filters: { yearMonth: "2026-09", version: 1 } });
    const fetchMock = mockApi(baseRoutes({ "POST /reports": () => json(202, queued), "GET /reports/r-pay": () => json(200, queued) }));
    renderPage();

    await screen.findByRole("option", { name: "تقرير الرواتب" });
    fireEvent.change(typeSelect(), { target: { value: "PAYROLL" } });
    expect(screen.queryByLabelText("من تاريخ")).toBeNull();
    expect(screen.queryByLabelText("العامل")).toBeNull();
    const month = screen.getByLabelText("الشهر") as HTMLSelectElement;
    // The latest calculated month is chosen; months newest first.
    await waitFor(() => expect(month.value).toBe("2026-09"));
    expect(optionTexts(month)).toEqual(["اختر الشهر…", "أكتوبر 2026", "سبتمبر 2026", "أغسطس 2026"]);
    const versionSelect = screen.getByLabelText("إصدار الرواتب") as HTMLSelectElement;
    await waitFor(() => expect(versionSelect.value).toBe("2"));
    expect(optionTexts(versionSelect)).toEqual(["اختر الإصدار…", "الإصدار 3 — لم يُحتسب بعد", "الإصدار 2 — معتمدة نهائياً", "الإصدار 1 — معتمدة نهائياً"]);
    expect([...versionSelect.options].map((option) => option.disabled)).toEqual([false, true, false, false]);

    fireEvent.change(versionSelect, { target: { value: "1" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(requestsTo(fetchMock, "POST", "/reports")).toHaveLength(1));
    expect(requestsTo(fetchMock, "POST", "/reports")[0].body).toEqual({ reportType: "PAYROLL", filters: { yearMonth: "2026-09", version: 1 } });
  });

  it("generates a report: one Idempotency-Key per click, progress polled about every second, then downloads and a valid integrity check", async () => {
    seedSession(OrgRole.OWNER);
    const { followed, openMock } = trackDownloads();
    const queued = report({
      id: "r-new",
      status: "QUEUED",
      progress: 0,
      sha256Hash: null,
      pdfSha256: null,
      csvSha256: null,
      pageCount: null,
      finishedAt: null,
      generatedAt: "2026-10-13T09:00:00Z",
    });
    const ready = report({ id: "r-new", pageCount: 4, generatedAt: "2026-10-13T09:00:00Z", finishedAt: "2026-10-13T09:00:30Z" });
    let polls = 0;
    const fetchMock = mockApi(
      baseRoutes({
        "GET /reports": () => json(200, []),
        "POST /reports": () => json(202, queued),
        "GET /reports/r-new": () => {
          polls += 1;
          if (polls === 1) return json(200, queued);
          if (polls === 2) return json(200, { ...queued, status: "RUNNING", progress: 40 });
          return json(200, ready);
        },
        "GET /reports/r-new/download": (_init, url) =>
          json(200, {
            downloadUrl: `https://files.example/r-new.${url.searchParams.get("format")}?sig=1`,
            expiresInSeconds: 300,
            fileName: "report",
            sha256: PDF_HASH,
          }),
        "GET /reports/r-new/verify": () => json(200, verification({ reportId: "r-new" })),
      }),
    );
    renderPage();

    await chooseLedgerWorker();
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-09-30" } });
    fireEvent.click(submitButton());

    expect(await screen.findByText("التقرير في الانتظار…")).toBeTruthy();
    const [create] = requestsTo(fetchMock, "POST", "/reports");
    expect(create.headers["Idempotency-Key"]).toMatch(UUID);
    expect(create.body).toEqual({ reportType: "WORKER_ATTENDANCE_LEDGER", filters: { fromDate: "2026-09-01", toDate: "2026-09-30", workerProfileId: "wp-1" } });
    const progress = screen.getByRole("progressbar", { name: "تقدّم إنشاء التقرير" });
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");

    // About a second later: running, 40%.
    await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40"), { timeout: 3000 });
    expect(screen.getByText("جارٍ إنشاء التقرير…")).toBeTruthy();
    expect(screen.getByText("40%").closest("bdi")?.getAttribute("dir")).toBe("ltr");

    // Then ready: «جاهز», the files and the check; polling stops.
    await waitFor(() => expect(screen.getByRole("region", { name: "سجل حضور العامل" }).textContent).toContain("جاهز"), { timeout: 3000 });
    const region = screen.getByRole("region", { name: "سجل حضور العامل" });
    expect(within(region).getByText("جاهز")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(within(region).getByText("نسخة مالية")).toBeTruthy();
    expect(within(region).getByText("عدد الصفحات: 4")).toBeTruthy();
    expect(textOf(within(region).getByText(/^اكتمل في/))).toBe("اكتمل في 13 أكتوبر 2026 في 12:00.");

    fireEvent.click(within(region).getByRole("button", { name: "تنزيل PDF" }));
    await waitFor(() => expect(followed).toEqual(["https://files.example/r-new.pdf?sig=1"]));
    fireEvent.click(within(region).getByRole("button", { name: "تنزيل CSV" }));
    await waitFor(() => expect(followed).toEqual(["https://files.example/r-new.pdf?sig=1", "https://files.example/r-new.csv?sig=1"]));
    expect(openMock).not.toHaveBeenCalled();
    expect(requestsTo(fetchMock, "GET", "/reports/r-new/download").map((request) => request.url.searchParams.get("format"))).toEqual(["pdf", "csv"]);

    fireEvent.click(within(region).getByRole("button", { name: "تحقق من السلامة" }));
    const valid = await within(region).findByText("الملفات سليمة: تطابقت البصمة");
    const result = valid.closest("[role=status]") as HTMLElement;
    expect(result).toBeTruthy();
    expect(within(result).getByText(DATA_HASH).closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(within(result).getAllByText(PDF_HASH)).toHaveLength(2);
    expect(within(result).getAllByText(CSV_HASH)).toHaveLength(2);
    expect(within(result).getAllByText("متطابقة")).toHaveLength(2);
    expect(textOf(within(result).getByText(/^تم التحقق في/))).toBe("تم التحقق في 13 أكتوبر 2026 في 12:05.");

    const pollsWhenReady = polls;
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(polls).toBe(pollsWhenReady);

    // A second click is a new request with a new key.
    fireEvent.click(submitButton());
    await waitFor(() => expect(requestsTo(fetchMock, "POST", "/reports")).toHaveLength(2));
    const keys = requestsTo(fetchMock, "POST", "/reports").map((request) => request.headers["Idempotency-Key"]);
    expect(keys[1]).toMatch(UUID);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("shows a failed report's translated reason and requests the same report again with a new key", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    // The API answers with the report it queued, filters included.
    const reports = new Map<string, GeneratedReport>();
    const fetchMock = mockApi(
      baseRoutes({
        "GET /reports": () => json(200, []),
        "POST /reports": (init) => {
          const { filters } = JSON.parse(String(init?.body)) as { filters: GeneratedReport["filters"] };
          const id = reports.size === 0 ? "r-a" : "r-b";
          const queued = report({ id, status: "QUEUED", progress: 0, filters, includesFinancials: false, finishedAt: null, pageCount: null });
          reports.set(id, queued);
          return json(202, queued);
        },
        "GET /reports/r-a": () =>
          json(200, { ...reports.get("r-a"), status: "FAILED", progress: 60, errorCode: "SERVICE_UNAVAILABLE", finishedAt: "2026-10-13T09:01:00Z" }),
        "GET /reports/r-b": () => json(200, { ...reports.get("r-b"), status: "RUNNING", progress: 10 }),
      }),
    );
    renderPage();

    await chooseLedgerWorker("wp-2");
    fireEvent.click(submitButton());
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("تعذّر إنشاء سجل حضور العامل")).toBeTruthy();
    expect(within(alert).getByText("الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.")).toBeTruthy();
    expect(screen.queryByText("SERVICE_UNAVAILABLE")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "أعد المحاولة" }));
    await waitFor(() => expect(requestsTo(fetchMock, "POST", "/reports")).toHaveLength(2));
    const [first, second] = requestsTo(fetchMock, "POST", "/reports");
    expect(second.body).toEqual(first.body);
    expect(second.headers["Idempotency-Key"]).toMatch(UUID);
    expect(second.headers["Idempotency-Key"]).not.toBe(first.headers["Idempotency-Key"]);
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("translates a refused request from its API code, never showing the API's English message", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    mockApi(
      baseRoutes({
        "POST /reports": () =>
          ++calls === 1
            ? apiError(403, "FORBIDDEN", "You cannot generate a report for another worker.")
            : apiError(400, "SOME_FUTURE_REPORT_CODE", "Range too long."),
      }),
    );
    renderPage();

    await chooseLedgerWorker();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("ليست لديك صلاحية لتنفيذ هذا الإجراء."));
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("بعض البيانات المُدخلة غير صالحة. راجع الحقول وحاول مرة أخرى."));
    expect(screen.queryByText(/another worker|Range too long/)).toBeNull();
  });

  it("checks a past report: a changed or unrecorded file is a clear warning", async () => {
    seedSession(OrgRole.OWNER);
    const changed = "9a".repeat(32);
    mockApi(
      baseRoutes({
        "GET /reports/r-ledger/verify": () =>
          json(
            200,
            verification({
              valid: false,
              files: [
                { format: "PDF", expectedSha256: PDF_HASH, actualSha256: changed, matches: false },
                { format: "CSV", expectedSha256: null, actualSha256: CSV_HASH, matches: false },
              ],
            }),
          ),
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "تحقق من السلامة: سجل حضور العامل (30 سبتمبر 2026 في 10:15)" }));
    const warning = await screen.findByRole("alert");
    expect(within(warning).getByText("لا تطابق: تغيّر الملف أو لم تُسجَّل بصمته")).toBeTruthy();
    expect(within(warning).getAllByText("غير متطابقة")).toHaveLength(2);
    expect(within(warning).getByText(changed)).toBeTruthy();
    expect(within(warning).getByText("غير مسجّلة")).toBeTruthy();
    expect(screen.queryByText("الملفات سليمة: تطابقت البصمة")).toBeNull();
    // The result sits under the report's own row.
    expect(warning.closest("tr")?.previousElementSibling?.textContent).toContain("سجل حضور العامل");
  });

  it("downloads a past report's PDF and shows a translated error when the link cannot be made", async () => {
    seedSession(OrgRole.OWNER);
    const { followed, openMock } = trackDownloads();
    mockApi(
      baseRoutes({
        "GET /reports/r-ledger/download": (_init, url) =>
          url.searchParams.get("format") === "pdf"
            ? json(200, { downloadUrl: "https://files.example/r-ledger.pdf", expiresInSeconds: 300, fileName: "ledger.pdf", sha256: PDF_HASH })
            : apiError(409, "REPORT_NOT_READY", "Report not ready."),
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "تنزيل PDF: سجل حضور العامل (30 سبتمبر 2026 في 10:15)" }));
    await waitFor(() => expect(followed).toEqual(["https://files.example/r-ledger.pdf"]));
    fireEvent.click(screen.getByRole("button", { name: "تنزيل CSV: سجل حضور العامل (30 سبتمبر 2026 في 10:15)" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("تعذّر تنزيل التقرير: التقرير لم يجهز بعد. انتظر حتى ينتهي إنشاؤه."));
    expect(followed).toHaveLength(1);
    expect(openMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Report not ready.")).toBeNull();
  });

  it("refetches the history while a report is being generated, until it is ready", async () => {
    seedSession(OrgRole.OWNER);
    const running = report({ status: "RUNNING", progress: 40, pageCount: null, finishedAt: null });
    let listCalls = 0;
    mockApi(
      baseRoutes({
        "GET /reports": () => {
          listCalls += 1;
          return json(200, [listCalls === 1 ? running : LEDGER]);
        },
      }),
    );
    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("قيد الإنشاء")).toBeTruthy();
    expect(within(table).getByText("40%")).toBeTruthy();
    expect(within(table).queryByRole("button")).toBeNull();
    await waitFor(() => expect(within(table).getByText("جاهز")).toBeTruthy(), { timeout: 4000 });
    expect(within(table).getByRole("button", { name: /^تنزيل PDF/ })).toBeTruthy();
    const callsWhenReady = listCalls;
    await new Promise((resolve) => setTimeout(resolve, 2300));
    expect(listCalls).toBe(callsWhenReady);
  });

  it("shows the empty state when no report was generated", async () => {
    seedSession(OrgRole.OWNER);
    mockApi(baseRoutes({ "GET /reports": () => json(200, []) }));
    renderPage();

    expect(await screen.findByText("لم يُنشأ أي تقرير بعد")).toBeTruthy();
    expect(screen.getByText("اختر نوع التقرير وفلاتره في الأعلى، ثم «إنشاء التقرير».")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a translated error with retry for the history", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    mockApi(baseRoutes({ "GET /reports": () => (++calls === 1 ? apiError(500, "INTERNAL_ERROR") : json(200, REPORTS)) }));
    renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("shows the access-denied state when the history answers 403", async () => {
    seedSession(OrgRole.OWNER);
    mockApi(baseRoutes({ "GET /reports": () => apiError(403, "FORBIDDEN") }));
    renderPage();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
  });

  it("shows an inline error with retry when the worker list fails", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    mockApi(baseRoutes({ "GET /workers": () => (++calls === 1 ? apiError(500, "INTERNAL_ERROR") : json(200, WORKERS)) }));
    renderPage();

    const alert = await screen.findByText("تعذّر تحميل القائمة: حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    fireEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("option", { name: "Eli Ramzani" })).toBeTruthy();
  });
});
