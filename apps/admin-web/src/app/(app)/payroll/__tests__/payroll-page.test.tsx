import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { createIntlWrapper } from "@/test/render-with-intl";
import {
  PERIODS,
  UUID,
  apiError,
  json,
  latinWordsOnPage,
  mockApi,
  requestsTo,
  run,
  seedSession,
  textOf,
} from "@/components/payroll/__tests__/payroll-test-utils";
import PayrollPage from "../page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payroll",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PayrollPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
  return queryClient;
}

const CALCULATE_BUTTON = /^احسب رواتب /;

describe("Payroll list page", () => {
  beforeEach(() => {
    nav.replace.mockClear();
    nav.push.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists every month's latest version with Arabic month names, Western digits, LTR money and translated statuses", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods": () => json(200, PERIODS) });
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "الرواتب" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "فترات الرواتب" })).toBeTruthy();
    const link = await screen.findByRole("link", { name: "سبتمبر 2026" });
    expect(link.getAttribute("href")).toBe("/payroll/2026-09");
    expect(screen.getByRole("link", { name: "أغسطس 2026" }).getAttribute("href")).toBe("/payroll/2026-08");
    expect(screen.getByText("قيد المراجعة")).toBeTruthy();
    expect(screen.getByText("معتمدة نهائياً")).toBeTruthy();
    expect(screen.getByText("مفتوحة")).toBeTruthy();
    expect(screen.getByRole("button", { name: CALCULATE_BUTTON })).toBeTruthy();
    // No raw enum values, no Arabic-Indic digits.
    for (const raw of ["REVIEW", "FINALIZED", "OPEN"]) expect(screen.queryByText(raw)).toBeNull();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);

    // Table accessibility, translated column headers and RTL-safe alignment (numbers at the inline end).
    const table = screen.getByRole("table", {
      name: "رواتب كل شهر: الإصدار الحالي وعدد الإصدارات والحالة والعمال وصافي الرواتب وآخر احتساب والاعتماد النهائي",
    });
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual([
      "الشهر",
      "الإصدار",
      "عدد الإصدارات",
      "الحالة",
      "العمال",
      "صافي الرواتب",
      "آخر احتساب",
      "الاعتماد النهائي",
    ]);
    for (const th of headers) {
      expect(th.getAttribute("scope")).toBe("col");
      expect(th.className).toMatch(/\btext-(start|end)\b/);
    }

    // September: version 2 of 2, 2 workers, the net and the last calculation (11:30 in Jerusalem), not finalized.
    const september = within(link.closest("tr") as HTMLElement).getAllByRole("cell");
    expect(september.map(textOf)).toEqual(["سبتمبر 2026", "2", "2", "قيد المراجعة", "2", "₪ 9,783.00", "2 أكتوبر 2026 في 11:30", "—"]);
    expect(within(september[5]).getByText("₪ 9,783.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // August: finalized.
    const august = within(screen.getByRole("link", { name: "أغسطس 2026" }).closest("tr") as HTMLElement).getAllByRole("cell");
    expect(august.map(textOf)).toEqual(["أغسطس 2026", "1", "1", "معتمدة نهائياً", "3", "₪ 15,230.75", "1 سبتمبر 2026 في 09:00", "2 سبتمبر 2026 في 10:15"]);
    // October: never calculated -- workers, net and dates are a dash.
    const october = within(screen.getByRole("link", { name: "أكتوبر 2026" }).closest("tr") as HTMLElement).getAllByRole("cell");
    expect(october.map(textOf)).toEqual(["أكتوبر 2026", "1", "1", "مفتوحة", "—", "—", "—", "—"]);

    // Arabic only: no language switch and no English (or any Latin-script) text on the page, neither in visible
    // text nor in accessible names, tooltips or placeholders.
    expect(screen.queryByRole("button", { name: /English/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/[A-Za-z]/);
    expect(latinWordsOnPage()).toEqual({ text: [], attributes: [] });
  });

  it("shows the empty state when no month was calculated yet", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ "GET /payroll-periods": () => json(200, []) });
    renderPage();

    expect(await screen.findByText("لا توجد فترات رواتب بعد")).toBeTruthy();
    expect(screen.getByText("احسب رواتب الشهر الحالي للبدء.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a loading state until the list arrives", async () => {
    seedSession(OrgRole.OWNER);
    let release: () => void = () => {};
    mockApi({ "GET /payroll-periods": () => new Promise<Response>((resolve) => (release = () => resolve(json(200, PERIODS)))) });
    renderPage();

    expect(await screen.findByText("جارٍ التحميل…")).toBeTruthy();
    release();
    expect(await screen.findByRole("link", { name: "سبتمبر 2026" })).toBeTruthy();
    expect(screen.queryByText("جارٍ التحميل…")).toBeNull();
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

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("heading", { name: "الرواتب" })).toBeNull();
    expect(screen.queryByText("سبتمبر 2026")).toBeNull();
    expect(screen.queryByText(/₪/)).toBeNull();
    expect(screen.queryByRole("button", { name: CALCULATE_BUTTON })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts the current month's calculation with a new Idempotency-Key and opens the month to show its progress", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    const queued = run({
      id: "run-9",
      yearMonth,
      version: 1,
      state: "QUEUED",
      progress: 0,
      processedWorkers: 0,
      totalWorkers: 0,
      startedAt: null,
      finishedAt: null,
    });
    let release: () => void = () => {};
    const fetchMock = mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () => new Promise<Response>((resolve) => (release = () => resolve(json(202, queued)))),
    });
    const queryClient = renderPage();

    const button = await screen.findByRole("button", { name: CALCULATE_BUTTON });
    // The current business month, by its Arabic name.
    const [year, month] = yearMonth.split("-");
    expect(button.textContent).toBe(
      `احسب رواتب ${["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][Number(month) - 1]} ${year}`,
    );
    fireEvent.click(button);
    const pending = await screen.findByRole("button", { name: "جارٍ الاحتساب…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);

    const [request] = requestsTo(fetchMock, "POST", `/payroll-periods/${yearMonth}/calculate`);
    expect(request.headers["Idempotency-Key"]).toMatch(UUID);
    expect(request.body).toBeUndefined();
    expect(nav.push).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/payroll/${yearMonth}`));
    // The month page starts from the queued run without waiting for the first poll.
    expect(queryClient.getQueryData(["payroll-calculation", yearMonth])).toEqual(queued);
  });

  it("uses a new Idempotency-Key for every click", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    const fetchMock = mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () => apiError(500, "INTERNAL_ERROR"),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: CALCULATE_BUTTON }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: CALCULATE_BUTTON }));
    await waitFor(() => expect(requestsTo(fetchMock, "POST", `/payroll-periods/${yearMonth}/calculate`)).toHaveLength(2));
    const [first, second] = requestsTo(fetchMock, "POST", `/payroll-periods/${yearMonth}/calculate`).map((request) => request.headers["Idempotency-Key"]);
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("explains that a calculation is already running (409) and links to the month to follow it", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () => apiError(409, "PAYROLL_CALCULATION_IN_PROGRESS", "A calculation is already running."),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: CALCULATE_BUTTON }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("يجري احتساب رواتب هذا الشهر الآن. انتظر حتى ينتهي ثم حاول مرة أخرى.")).toBeTruthy();
    expect(
      within(alert)
        .getByRole("link", { name: /^عرض رواتب / })
        .getAttribute("href"),
    ).toBe(`/payroll/${yearMonth}`);
    expect(screen.queryByText(/already running/)).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("translates a calculation error from its API code", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () => apiError(409, "PAYROLL_PERIOD_FINALIZED"),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: CALCULATE_BUTTON }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("رواتب هذا الشهر معتمدة نهائياً. أعد فتحها لإجراء التعديلات."));
  });

  it("shows the Arabic status-level message for an unknown API code, never the English API message", async () => {
    seedSession(OrgRole.OWNER);
    const yearMonth = currentYearMonth();
    mockApi({
      "GET /payroll-periods": () => json(200, PERIODS),
      [`POST /payroll-periods/${yearMonth}/calculate`]: () => apiError(409, "SOME_FUTURE_PAYROLL_CODE", "Payroll is being calculated elsewhere."),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: CALCULATE_BUTTON }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("لا يمكن تنفيذ هذا الإجراء الآن لأن البيانات تغيّرت. حدّث البيانات وحاول مرة أخرى."),
    );
    expect(screen.queryByText(/calculated elsewhere/)).toBeNull();
  });
});
