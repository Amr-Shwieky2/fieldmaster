import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { Nav } from "../nav";

const auth = vi.hoisted(() => ({
  role: "OWNER" as string,
  client: { listDevLoginUsers: vi.fn() },
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { role: auth.role }, client: auth.client }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const SIMULATOR = "محاكي العامل (تجريبي)";

function renderNav(role: OrgRole, devMode: boolean) {
  auth.role = role;
  // The API answers /auth/dev/users with 404 when dev login is off; the client maps that to null.
  auth.client.listDevLoginUsers.mockResolvedValue(devMode ? [] : null);
  return renderWithIntl(<Nav />, { queryClient: true });
}

beforeEach(() => {
  auth.client.listDevLoginUsers.mockReset();
});

describe("Nav: worker simulator entry", () => {
  it.each([OrgRole.OWNER, OrgRole.FIELD_MANAGER])("is shown to a %s with the test-mode badge while dev login is on", async (role) => {
    renderNav(role, true);
    const link = await screen.findByRole("link", { name: /محاكي العامل/ });
    expect(link.getAttribute("href")).toBe("/dev/worker-simulator");
    expect(link.textContent).toContain(SIMULATOR);
    expect(link.textContent).toContain("وضع الاختبار");
  });

  it("is not rendered at all when dev login is off", async () => {
    renderNav(OrgRole.OWNER, false);
    await waitFor(() => expect(auth.client.listDevLoginUsers).toHaveBeenCalled());
    expect(await screen.findByRole("link", { name: "لوحة التحكم" })).toBeTruthy();
    expect(screen.queryByText(SIMULATOR)).toBeNull();
  });

  it("is not shown to a Worker", async () => {
    renderNav(OrgRole.WORKER, true);
    await waitFor(() => expect(auth.client.listDevLoginUsers).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(SIMULATOR)).toBeNull();
  });
});
