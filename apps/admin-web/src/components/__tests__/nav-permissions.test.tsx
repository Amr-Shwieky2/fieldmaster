import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { SystemRoleKey } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { ACCOUNTANT, COORDINATOR, RESTRICTED_OWNER, authWithAccess, builtInAccess } from "@/test/access-fixtures";
import { Nav } from "../nav";
import { AppHeader } from "../app-header";

// Flexible organization model: the menu follows the member's permissions (GET /auth/me), never the role's name.
const state = vi.hoisted(() => ({
  auth: null as unknown,
  client: { listDevLoginUsers: vi.fn() },
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const ALL_ENTRIES = [
  "لوحة التحكم",
  "العمليات المباشرة",
  "العمال",
  "دعوات العمال",
  "المواقع والمشاريع",
  "الجدولة",
  "المناوبات والطوارئ",
  "الحضور",
  "نسيان التسجيل",
  "استدعاءات الطوارئ",
  "الرواتب",
  "التقارير",
  "الإشعارات",
  "سجل التدقيق",
  "الإعدادات",
  "المستخدمون والأجهزة",
  "الأدوار والصلاحيات",
];

async function renderNav(access: Parameters<typeof authWithAccess>[0]) {
  state.auth = authWithAccess(access, state.client);
  const view = renderWithIntl(<Nav />, { queryClient: true });
  // Dev login off: the API answers 404, which the client maps to null.
  await waitFor(() => expect(state.client.listDevLoginUsers).toHaveBeenCalled());
  return view;
}

function entries(): (string | null)[] {
  return within(screen.getByRole("navigation", { name: "القائمة الرئيسية" }))
    .queryAllByRole("link")
    .map((link) => link.textContent);
}

beforeEach(() => {
  state.client.listDevLoginUsers.mockReset();
  state.client.listDevLoginUsers.mockResolvedValue(null);
});

describe("Nav: entries by permission", () => {
  it("shows an Owner every entry, the roles page included, under the role's Arabic name", async () => {
    await renderNav(builtInAccess(SystemRoleKey.OWNER));
    expect(entries()).toEqual(ALL_ENTRIES);
    expect(screen.getByRole("link", { name: "الأدوار والصلاحيات" }).getAttribute("href")).toBe("/settings/roles");
    expect(screen.getByText("المالك")).toBeTruthy();
  });

  it("shows a Field Manager no payroll, audit log, users or roles", async () => {
    await renderNav(builtInAccess(SystemRoleKey.FIELD_MANAGER));
    expect(entries()).toEqual(ALL_ENTRIES.filter((name) => !["الرواتب", "سجل التدقيق", "المستخدمون والأجهزة", "الأدوار والصلاحيات"].includes(name)));
    expect(screen.getByText("مدير ميدان")).toBeTruthy();
  });

  it("shows a custom role without money only what its permissions open, under the role's own name", async () => {
    await renderNav(COORDINATOR);
    expect(entries()).toEqual(["لوحة التحكم", "العمليات المباشرة", "الجدولة", "الحضور", "نسيان التسجيل", "استدعاءات الطوارئ", "التقارير", "الإشعارات", "الإعدادات"]);
    expect(screen.queryByText("الرواتب")).toBeNull();
    expect(screen.getByText("منسق الحضور")).toBeTruthy();
  });

  it("shows a custom role with money the payroll, whatever the role is called", async () => {
    await renderNav(ACCOUNTANT);
    expect(entries()).toEqual(["لوحة التحكم", "الحضور", "نسيان التسجيل", "استدعاءات الطوارئ", "الرواتب", "التقارير", "الإشعارات"]);
    expect(screen.getByText("محاسب")).toBeTruthy();
  });

  it("shows a member restricted to some projects no organization-wide entry, even with the Owner's role", async () => {
    await renderNav(RESTRICTED_OWNER);
    expect(entries()).toEqual(
      ALL_ENTRIES.filter((name) => !["دعوات العمال", "المناوبات والطوارئ", "الرواتب", "سجل التدقيق", "المستخدمون والأجهزة", "الأدوار والصلاحيات"].includes(name)),
    );
  });

  it("shows a built-in Worker nothing", async () => {
    await renderNav(builtInAccess(SystemRoleKey.WORKER));
    expect(entries()).toEqual([]);
  });
});

describe("AppHeader: who is signed in", () => {
  function renderHeader(access: Parameters<typeof authWithAccess>[0]) {
    state.auth = authWithAccess(access, state.client);
    return renderWithIntl(<AppHeader />, { queryClient: true });
  }

  it("names a custom role by its own name, a built-in one by its Arabic label", () => {
    renderHeader(ACCOUNTANT);
    expect(screen.getByText("تم تسجيل الدخول بصفة محاسب")).toBeTruthy();
    expect(screen.queryByText("عرض مقيَّد بمشاريعك")).toBeNull();
  });

  it("tells a member restricted to some projects that their view is limited", () => {
    renderHeader(RESTRICTED_OWNER);
    expect(screen.getByText("تم تسجيل الدخول بصفة المالك")).toBeTruthy();
    const badge = screen.getByText("عرض مقيَّد بمشاريعك");
    expect(badge.getAttribute("title")).toBe("ترى ما يخص المشاريع والمواقع المحددة لك فقط، ولا تظهر لك صفحات المؤسسة كلها.");
  });
});
