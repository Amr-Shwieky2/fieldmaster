import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { Nav } from "../nav";

// Step 6: the live operations page, the settings page and (Owners only) the users and devices page each have a nav entry.
const state = vi.hoisted(() => ({
  role: "OWNER" as string,
  pathname: "/dashboard",
  client: { listDevLoginUsers: vi.fn() },
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { role: state.role }, client: state.client }) }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

const OPERATIONS = { name: "العمليات المباشرة", href: "/operations" };
const SETTINGS = { name: "الإعدادات", href: "/settings" };
const USERS = { name: "المستخدمون والأجهزة", href: "/settings/users" };

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

/** The names of the links marked as the current page. */
function currentLinks(): (string | null)[] {
  return mainNav()
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

function expectEntry({ name, href }: { name: string; href: string }) {
  const link = mainNav().getByRole("link", { name });
  expect(link.getAttribute("href")).toBe(href);
  expect(link.getAttribute("aria-current")).toBeNull();
}

beforeEach(() => {
  state.client.listDevLoginUsers.mockReset();
  state.client.listDevLoginUsers.mockResolvedValue(null);
});

describe("Nav: Step 6 entries", () => {
  it("shows an Owner the live operations, the settings and the users and devices entries", async () => {
    await renderNav(OrgRole.OWNER);
    expectEntry(OPERATIONS);
    expectEntry(SETTINGS);
    expectEntry(USERS);
    expect(currentLinks()).toEqual(["لوحة التحكم"]);
  });

  it("shows a Field Manager the live operations and the settings, but not the users and devices page", async () => {
    await renderNav(OrgRole.FIELD_MANAGER);
    expectEntry(OPERATIONS);
    expectEntry(SETTINGS);
    expect(mainNav().queryByRole("link", { name: USERS.name })).toBeNull();
    expect(mainNav().queryByText(USERS.name)).toBeNull();
    expect(mainNav().queryAllByRole("link", { name: SETTINGS.name })).toHaveLength(1);
    expect(currentLinks()).toEqual(["لوحة التحكم"]);
  });

  it("shows none of them to a Worker", async () => {
    await renderNav(OrgRole.WORKER, "/settings");
    for (const { name } of [OPERATIONS, SETTINGS, USERS]) {
      expect(mainNav().queryByRole("link", { name })).toBeNull();
    }
    expect(mainNav().queryAllByRole("link")).toHaveLength(0);
  });

  it("marks only the users and devices entry as current on its page, not the settings entry above it", async () => {
    await renderNav(OrgRole.OWNER, "/settings/users");
    expect(mainNav().getByRole("link", { name: USERS.name }).getAttribute("aria-current")).toBe("page");
    expect(mainNav().getByRole("link", { name: SETTINGS.name }).getAttribute("aria-current")).toBeNull();
    expect(currentLinks()).toEqual([USERS.name]);
  });

  it.each([
    [OrgRole.OWNER, "/settings", SETTINGS.name],
    [OrgRole.FIELD_MANAGER, "/settings", SETTINGS.name],
    [OrgRole.OWNER, "/operations", OPERATIONS.name],
    [OrgRole.FIELD_MANAGER, "/operations", OPERATIONS.name],
  ])("for a %s on %s marks only %s as the current page", async (role, pathname, current) => {
    await renderNav(role, pathname);
    expect(mainNav().getByRole("link", { name: current }).getAttribute("aria-current")).toBe("page");
    expect(currentLinks()).toEqual([current]);
  });
});
