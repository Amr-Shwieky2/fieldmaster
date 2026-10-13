import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { Nav } from "../nav";

// Step 8: the worker invitations have a nav entry (Owners and Field Managers), next to the workers.
const state = vi.hoisted(() => ({
  role: "OWNER" as string,
  pathname: "/dashboard",
  client: { listDevLoginUsers: vi.fn() },
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { role: state.role }, client: state.client }) }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

const INVITATIONS = { name: "دعوات العمال", href: "/workers/invitations" };
const WORKERS = { name: "العمال", href: "/workers" };

async function renderNav(role: OrgRole, pathname = "/dashboard") {
  state.role = role;
  state.pathname = pathname;
  const view = renderWithIntl(<Nav />, { queryClient: true });
  // Dev login off: the API answers 404, which the client maps to null.
  await waitFor(() => expect(state.client.listDevLoginUsers).toHaveBeenCalled());
  return view;
}

function mainNav() {
  return within(screen.getByRole("navigation", { name: "القائمة الرئيسية" }));
}

function currentLinks(): (string | null)[] {
  return mainNav()
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

beforeEach(() => {
  state.client.listDevLoginUsers.mockReset();
  state.client.listDevLoginUsers.mockResolvedValue(null);
});

describe("Nav: Step 8 entries", () => {
  it.each([OrgRole.OWNER, OrgRole.FIELD_MANAGER])("shows a %s the worker invitations right after the workers", async (role) => {
    await renderNav(role);
    const link = mainNav().getByRole("link", { name: INVITATIONS.name });
    expect(link.getAttribute("href")).toBe(INVITATIONS.href);
    expect(link.getAttribute("aria-current")).toBeNull();
    const names = mainNav()
      .getAllByRole("link")
      .map((item) => item.textContent);
    expect(names.indexOf(INVITATIONS.name)).toBe(names.indexOf(WORKERS.name) + 1);
  });

  it("shows it to no Worker", async () => {
    await renderNav(OrgRole.WORKER, "/workers/invitations");
    expect(mainNav().queryAllByRole("link")).toHaveLength(0);
  });

  it.each([
    ["/workers/invitations", INVITATIONS.name],
    ["/workers", WORKERS.name],
    ["/workers/wp-9/review", WORKERS.name],
  ])("on %s marks only %s as the current page", async (pathname, current) => {
    await renderNav(OrgRole.OWNER, pathname);
    expect(currentLinks()).toEqual([current]);
  });
});
