import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { sessionStore } from "@/lib/session-store";
import { createIntlWrapper } from "@/test/render-with-intl";
import type { Locale } from "@/i18n/config";
import ReportsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/reports",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function apiError(status: number, code: string, message = "English API message") {
  return json(status, { statusCode: status, code, message, details: {}, correlationId: "c-1" });
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Routes `fetch` by "METHOD /path" (path after /api/v1). Unknown routes answer 500. */
function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^.*\/api\/v1/, "");
    const handler = routes[`${init?.method ?? "GET"} ${path}`];
    return handler ? handler(init) : apiError(500, "INTERNAL_ERROR", `unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function seedSession(role: OrgRole) {
  sessionStore.save({ accessToken: "test-access", refreshToken: "test-refresh", organizationId: "org-1", role, workerProfileId: null });
}

function renderPage(locale: Locale = "ar") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ReportsPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper({ locale }) },
  );
}

const WORKERS = [
  { id: "wp-1", organizationId: "org-1", fullLegalName: "Eli Ramzani", preferredName: null, phoneNumber: "+972500010001", accountStatus: "ACTIVE", role: "WORKER", createdAt: "2026-01-01T00:00:00Z" },
  { id: "wp-2", organizationId: "org-1", fullLegalName: "Samir Haddad", preferredName: null, phoneNumber: "+972500010002", accountStatus: "ACTIVE", role: "WORKER", createdAt: "2026-01-01T00:00:00Z" },
];
const REPORTS = [
  {
    id: "r-1",
    reportType: "WORKER_ATTENDANCE_LEDGER",
    requestedByUserId: "u-1",
    subjectWorkerProfileId: "wp-1",
    includesFinancials: true,
    sha256Hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    generatedAt: "2026-09-30T07:15:00Z",
  },
  {
    id: "r-2",
    reportType: "WORKER_ATTENDANCE_LEDGER",
    requestedByUserId: "u-2",
    subjectWorkerProfileId: "wp-9",
    includesFinancials: false,
    sha256Hash: "9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff",
    generatedAt: "2026-09-29T21:30:00Z",
  },
];

const baseRoutes: Record<string, Handler> = {
  "GET /workers": () => json(200, WORKERS),
  "GET /reports": () => json(200, REPORTS),
};

describe("Reports page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedSession(OrgRole.OWNER);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the Worker Attendance Ledger form and past reports in Arabic", async () => {
    mockApi(baseRoutes);
    renderPage("ar");

    expect(screen.getByRole("heading", { level: 1, name: "التقارير" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "إنشاء سجل حضور العامل" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "التقارير السابقة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "إنشاء ملف PDF" })).toBeTruthy();

    const table = await screen.findByRole("table", { name: "التقارير التي أُنشئت سابقًا" });
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    for (const th of within(table).getAllByRole("columnheader")) {
      expect(th.getAttribute("scope")).toBe("col");
      expect(th.className).toContain("text-start");
    }
    await waitFor(() => expect(within(table).getByText("Eli Ramzani")).toBeTruthy());
    expect(within(table).getByText("30 سبتمبر 2026 في 10:15")).toBeTruthy();
    expect(within(table).getByText("مُضمَّنة")).toBeTruthy();
    expect(within(table).getByText("معلومات العمل فقط")).toBeTruthy();
    // Hash prefix and an unknown worker id stay left-to-right.
    expect(within(table).getByText("abcdef0123456789…").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(within(table).getByText("wp-9").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(within(table).getByRole("button", { name: "تنزيل تقرير Eli Ramzani (30 سبتمبر 2026 في 10:15)" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });

  it("renders in English", async () => {
    mockApi(baseRoutes);
    renderPage("en");

    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Generate a Worker Attendance Ledger" })).toBeTruthy();
    expect(screen.getByLabelText("Worker")).toBeTruthy();
    expect(await screen.findByText("Sep 30, 2026, 10:15")).toBeTruthy();
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.getByText("Operational only")).toBeTruthy();
  });

  it("defaults the date range to the current month in Asia/Jerusalem and keeps the date inputs LTR", async () => {
    // 22:30 UTC on Sep 30 is already 01:30 on Oct 1 in Israel.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
    mockApi(baseRoutes);
    renderPage("ar");

    const from = screen.getByLabelText("من تاريخ") as HTMLInputElement;
    const to = screen.getByLabelText("إلى تاريخ") as HTMLInputElement;
    expect(from.value).toBe("2026-10-01");
    expect(to.value).toBe("2026-10-31");
    expect(from.getAttribute("dir")).toBe("ltr");
    expect(to.getAttribute("dir")).toBe("ltr");
    expect(from.className).toContain("text-start");
  });

  it("shows the empty state when no report was generated", async () => {
    mockApi({ ...baseRoutes, "GET /reports": () => json(200, []) });
    renderPage("ar");

    expect(await screen.findByText("لم يُنشأ أي تقرير بعد")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a translated error with retry for past reports", async () => {
    let calls = 0;
    mockApi({ ...baseRoutes, "GET /reports": () => (++calls === 1 ? apiError(500, "INTERNAL_ERROR") : json(200, REPORTS)) });
    renderPage("ar");

    expect((await screen.findByRole("alert")).textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("shows the access-denied state when the reports list answers 403", async () => {
    mockApi({ ...baseRoutes, "GET /reports": () => apiError(403, "FORBIDDEN") });
    renderPage("ar");

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
  });

  it("generates a ledger with an Idempotency-Key, a pending label and a success message", async () => {
    let release: () => void = () => {};
    const fetchMock = mockApi({
      ...baseRoutes,
      "POST /reports/worker-attendance-ledger": () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(201, { ...REPORTS[0], downloadUrl: "https://files.example/ledger.pdf" }));
        }),
    });
    renderPage("ar");

    const button = screen.getByRole("button", { name: "إنشاء ملف PDF" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await screen.findByRole("option", { name: "Eli Ramzani" });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-1" } });
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-09-30" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    expect(((await screen.findByRole("button", { name: "جارٍ إنشاء التقرير…" })) as HTMLButtonElement).disabled).toBe(true);
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/reports/worker-attendance-ledger"));
    expect(call?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ workerProfileId: "wp-1", fromDate: "2026-09-01", toDate: "2026-09-30" });
    expect((call?.[1]?.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^web-report-\d+$/);

    release();
    const ready = await screen.findByText("التقرير جاهز، ويتضمن الأرقام المالية.");
    expect(ready.closest("[role=status]")).toBeTruthy();
    expect(screen.getByRole("link", { name: "فتح ملف PDF" }).getAttribute("href")).toBe("https://files.example/ledger.pdf");
  });

  it("translates a generation error from its API code instead of showing the English message", async () => {
    mockApi({ ...baseRoutes, "POST /reports/worker-attendance-ledger": () => apiError(403, "FORBIDDEN", "You cannot generate a report for another worker.") });
    renderPage("ar");

    await screen.findByRole("option", { name: "Eli Ramzani" });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء ملف PDF" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("ليست لديك صلاحية لتنفيذ هذا الإجراء."));
    expect(screen.queryByText(/another worker/)).toBeNull();
  });

  it("opens the signed download link for a past report", async () => {
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);
    mockApi({
      ...baseRoutes,
      "GET /reports/r-1/download": () => json(200, { downloadUrl: "https://files.example/r-1.pdf", sha256Hash: REPORTS[0].sha256Hash, generatedAt: REPORTS[0].generatedAt }),
    });
    renderPage("en");

    fireEvent.click(await screen.findByRole("button", { name: "Download the report for Eli Ramzani (Sep 30, 2026, 10:15)" }));
    await waitFor(() => expect(openMock).toHaveBeenCalledWith("https://files.example/r-1.pdf", "_blank", "noopener,noreferrer"));
  });

  it("shows a translated download error", async () => {
    mockApi({ ...baseRoutes, "GET /reports/r-1/download": () => apiError(404, "NOT_FOUND", "Report not found.") });
    renderPage("ar");

    fireEvent.click(await screen.findByRole("button", { name: /^تنزيل تقرير Eli Ramzani/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("تعذّر تنزيل التقرير: لم نتمكن من العثور على العنصر المطلوب."));
  });

  it("shows an inline error with retry when the worker list fails", async () => {
    let calls = 0;
    mockApi({ ...baseRoutes, "GET /workers": () => (++calls === 1 ? apiError(500, "INTERNAL_ERROR") : json(200, WORKERS)) });
    renderPage("ar");

    const alert = await screen.findByText("تعذّر تحميل قائمة العمال: حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    fireEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("option", { name: "Eli Ramzani" })).toBeTruthy();
  });

  it("is available to a Field Manager, whose ledgers are operational only", async () => {
    window.localStorage.clear();
    seedSession(OrgRole.FIELD_MANAGER);
    mockApi({
      ...baseRoutes,
      "GET /reports": () => json(200, [REPORTS[1]]),
      "POST /reports/worker-attendance-ledger": () => json(201, { ...REPORTS[1], downloadUrl: "https://files.example/ops.pdf" }),
    });
    renderPage("ar");

    expect(screen.getByRole("heading", { level: 1, name: "التقارير" })).toBeTruthy();
    await screen.findByRole("option", { name: "Samir Haddad" });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-2" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء ملف PDF" }));
    expect(await screen.findByText("التقرير جاهز، ويتضمن معلومات العمل فقط بدون أرقام مالية.")).toBeTruthy();
  });
});
