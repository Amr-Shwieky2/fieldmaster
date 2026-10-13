import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type DashboardDay } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { currentYearMonth } from "@/lib/business-date";
import { DAILY_TREND, FINANCIALS, financials } from "@/components/dashboard/__tests__/dashboard-fixtures";
import DashboardPage from "../page";

const mocks = vi.hoisted(() => ({
  auth: { session: null as unknown, client: null as unknown },
  replace: vi.fn(),
  chart: null as { days: unknown; label: string } | null,
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));
// Recharts stays out of the page test (the chart has its own test): the dynamically loaded chart is a
// stub that keeps the props it was given. Everything around it (legend, data table) is real.
vi.mock("next/dynamic", () => ({
  default: () =>
    function DailyTrendChartStub(props: { days: DashboardDay[]; label: string }) {
      mocks.chart = props;
      return <div data-testid="chart-stub" />;
    },
}));

const WORKERS = [
  { id: "w1", accountStatus: "ACTIVE" },
  { id: "w2", accountStatus: "ACTIVE" },
  { id: "w3", accountStatus: "PENDING_APPROVAL" },
];
const PENDING = [{ id: "te1" }, { id: "te2" }, { id: "te3" }];

function apiError(status: number, code: string) {
  return new ApiRequestError(status, { statusCode: status, code, message: `API says ${code}`, details: {}, correlationId: "c" });
}

function setup(
  role: OrgRole,
  overrides: Partial<Record<"listWorkers" | "listPendingAttendanceApprovals" | "getFinancialDashboard", ReturnType<typeof vi.fn>>> = {},
) {
  const client = {
    listWorkers: vi.fn(async () => WORKERS),
    listPendingAttendanceApprovals: vi.fn(async () => PENDING),
    getFinancialDashboard: vi.fn(async () => FINANCIALS),
    ...overrides,
  };
  mocks.auth = {
    client,
    session: { accessToken: "a", refreshToken: "r", organizationId: "o1", role, workerProfileId: null },
  };
  return client;
}

function renderPage() {
  return renderWithIntl(<DashboardPage />, { queryClient: true });
}

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
/**
 * UI wording of the removed English version and English names of the Step 7 widgets; none of it may
 * appear (project names are user data and may be Latin, e.g. "Highway 6 signs").
 */
const ENGLISH_UI_TEXT =
  /Dashboard|Overview for|Active workers|Pending approvals|Payroll this month|last month|Overtime cost|Cost by project|Unassigned|Financial exposure|Pending-approval estimate|Forgotten-stamp deductions|Owner|Net payable|Labor cost|Previous month|Difference|LIVE|FINALIZED|Version|Daily|Show data|Cost by (site|worker)|View all|Top earners|Overtime spike|Spike|compensation|Emergency/;

/** Every Owner-only widget, by its title. */
const FINANCIAL_TITLES = [
  /صافي المستحق للدفع/,
  "تكلفة الساعات الإضافية",
  "خصومات نسيان تسجيل",
  "تكلفة استدعاءات الطوارئ",
  "تقدير تكلفة الحضور بانتظار الموافقة",
  "حضور معتمد بلا أجر مسجّل",
  "تكلفة العمل اليومية",
  "التكلفة حسب المشروع",
  "التكلفة حسب الموقع",
  "التكلفة حسب العامل",
  "الأعلى أجراً",
  "أيام الارتفاع الحاد في الساعات الإضافية",
];

describe("Dashboard page", () => {
  beforeEach(() => {
    mocks.replace.mockClear();
    mocks.chart = null;
  });

  it("renders the Owner dashboard in Arabic with money as ₪ in Western digits", async () => {
    const client = setup(OrgRole.OWNER);
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "لوحة التحكم" })).toBeTruthy();
    // The headline: the month's net payable, where it comes from, and the previous month.
    expect(await screen.findByText("₪ 12,345.67")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "صافي المستحق للدفع في أكتوبر 2026" })).toBeTruthy();
    expect(screen.getByText("تقدير مباشر من الحضور المعتمد حتى الآن")).toBeTruthy();
    expect(screen.getByText("صافي الشهر السابق").nextElementSibling?.textContent).toBe("₪ 10,000.00من الرواتب المعتمدة نهائياً");
    expect(screen.getByText("الفرق").nextElementSibling?.textContent).toBe("+₪ 2,345.67");
    expect(screen.getByText("نسبة التغيير").nextElementSibling?.textContent).toBe("+23.5%");
    // Money is bidi-isolated left-to-right, also inside Arabic sentences.
    expect(screen.getByText("₪ 12,345.67").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("₪ 10,000.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // Counts in Western digits.
    expect(screen.getByText("العمال النشطون").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("حضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("3");
    // The money cards, including the forgotten-stamp deductions and the pending-approval estimate.
    expect(screen.getByText("تكلفة الساعات الإضافية").nextElementSibling?.textContent).toBe("₪ 980.50");
    expect(screen.getByText("خصومات نسيان تسجيل").nextElementSibling?.textContent).toBe("₪ 150.00");
    expect(screen.getByText("تكلفة استدعاءات الطوارئ").nextElementSibling?.textContent).toBe("₪ 640.00");
    expect(screen.getByText("تقدير تكلفة الحضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("₪ 4,321.00");
    // Cost by project, with the bucket without a project in Arabic.
    const projects = screen.getByRole("list", { name: "التكلفة حسب المشروع" });
    expect(within(projects).getByText("Highway 6 signs")).toBeTruthy();
    expect(within(projects).getByText("بدون مشروع")).toBeTruthy();
    expect(within(projects).getByText("₪ 8,000.00")).toBeTruthy();
    // Role badge from the glossary.
    expect(screen.getByText("المالك")).toBeTruthy();
    expect(screen.queryByText("الأرقام المالية تظهر للمالك فقط.")).toBeNull();
    expect(document.body.textContent).not.toMatch(ARABIC_INDIC_DIGITS);
    // Arabic only: no English UI text and no language switch.
    expect(document.body.textContent).not.toMatch(ENGLISH_UI_TEXT);
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
    expect(client.getFinancialDashboard).toHaveBeenCalledTimes(1);
    expect(client.getFinancialDashboard).toHaveBeenCalledWith(currentYearMonth());
  });

  it("shows an Owner every financial widget of the month", async () => {
    setup(OrgRole.OWNER);
    renderPage();
    await screen.findByText("₪ 12,345.67");

    for (const title of FINANCIAL_TITLES) expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    // Daily trend: the chart region with the month's days, and the same data as a table.
    expect(screen.getByRole("figure", { name: "تكلفة العمل اليومية" })).toBeTruthy();
    expect(mocks.chart?.days).toEqual(DAILY_TREND);
    const trendTable = screen.getByRole("table", { name: "تكلفة العمل اليومية في أكتوبر 2026" });
    expect(within(trendTable).getByRole("row", { name: /7 أكتوبر 2026/ }).textContent).toContain("ارتفاع حاد");
    // Cost by site and by worker, with the link to the month's payroll.
    expect(within(screen.getByRole("list", { name: "التكلفة حسب الموقع" })).getByText("بدون موقع")).toBeTruthy();
    const workers = screen.getByRole("table", { name: "تكلفة العمل وصافي المستحق للعمال الأعلى أجراً في أكتوبر 2026" });
    expect(within(workers).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByRole("link", { name: "عرض كل العمال" }).getAttribute("href")).toBe("/payroll/2026-10");
    expect(within(screen.getByRole("list", { name: "الأعلى أجراً" })).getAllByRole("listitem")).toHaveLength(5);
    // Overtime spikes with the rule, and the warning about approved attendance without a rate.
    expect(screen.getByText(/^يوم ارتفاع حاد:/).textContent).toContain("لا تقل عن 2 أضعاف المعدل اليومي (1 س 30 د) ولا عن 2 س 0 د");
    expect(screen.getAllByTestId("overtime-spike")).toHaveLength(1);
    const warning = screen.getByRole("region", { name: "حضور معتمد بلا أجر مسجّل" });
    expect(within(warning).getByRole("link", { name: "رامي سعيد" }).getAttribute("href")).toBe("/workers/wp-13");
  });

  it("draws the cost bars relative to the most expensive project, without physical left/right styles", async () => {
    setup(OrgRole.OWNER);
    renderPage();
    const projects = await screen.findByRole("list", { name: "التكلفة حسب المشروع" });
    const bars = within(projects)
      .getAllByTestId("cost-bar-track")
      .map((track) => track.firstElementChild as HTMLElement);
    expect(bars.map((bar) => bar.style.width)).toEqual(["100%", "25%"]);
    for (const bar of bars) {
      expect(bar.style.left).toBe("");
      expect(bar.style.right).toBe("");
    }
  });

  it("shows a Field Manager no money and the owners-only message", async () => {
    const client = setup(OrgRole.FIELD_MANAGER);
    renderPage();

    expect(await screen.findByText("الأرقام المالية تظهر للمالك فقط.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "لوحة التحكم" })).toBeTruthy();
    expect(screen.getByText("مدير ميدان")).toBeTruthy();
    // No money anywhere in the DOM, no financial widget, and the financial endpoint is never called.
    expect(document.body.textContent).not.toContain("₪");
    for (const title of FINANCIAL_TITLES) expect(screen.queryByText(title)).toBeNull();
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: "عرض كل العمال" })).toBeNull();
    expect(mocks.chart).toBeNull();
    expect(client.getFinancialDashboard).not.toHaveBeenCalled();
    // The non-financial counts are still shown.
    expect(screen.getByText("العمال النشطون").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("حضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("3");
    expect(document.body.textContent).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it("shows a page-specific empty state when no project has costs yet", async () => {
    setup(OrgRole.OWNER, { getFinancialDashboard: vi.fn(async () => financials({ costByProject: [] })) });
    renderPage();
    expect(await screen.findByText("لا توجد تكاليف بعد")).toBeTruthy();
    expect(screen.getByText("لا توجد هذا الشهر بعد ورديات تمت الموافقة عليها واحتُسبت تكلفتها.")).toBeTruthy();
  });

  it("shows the Owner a loading state for the financial figures, keeping the counts", async () => {
    setup(OrgRole.OWNER, { getFinancialDashboard: vi.fn(() => new Promise(() => {})) });
    renderPage();

    expect(await screen.findByText("جارٍ تحميل الأرقام المالية…")).toBeTruthy();
    expect(screen.getByText("العمال النشطون").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("حضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("3");
    expect(document.body.textContent).not.toContain("₪");
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("shows a translated error with retry when the base data fails, then recovers", async () => {
    const listWorkers = vi.fn().mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR")).mockResolvedValue(WORKERS);
    setup(OrgRole.FIELD_MANAGER, { listWorkers });
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    expect(alert.textContent).not.toContain("API says");
    expect(screen.getByRole("heading", { level: 1, name: "لوحة التحكم" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(listWorkers).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("الأرقام المالية تظهر للمالك فقط.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a translated error with retry when the Owner's financial figures fail, keeping the counts", async () => {
    const getFinancialDashboard = vi.fn().mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR")).mockResolvedValue(FINANCIALS);
    setup(OrgRole.OWNER, { getFinancialDashboard });
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    expect(alert.textContent).not.toContain("API says");
    // The non-financial counts still render; no money is shown while the figures are missing.
    expect(screen.getByText("العمال النشطون").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("حضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("3");
    expect(document.body.textContent).not.toContain("₪");
    fireEvent.click(within(alert).getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("₪ 12,345.67")).toBeTruthy();
    expect(getFinancialDashboard).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows access denied when the API refuses the financial figures (403)", async () => {
    setup(OrgRole.OWNER, { getFinancialDashboard: vi.fn().mockRejectedValue(apiError(403, "FORBIDDEN")) });
    renderPage();
    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(document.body.textContent).not.toContain("₪");
  });
});
