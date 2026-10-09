import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { sessionStore } from "@/lib/session-store";
import { createIntlWrapper } from "@/test/render-with-intl";
import PayrollPage from "../page";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payroll",
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

/** Attributes a user reads (tooltip, placeholder) or hears from a screen reader (accessible name, alt text). */
const READABLE_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];

/** Distinct Latin-script words on the page, read per text node (so adjacent elements do not merge) and per readable attribute. */
function latinWordsOnPage(): { text: string[]; attributes: string[] } {
  const collect = (values: Iterable<string | null>) => {
    const words = new Set<string>();
    for (const value of values) for (const word of value?.match(/[A-Za-z]+/g) ?? []) words.add(word);
    return [...words].sort();
  };
  const texts: (string | null)[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node.textContent);
  const attributes = [...document.body.querySelectorAll("*")].flatMap((el) => READABLE_ATTRIBUTES.map((name) => el.getAttribute(name)));
  return { text: collect(texts), attributes: collect(attributes) };
}

function seedSession(role: OrgRole) {
  sessionStore.save({ accessToken: "test-access", refreshToken: "test-refresh", organizationId: "org-1", role, workerProfileId: null });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PayrollPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
}

const PERIODS = [
  { id: "p-2", organizationId: "org-1", yearMonth: "2026-09", status: "REVIEW", version: 2 },
  { id: "p-1", organizationId: "org-1", yearMonth: "2026-08", status: "FINALIZED", version: 1 },
];

describe("Payroll list page", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the payroll periods with Arabic month names, Western digits and translated statuses", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods": () => json(200, PERIODS) });
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "الرواتب" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "فترات الرواتب" })).toBeTruthy();
    const link = await screen.findByRole("link", { name: "سبتمبر 2026" });
    expect(link.getAttribute("href")).toBe("/payroll/2026-09");
    expect(screen.getByText("قيد المراجعة")).toBeTruthy();
    expect(screen.getByText("مُقفلة")).toBeTruthy();
    expect(screen.getByRole("link", { name: "أغسطس 2026" }).getAttribute("href")).toBe("/payroll/2026-08");
    expect(screen.getByRole("button", { name: /^احتساب رواتب / })).toBeTruthy();
    // No raw enum values, no Arabic-Indic digits.
    expect(screen.queryByText("REVIEW")).toBeNull();
    expect(screen.queryByText("FINALIZED")).toBeNull();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    // Table accessibility, translated column headers and RTL-safe alignment.
    const table = screen.getByRole("table", { name: "فترات الرواتب مع رقم الإصدار والحالة" });
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual(["الشهر", "الإصدار", "الحالة"]);
    for (const th of headers) {
      expect(th.getAttribute("scope")).toBe("col");
      expect(th.className).toContain("text-start");
    }
    // The version column shows the period version in Western digits.
    const septemberRow = screen.getByRole("link", { name: "سبتمبر 2026" }).closest("tr") as HTMLElement;
    expect(within(septemberRow).getAllByRole("cell")[1].textContent).toBe("2");
    // Arabic only: no language switch and no English (or any Latin-script) text on the page, neither in visible
    // text nor in accessible names, tooltips or placeholders.
    expect(screen.queryByRole("button", { name: /English/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/[A-Za-z]/);
    expect(latinWordsOnPage()).toEqual({ text: [], attributes: [] });
  });

  it("shows the empty state when no period was calculated yet", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods": () => json(200, []) });
    renderPage();

    expect(await screen.findByText("لا توجد فترات رواتب بعد")).toBeTruthy();
    expect(screen.getByText("احتسب رواتب الشهر الحالي للبدء.")).toBeTruthy();
  });

  it("shows a translated error with a retry button that reloads the list", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    mockApi({ "GET /payroll-periods": () => (++calls === 1 ? apiError(500, "INTERNAL_ERROR") : json(200, PERIODS)) });
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    expect(alert.textContent).not.toContain("English API message");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("link", { name: "سبتمبر 2026" })).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("shows the access-denied state when the API answers 403", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods": () => apiError(403, "FORBIDDEN") });
    renderPage();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" })).toBeTruthy();
  });

  it("never loads or renders payroll for a Field Manager and redirects to the dashboard", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = mockApi({ "GET /payroll-periods": () => json(200, PERIODS) });
    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("heading", { name: "الرواتب" })).toBeNull();
    expect(screen.queryByText("سبتمبر 2026")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calculates the current month with an Idempotency-Key, shows the pending label and a success message", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    let release: () => void = () => {};
    const fetchMock = mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(201, { id: "p-3", organizationId: "org-1", yearMonth, status: "REVIEW", version: 1 }));
        }),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^احتساب رواتب / }));
    const pending = await screen.findByRole("button", { name: "جارٍ الاحتساب…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(`/payroll-periods/${yearMonth}/calculate`));
    expect(call?.[1]?.method).toBe("POST");
    expect((call?.[1]?.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^web-calc-\d+$/);

    release();
    const message = await screen.findByText(/^تم احتساب رواتب .+ راجعها قبل إقفال الفترة\.$/);
    expect(message.getAttribute("role")).toBe("status");
    expect(message.closest("[aria-live]")).toBeTruthy();
  });

  it("translates a calculation error from its API code", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () => apiError(409, "PAYROLL_PERIOD_FINALIZED"),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^احتساب رواتب / }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("فترة الرواتب هذه مُقفلة. أعد فتحها لإجراء التعديلات."));
  });

  it("shows the Arabic status-level message for an unknown API code, never the English API message", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () => apiError(409, "SOME_FUTURE_PAYROLL_CODE", "Payroll is being calculated elsewhere."),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^احتساب رواتب / }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("لا يمكن تنفيذ هذا الإجراء الآن لأن البيانات تغيّرت. حدّث البيانات وحاول مرة أخرى."),
    );
    expect(screen.queryByText(/calculated elsewhere/)).toBeNull();
  });
});
