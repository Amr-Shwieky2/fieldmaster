import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { Nav } from "../nav";

// Step 5: the attendance list, the forgotten-stamp report and the emergency call-outs each have a nav entry.
const state = vi.hoisted(() => ({
  role: "OWNER" as string,
  pathname: "/dashboard",
  client: { listDevLoginUsers: vi.fn() },
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { role: state.role }, client: state.client }) }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

const ATTENDANCE = { name: "الحضور", href: "/attendance" };
const FORGOTTEN_STAMPS = { name: "نسيان التسجيل", href: "/attendance/forgotten-stamps" };
const EMERGENCIES = { name: "استدعاءات الطوارئ", href: "/emergencies" };
const STEP_5_ENTRIES = [ATTENDANCE, FORGOTTEN_STAMPS, EMERGENCIES];

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

beforeEach(() => {
  state.client.listDevLoginUsers.mockReset();
  state.client.listDevLoginUsers.mockResolvedValue(null);
});

describe("Nav: attendance entries", () => {
  it.each([OrgRole.OWNER, OrgRole.FIELD_MANAGER])("shows the attendance, forgotten-stamp and emergency entries to a %s", async (role) => {
    await renderNav(role);
    for (const { name, href } of STEP_5_ENTRIES) {
      const link = mainNav().getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("aria-current")).toBeNull();
    }
    expect(currentLinks()).toEqual(["لوحة التحكم"]);
  });

  it("shows none of them to a Worker", async () => {
    await renderNav(OrgRole.WORKER, "/attendance");
    for (const { name } of STEP_5_ENTRIES) {
      expect(mainNav().queryByRole("link", { name })).toBeNull();
    }
    expect(mainNav().queryAllByRole("link")).toHaveLength(0);
  });

  it("marks only the forgotten-stamp report as current on its page, not the attendance list above it", async () => {
    await renderNav(OrgRole.FIELD_MANAGER, "/attendance/forgotten-stamps");
    expect(mainNav().getByRole("link", { name: FORGOTTEN_STAMPS.name }).getAttribute("aria-current")).toBe("page");
    expect(mainNav().getByRole("link", { name: ATTENDANCE.name }).getAttribute("aria-current")).toBeNull();
    expect(currentLinks()).toEqual([FORGOTTEN_STAMPS.name]);
  });

  it.each([
    ["/attendance", ATTENDANCE.name],
    ["/attendance/te-1", ATTENDANCE.name],
    ["/emergencies", EMERGENCIES.name],
    ["/emergencies/co-1", EMERGENCIES.name],
  ])("on %s marks only %s as the current page", async (pathname, current) => {
    await renderNav(OrgRole.OWNER, pathname);
    expect(mainNav().getByRole("link", { name: current }).getAttribute("aria-current")).toBe("page");
    expect(currentLinks()).toEqual([current]);
  });
});
