import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import type { OrganizationSettingsView } from "@fieldmaster/api-client";
import { Permission, SystemRoleKey } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { authWithAccess, builtInAccess, myAccess } from "@/test/access-fixtures";
import SettingsPage from "../page";

// Flexible organization model on the settings page: the links to users, roles and work rules follow the
// member's permissions, and the read-only rules in force today link to the work rules page.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));
const client = vi.hoisted(() => ({ getOrganizationSettings: vi.fn() }));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

const SETTINGS: OrganizationSettingsView = {
  canEdit: true,
  workday: {
    defaultGraceMinutes: 10,
    defaultGeofenceRadiusMeters: 100,
    defaultMinGpsAccuracyMeters: 50,
    deviceTimeDeviationSeconds: 120,
    temporaryPointRadiusMeters: 100,
    temporaryPointMinAccuracyMeters: 75,
    autoDeductUnpaidBreaks: false,
    timezone: "Asia/Jerusalem",
  },
  onboarding: { invitationTtlHours: 72 },
  notifications: [{ type: "WORKER_CLOCKED_IN", fieldManagerAudience: "SHIFT_MANAGER", owners: true, fieldManagers: true, defaults: { owners: true, fieldManagers: true } }],
  testMode: { appEnv: "development", devLoginEnabled: false },
  fixedRules: { standardDayMinutes: 540, freeForgottenStampsPerMonth: 2, emergencyRetroactiveMinutes: 60, emergencyReturnBufferMinutes: 15, forgottenStampPenaltyAgorot: 1000 },
  updatedAt: "2026-10-12T07:00:00.000Z",
};

async function renderSettings(settings: OrganizationSettingsView) {
  client.getOrganizationSettings.mockResolvedValue(settings);
  renderWithIntl(<SettingsPage />, { queryClient: true });
  await screen.findByRole("heading", { level: 2, name: "يوم العمل" });
}

function headerLinks(): [string | null, string | null][] {
  const header = screen.getByRole("heading", { level: 1, name: "الإعدادات" }).parentElement?.parentElement as HTMLElement;
  return within(header)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

function rulesSection(): HTMLElement {
  return screen.getByRole("heading", { level: 2, name: "قواعد ثابتة" }).parentElement?.parentElement as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings page: links by permission", () => {
  it("gives an Owner the users, roles and work rules pages, and the rules' edit link", async () => {
    auth.value = authWithAccess(builtInAccess(SystemRoleKey.OWNER), client);
    await renderSettings(SETTINGS);

    expect(headerLinks()).toEqual([
      ["المستخدمون والأجهزة", "/settings/users"],
      ["الأدوار والصلاحيات", "/settings/roles"],
      ["قواعد العمل", "/settings/work-rules"],
    ]);
    const link = within(rulesSection()).getByRole("link", { name: "تعديل في صفحة قواعد العمل" });
    expect(link.getAttribute("href")).toBe("/settings/work-rules");
    // The link is not one of the rules.
    expect(within(rulesSection()).getAllByRole("listitem")).toHaveLength(4);
  });

  it("gives a Field Manager only the work rules page, to read", async () => {
    auth.value = authWithAccess(builtInAccess(SystemRoleKey.FIELD_MANAGER), client);
    await renderSettings({ ...SETTINGS, canEdit: false });

    expect(headerLinks()).toEqual([["قواعد العمل", "/settings/work-rules"]]);
    expect(within(rulesSection()).getByRole("link", { name: "عرض السجل في صفحة قواعد العمل" }).getAttribute("href")).toBe("/settings/work-rules");
    expect(within(rulesSection()).queryByRole("link", { name: "تعديل في صفحة قواعد العمل" })).toBeNull();
  });

  it("gives a custom role that manages users (but not roles) the users page only", async () => {
    auth.value = authWithAccess(myAccess({ roleName: "مسؤول الحسابات", permissions: [Permission.VIEW_ORG_SETTINGS, Permission.MANAGE_ORG_USERS] }), client);
    await renderSettings({ ...SETTINGS, canEdit: false });

    expect(headerLinks()).toEqual([
      ["المستخدمون والأجهزة", "/settings/users"],
      ["قواعد العمل", "/settings/work-rules"],
    ]);
  });

  it("says the Field Managers' notifications also reach the custom roles that hold the permission", async () => {
    auth.value = authWithAccess(builtInAccess(SystemRoleKey.OWNER), client);
    await renderSettings(SETTINGS);

    expect(
      screen.getByText("ما يُرسل إلى مديري الميدان يصل أيضًا إلى أعضاء الأدوار المخصّصة الذين يملكون الصلاحية التي يحتاجها الإشعار."),
    ).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "إرسال «بدأ عامل الدوام» إلى مديري الميدان" })).toBeTruthy();
  });
});
