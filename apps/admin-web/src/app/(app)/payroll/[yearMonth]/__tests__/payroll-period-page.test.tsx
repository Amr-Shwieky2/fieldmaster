import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { sessionStore } from "@/lib/session-store";
import { createIntlWrapper } from "@/test/render-with-intl";
import type { Locale } from "@/i18n/config";
import PayrollPeriodPage from "../page";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payroll/2026-09",
  useParams: () => ({ yearMonth: "2026-09" }),
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
        <PayrollPeriodPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper({ locale }) },
  );
}

const ITEMS = [
  {
    id: "i-1",
    workerProfileId: "wp-1",
    standardDaysCredited: 21,
    regularMinutes: 10080,
    overtimeMinutes: 150,
    grossBaseAgorot: 840000,
    overtimeAgorot: 12350,
    positiveAdjustmentsAgorot: 5000,
    deductionsAgorot: 2500,
    netPayableAgorot: 854850,
    worker: { membership: { user: { fullLegalName: "Eli Ramzani" } } },
  },
  {
    id: "i-2",
    workerProfileId: "wp-2",
    standardDaysCredited: 3,
    regularMinutes: 1440,
    overtimeMinutes: 0,
    grossBaseAgorot: 123450,
    overtimeAgorot: 0,
    positiveAdjustmentsAgorot: 0,
    deductionsAgorot: 0,
    netPayableAgorot: 123450,
  },
];

function period(status: string, items: unknown[] = ITEMS) {
  return { id: "p-2", organizationId: "org-1", yearMonth: "2026-09", status, version: 2, items };
}

describe("Payroll period page", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the worker breakdown in Arabic with LTR money and the inline-start worker column", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods/2026-09": () => json(200, period("REVIEW")) });
    renderPage("ar");

    expect(await screen.findByRole("heading", { level: 1, name: /رواتب سبتمبر 2026/ })).toBeTruthy();
    expect(screen.getByText("قيد المراجعة")).toBeTruthy();
    expect(screen.getByText("الإصدار 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إقفال الفترة" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى الرواتب" }).getAttribute("href")).toBe("/payroll");

    // Total net = 8,548.50 + 1,234.50, rendered left-to-right inside the Arabic sentence.
    const total = screen.getByText("₪ 9,783.00");
    expect(total.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(total.closest("p")?.textContent).toBe("إجمالي الصافي: ₪ 9,783.00");

    const table = screen.getByRole("table", { name: "تفاصيل رواتب العمال لشهر سبتمبر 2026" });
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    const rows = within(table).getAllByRole("row");
    const eli = rows.find((row) => row.textContent?.includes("Eli Ramzani"));
    expect(eli).toBeTruthy();
    const cells = within(eli!).getAllByRole("cell");
    const header = within(eli!).getByRole("rowheader");
    expect(header.className).toContain("start-0");
    expect(header.className).toContain("text-start");
    expect(cells[0].textContent).toBe("21");
    expect(cells[1].textContent).toBe("168 س 0 د");
    expect(cells[2].textContent).toBe("2 س 30 د");
    expect(cells[3].textContent).toBe("₪ 8,523.50");
    expect(cells[4].textContent).toBe("إضافة:+₪ 50.00خصم:-₪ 25.00");
    expect(cells[5].textContent).toBe("₪ 8,548.50");
    for (const bdi of cells[5].querySelectorAll("bdi")) expect(bdi.getAttribute("dir")).toBe("ltr");
    // A worker without a loaded name falls back to the id, isolated LTR.
    expect(screen.getByText("wp-2").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    expect(screen.queryByText("REVIEW")).toBeNull();
  });

  it("renders in English", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods/2026-09": () => json(200, period("FINALIZED")) });
    renderPage("en");

    expect(await screen.findByRole("heading", { level: 1, name: /Payroll — September 2026/ })).toBeTruthy();
    expect(screen.getByText("Finalized")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finalize period" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Overtime" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Net" })).toBeTruthy();
    expect(screen.getByText("168h 0m")).toBeTruthy();
    expect(screen.getByText("Total net:", { exact: false }).textContent).toBe("Total net: ₪ 9,783.00");
  });

  it("shows the empty state when the period has no items", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods/2026-09": () => json(200, period("REVIEW", [])) });
    renderPage("ar");

    expect(await screen.findByText("لا توجد رواتب محتسبة لهذا الشهر")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a translated error with retry", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    mockApi({ "GET /payroll-periods/2026-09": () => (++calls === 1 ? apiError(503, "SERVICE_UNAVAILABLE") : json(200, period("REVIEW"))) });
    renderPage("ar");

    expect((await screen.findByRole("alert")).textContent).toContain("الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 1, name: /رواتب سبتمبر 2026/ })).toBeTruthy();
  });

  it("shows a page-specific state when the month was never calculated (404)", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods/2026-09": () => apiError(404, "NOT_FOUND", "Payroll period not found.") });
    renderPage("ar");

    expect(await screen.findByText("لم تُحتسب رواتب هذا الشهر بعد")).toBeTruthy();
    expect(screen.queryByText("Payroll period not found.")).toBeNull();
    expect(screen.getByRole("link", { name: "العودة إلى الرواتب" })).toBeTruthy();
  });

  it("shows the access-denied state on 403", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods/2026-09": () => apiError(403, "FORBIDDEN") });
    renderPage("en");

    expect(await screen.findByText("Access denied")).toBeTruthy();
  });

  it("never loads or renders figures for a Field Manager", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = mockApi({ "GET /payroll-periods/2026-09": () => json(200, period("REVIEW")) });
    renderPage("ar");

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText(/₪/)).toBeNull();
    expect(screen.queryByText("Eli Ramzani")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finalizes with a pending label, then shows a success message and the reopen action", async () => {
    seedSession(OrgRole.OWNER);
    let status = "REVIEW";
    let release: () => void = () => {};
    const fetchMock = mockApi({
      "GET /payroll-periods/2026-09": () => json(200, period(status)),
      "POST /payroll-periods/2026-09/finalize": () =>
        new Promise<Response>((resolve) => {
          release = () => {
            status = "FINALIZED";
            resolve(json(201, period("FINALIZED")));
          };
        }),
    });
    renderPage("ar");

    fireEvent.click(await screen.findByRole("button", { name: "إقفال الفترة" }));
    expect(((await screen.findByRole("button", { name: "جارٍ إقفال الفترة…" })) as HTMLButtonElement).disabled).toBe(true);
    release();

    const message = await screen.findByText("تم إقفال فترة الرواتب.");
    expect(message.getAttribute("role")).toBe("status");
    expect(await screen.findByRole("button", { name: "إعادة فتح" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/payroll-periods/2026-09/finalize") && init?.method === "POST")).toBe(true);
  });

  it("reopens with the audit reason and translates API errors", async () => {
    seedSession(OrgRole.OWNER);
    const fetchMock = mockApi({
      "GET /payroll-periods/2026-09": () => json(200, period("FINALIZED")),
      "POST /payroll-periods/2026-09/reopen": () => apiError(409, "CONFLICT", "Period is not finalized."),
    });
    renderPage("ar");

    fireEvent.click(await screen.findByRole("button", { name: "إعادة فتح" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("يتعارض هذا الإجراء مع الحالة الحالية للسجل. حدّث الصفحة وحاول مرة أخرى."),
    );
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/reopen"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ reason: "يلزم تصحيح بعد المراجعة" });
  });
});
