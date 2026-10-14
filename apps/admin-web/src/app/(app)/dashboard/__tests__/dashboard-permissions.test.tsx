import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { FINANCIALS } from "@/components/dashboard/__tests__/dashboard-fixtures";
import { ACCOUNTANT, COORDINATOR, RESTRICTED_OWNER, authWithAccess } from "@/test/access-fixtures";
import DashboardPage from "../page";

// Flexible organization model: each part of the dashboard follows the member's permissions (the financial
// figures need VIEW_FINANCIAL_DASHBOARD), and a member restricted to some projects is told so.

const client = vi.hoisted(() => ({
  listWorkers: vi.fn(),
  listPendingAttendanceApprovals: vi.fn(),
  getFinancialDashboard: vi.fn(),
}));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DailyTrendChartStub() {
      return <div data-testid="chart-stub" />;
    },
}));

const MONEY_NOTE = "الأرقام المالية تظهر للمالك فقط.";
const RESTRICTED_NOTE =
  "عرض مقيَّد بمشاريعك: ترى ما يخص المشاريع والمواقع المحددة لك فقط، ولا تظهر لك صفحات المؤسسة كلها (الرواتب وسجل التدقيق والمستخدمون والأدوار والإعدادات).";

function renderPage() {
  return renderWithIntl(<DashboardPage />, { queryClient: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  client.listWorkers.mockResolvedValue([{ id: "w1", accountStatus: "ACTIVE" }]);
  client.listPendingAttendanceApprovals.mockResolvedValue([{ id: "te1" }, { id: "te2" }]);
  client.getFinancialDashboard.mockResolvedValue(FINANCIALS);
});

describe("Dashboard by permission", () => {
  it("shows a custom role with the financial dashboard its figures, under the role's own name, and asks only for what it may see", async () => {
    auth.value = authWithAccess(ACCOUNTANT, client);
    renderPage();

    expect(await screen.findByText("₪ 12,345.67")).toBeTruthy();
    expect(screen.getByText("محاسب")).toBeTruthy();
    expect(screen.queryByText(MONEY_NOTE)).toBeNull();
    // No worker list or approvals in this role: neither count is asked for or shown.
    expect(client.listWorkers).not.toHaveBeenCalled();
    expect(client.listPendingAttendanceApprovals).not.toHaveBeenCalled();
    expect(screen.queryByText("العمال النشطون")).toBeNull();
    expect(screen.queryByText("حضور بانتظار الموافقة")).toBeNull();
  });

  it("never shows a custom role without money any figure, and never asks for them", async () => {
    auth.value = authWithAccess(COORDINATOR, client);
    renderPage();

    expect(await screen.findByText(MONEY_NOTE)).toBeTruthy();
    expect(screen.getByText("حضور بانتظار الموافقة").nextElementSibling?.textContent).toBe("2");
    expect(client.getFinancialDashboard).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("tells a member restricted to some projects, who has no financial dashboard (organization-wide)", async () => {
    auth.value = authWithAccess(RESTRICTED_OWNER, client);
    renderPage();

    expect((await screen.findByText("العمال النشطون")).nextElementSibling?.textContent).toBe("1");
    expect(screen.getByText(RESTRICTED_NOTE)).toBeTruthy();
    expect(client.getFinancialDashboard).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("₪");
  });
});
