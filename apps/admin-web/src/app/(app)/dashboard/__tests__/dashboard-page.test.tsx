import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type FinancialDashboard } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import DashboardPage from "../page";

const mocks = vi.hoisted(() => ({
  auth: { session: null as unknown, client: null as unknown },
  replace: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const WORKERS = [
  { id: "w1", accountStatus: "ACTIVE" },
  { id: "w2", accountStatus: "ACTIVE" },
  { id: "w3", accountStatus: "PENDING_APPROVAL" },
];
const PENDING = [{ id: "te1" }, { id: "te2" }, { id: "te3" }];
const FINANCIALS: FinancialDashboard = {
  yearMonth: "2026-10",
  totalCurrentMonthPayrollAgorot: 1234567,
  totalPreviousMonthPayrollAgorot: 1000000,
  overtimeTotalAgorot: 98050,
  forgottenStampDeductionsAgorot: 15000,
  pendingApprovalFinancialExposureAgorot: 432100,
  costByProject: [
    { projectId: "p1", projectName: "Highway 6 signs", totalAgorot: 800000 },
    { projectId: null, projectName: "Unassigned", totalAgorot: 200000 },
  ],
};

function apiError(status: number, code: string) {
  return new ApiRequestError(status, { statusCode: status, code, message: `API says ${code}`, details: {}, correlationId: "c" });
}

function setup(role: OrgRole, overrides: Partial<Record<"listWorkers" | "listPendingAttendanceApprovals" | "getFinancialDashboard", ReturnType<typeof vi.fn>>> = {}) {
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
/** UI wording of the removed English version; none of it may appear (project names are user data and may be Latin). */
const ENGLISH_UI_TEXT = /Dashboard|Overview for|Active workers|Pending approvals|Payroll this month|last month|Overtime cost|Cost by project|Unassigned|Financial exposure|Pending-approval estimate|Forgotten-stamp deductions|Owner/;

describe("Dashboard page", () => {
  beforeEach(() => {
    mocks.replace.mockClear();
  });

  it("renders the Owner dashboard in Arabic with money as ₪ in Western digits", async () => {
    const client = setup(OrgRole.OWNER);
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "لوحة التحكم" })).toBeTruthy();
    expect(await screen.findByText("₪ 12,345.67")).toBeTruthy();
    expect(screen.getByText("رواتب هذا الشهر")).toBeTruthy();
    expect(screen.getByText("تكلفة الساعات الإضافية")).toBeTruthy();
    expect(screen.getByText("₪ 980.50")).toBeTruthy();
    // Previous month: the amount sits inside the Arabic sentence as an LTR isolate.
    const previous = screen.getByText("₪ 10,000.00");
    expect(previous.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(previous.parentElement?.textContent).toBe("مقابل ₪ 10,000.00 في الشهر الماضي");
    // Money is bidi-isolated left-to-right.
    expect(screen.getByText("₪ 12,345.67").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // Counts in Western digits.
    expect(screen.getByText("العمال النشطون").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("حضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("3");
    // Cost by project, with the unassigned bucket translated (the API sends English "Unassigned").
    expect(screen.getByText("التكلفة حسب المشروع")).toBeTruthy();
    expect(screen.getByText("Highway 6 signs")).toBeTruthy();
    expect(screen.getByText("بدون مشروع")).toBeTruthy();
    expect(screen.queryByText("Unassigned")).toBeNull();
    expect(screen.getByText("₪ 8,000.00")).toBeTruthy();
    // Financial exposure.
    expect(screen.getByText("مبالغ معلّقة وخصومات")).toBeTruthy();
    expect(screen.getByText("خصومات نسيان تسجيل")).toBeTruthy();
    expect(screen.getByText("₪ 150.00")).toBeTruthy();
    expect(screen.getByText("تقدير تكلفة الحضور بانتظار الموافقة")).toBeTruthy();
    expect(screen.getByText("₪ 4,321.00")).toBeTruthy();
    // Role badge from the glossary.
    expect(screen.getByText("المالك")).toBeTruthy();
    expect(screen.queryByText("الأرقام المالية تظهر للمالك فقط.")).toBeNull();
    expect(document.body.textContent).not.toMatch(ARABIC_INDIC_DIGITS);
    // Arabic only: no English UI text and no language switch.
    expect(document.body.textContent).not.toMatch(ENGLISH_UI_TEXT);
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
    expect(client.getFinancialDashboard).toHaveBeenCalledTimes(1);
  });

  it("draws the cost bars relative to the most expensive project, without physical left/right styles", async () => {
    setup(OrgRole.OWNER);
    renderPage();
    await screen.findByText("₪ 8,000.00");
    const bars = screen.getAllByTestId("cost-bar-track").map((track) => track.firstElementChild as HTMLElement);
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
    // No money anywhere in the DOM, and the financial endpoint is never called.
    expect(document.body.textContent).not.toContain("₪");
    expect(screen.queryByText("رواتب هذا الشهر")).toBeNull();
    expect(screen.queryByText("تكلفة الساعات الإضافية")).toBeNull();
    expect(screen.queryByText("التكلفة حسب المشروع")).toBeNull();
    expect(screen.queryByText("مبالغ معلّقة وخصومات")).toBeNull();
    expect(client.getFinancialDashboard).not.toHaveBeenCalled();
    // The non-financial counts are still shown.
    expect(screen.getByText("العمال النشطون").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("حضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("3");
  });

  it("shows a page-specific empty state when no project has costs yet", async () => {
    setup(OrgRole.OWNER, { getFinancialDashboard: vi.fn(async () => ({ ...FINANCIALS, costByProject: [] })) });
    renderPage();
    expect(await screen.findByText("لا توجد تكاليف بعد")).toBeTruthy();
    expect(screen.getByText("لا توجد هذا الشهر بعد ورديات تمت الموافقة عليها واحتُسبت تكلفتها.")).toBeTruthy();
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
