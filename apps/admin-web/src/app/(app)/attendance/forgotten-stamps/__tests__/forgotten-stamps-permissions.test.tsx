import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Permission } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { infractions } from "@/test/attendance-fixtures";
import { ACCOUNTANT, COORDINATOR, authWithAccess, myAccess } from "@/test/access-fixtures";
import ForgottenStampsPage from "../page";

// Flexible organization model: the deductions are money (VIEW_FINANCIALS) and cancelling one is a payroll
// action (MANAGE_PAYROLL), whatever the member's role is called.

const client = vi.hoisted(() => ({ listForgottenStampInfractions: vi.fn(), reverseForgottenStampInfraction: vi.fn() }));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/attendance/forgotten-stamps",
  useSearchParams: () => new URLSearchParams("month=2026-10"),
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub() {
      return <div data-testid="map" />;
    },
}));

const REVERSE_THIRD = "إلغاء خصم المخالفة رقم 3 لـخالد ناصر";

function renderPage() {
  return renderWithIntl(<ForgottenStampsPage />, { queryClient: true });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Forgotten stamps by permission", () => {
  it("shows a custom role without money who did what, never an amount", async () => {
    auth.value = authWithAccess(COORDINATOR, client);
    client.listForgottenStampInfractions.mockResolvedValue(infractions(false));
    renderPage();

    expect(await screen.findByText("المخالفة رقم 3")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "الخصم" })).toBeNull();
    expect(screen.queryByRole("button", { name: REVERSE_THIRD })).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows a custom role that may see money the amounts, and lets it cancel a deduction (it manages payroll)", async () => {
    auth.value = authWithAccess(ACCOUNTANT, client);
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true));
    renderPage();

    expect(await screen.findByRole("button", { name: REVERSE_THIRD })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "الخصم" })).toBeTruthy();
    expect(screen.getAllByText("₪ 10.00").length).toBeGreaterThan(0);
  });

  it("shows the amounts without the cancel action to a member who sees money but does not manage payroll", async () => {
    auth.value = authWithAccess(myAccess({ roleName: "مراجع مالي", permissions: [Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS] }), client);
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true));
    renderPage();

    expect(await screen.findByRole("columnheader", { name: "الخصم" })).toBeTruthy();
    expect(screen.getAllByText("₪ 10.00").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: REVERSE_THIRD })).toBeNull();
  });
});
