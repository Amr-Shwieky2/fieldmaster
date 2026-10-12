import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Member, MemberDevice } from "@fieldmaster/api-client";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import UsersPage from "../page";

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listMemberDevices: vi.fn(),
  changeMemberRole: vi.fn(),
  suspendMember: vi.fn(),
  reactivateMember: vi.fn(),
  archiveMember: vi.fn(),
  setMemberTimeTracking: vi.fn(),
  revokeMemberSession: vi.fn(),
  revokeMemberDeviceKey: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "OWNER" as string }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/settings/users",
  useSearchParams: () => new URLSearchParams(),
}));

// ── Test data (times are UTC; in Asia/Jerusalem, IDT = UTC+3, 06:30Z reads 09:30) ──
function member(
  fields: Pick<Member, "id" | "fullLegalName" | "phoneNumber" | "role" | "status" | "isTimeTrackable" | "lastActiveAt"> & Partial<Member>,
): Member {
  return {
    userId: `u-${fields.id}`,
    workerProfileId: fields.isTimeTrackable ? `wp-${fields.id}` : null,
    createdAt: "2026-01-10T08:30:00.000Z",
    archivedAt: null,
    isSelf: false,
    ...fields,
  };
}

/** The signed-in Owner. */
const OWNER = member({
  id: "m-owner",
  fullLegalName: "سلمى منصور",
  phoneNumber: "+972500000001",
  role: OrgRole.OWNER,
  status: AccountStatus.ACTIVE,
  isTimeTrackable: false,
  lastActiveAt: "2026-10-11T06:30:00.000Z",
  isSelf: true,
});
const MANAGER = member({
  id: "m-fm",
  fullLegalName: "يوسف الخطيب",
  phoneNumber: "+972500000011",
  role: OrgRole.FIELD_MANAGER,
  status: AccountStatus.ACTIVE,
  isTimeTrackable: false,
  lastActiveAt: "2026-10-10T15:05:00.000Z",
});
const WORKER = member({
  id: "m-w1",
  fullLegalName: "خالد ناصر",
  phoneNumber: "+972500010001",
  role: OrgRole.WORKER,
  status: AccountStatus.ACTIVE,
  isTimeTrackable: true,
  lastActiveAt: null,
});
const SUSPENDED = member({
  id: "m-w2",
  fullLegalName: "محمود جبارين",
  phoneNumber: "+972500010002",
  role: OrgRole.WORKER,
  status: AccountStatus.SUSPENDED,
  isTimeTrackable: true,
  lastActiveAt: "2026-10-01T05:00:00.000Z",
});
const ARCHIVED = member({
  id: "m-w3",
  fullLegalName: "سامي عودة",
  phoneNumber: "+972500010003",
  role: OrgRole.WORKER,
  status: AccountStatus.ARCHIVED,
  isTimeTrackable: true,
  lastActiveAt: "2026-09-01T05:00:00.000Z",
  archivedAt: "2026-09-02T07:00:00.000Z",
});
const MEMBERS = [OWNER, MANAGER, WORKER, SUSPENDED, ARCHIVED];

/** The Field Manager signed in from an iPhone (offline key active, one session still active), an Android phone and an unknown device. */
const MANAGER_DEVICES: MemberDevice[] = [
  {
    id: "dev-ios",
    clientDeviceId: "ios-1",
    platform: "IOS",
    appVersion: "1.4.0",
    osVersion: "18.0",
    lastActiveAt: "2026-10-10T15:05:00.000Z",
    key: { status: "ACTIVE", registeredAt: "2026-10-01T05:00:00.000Z", revokedAt: null },
    sessions: [
      {
        id: "sess-1",
        origin: "OTP",
        createdAt: "2026-10-01T05:00:00.000Z",
        lastUsedAt: "2026-10-10T15:05:00.000Z",
        revokedAt: null,
        revokedReason: null,
        active: true,
      },
      {
        id: "sess-2",
        origin: "DEV_LOGIN",
        createdAt: "2026-09-20T06:00:00.000Z",
        lastUsedAt: "2026-09-21T06:00:00.000Z",
        revokedAt: "2026-09-21T07:00:00.000Z",
        revokedReason: "LOGOUT",
        active: false,
      },
    ],
  },
  {
    id: "dev-android",
    clientDeviceId: "android-1",
    platform: "ANDROID",
    appVersion: null,
    osVersion: null,
    lastActiveAt: "2026-09-15T09:00:00.000Z",
    key: { status: "NONE", registeredAt: null, revokedAt: null },
    sessions: [
      {
        id: "sess-3",
        origin: "DEV_FIXED_OTP",
        createdAt: "2026-09-15T08:00:00.000Z",
        lastUsedAt: "2026-09-15T09:00:00.000Z",
        revokedAt: "2026-09-16T08:00:00.000Z",
        revokedReason: "REVOKED_BY_OWNER",
        active: false,
      },
    ],
  },
  {
    id: "dev-other",
    clientDeviceId: "kiosk-1",
    platform: "KIOSK",
    appVersion: "0.9.2",
    osVersion: null,
    lastActiveAt: "2026-08-03T10:15:00.000Z",
    key: { status: "REVOKED", registeredAt: "2026-08-01T05:00:00.000Z", revokedAt: "2026-08-04T05:00:00.000Z" },
    sessions: [
      {
        id: "sess-4",
        origin: "PASSKEY",
        createdAt: "2026-08-01T05:00:00.000Z",
        lastUsedAt: "2026-08-03T10:15:00.000Z",
        revokedAt: "2026-08-04T05:00:00.000Z",
        revokedReason: "MEMBERSHIP_SUSPENDED",
        active: false,
      },
    ],
  },
];

/** Archiving ended every session, but the offline key of the archived member's phone was never revoked. */
const ARCHIVED_DEVICES: MemberDevice[] = [
  {
    id: "dev-archived",
    clientDeviceId: "android-9",
    platform: "ANDROID",
    appVersion: "1.3.0",
    osVersion: null,
    lastActiveAt: "2026-09-01T05:00:00.000Z",
    key: { status: "ACTIVE", registeredAt: "2026-08-20T05:00:00.000Z", revokedAt: null },
    sessions: [
      {
        id: "sess-9",
        origin: "OTP",
        createdAt: "2026-08-20T05:00:00.000Z",
        lastUsedAt: "2026-09-01T05:00:00.000Z",
        revokedAt: "2026-09-02T07:00:00.000Z",
        revokedReason: "MEMBERSHIP_ARCHIVED",
        active: false,
      },
    ],
  },
];

const DEVICES: Record<string, MemberDevice[]> = { "m-fm": MANAGER_DEVICES, "m-w3": ARCHIVED_DEVICES };

const ACTION_METHODS = [
  "changeMemberRole",
  "suspendMember",
  "reactivateMember",
  "archiveMember",
  "setMemberTimeTracking",
  "revokeMemberSession",
  "revokeMemberDeviceKey",
] as const;
type ActionMethod = (typeof ACTION_METHODS)[number];

/** The reason typed for each action; the page sends it trimmed. */
const REASON = "قرار الإدارة بعد المراجعة";
const REASON_REQUIRED = "اكتب السبب قبل المتابعة.";
const SUSPEND_WARNING = "تنتهي كل جلسات هذا العضو فورًا، ولا يمكنه الدخول حتى يُعاد تفعيله.";
const ARCHIVE_WARNING = "الأرشفة نهائية: تنتهي كل جلسات هذا العضو فورًا، ولا يمكن تعديله بعدها.";
const OWNER_LIMITS_HINT = "يبقى للمؤسسة دائمًا مالك نشط واحد على الأقل، ومالكان نشطان على الأكثر.";

// ── Helpers ─────────────────────────────────────────────────────────────
function renderPage() {
  return renderWithIntl(<UsersPage />, { queryClient: true });
}

/** Matches the innermost element whose whole text (nested elements included) is exactly `text`. */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text);
}

function manageButton(name: string) {
  return screen.getByRole("button", { name: `إدارة ${name}` });
}

/** The texts of a member's table row, cell by cell. */
function rowTexts(name: string): (string | null)[] {
  const row = manageButton(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

/** Opens a member's "إدارة" panel (the element the button's aria-controls points to) and waits until its devices are loaded. */
async function openPanel(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole("button", { name: `إدارة ${name}` });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (!panel) throw new Error(`no panel for ${name}`);
  expect(within(panel).getByText("جارٍ التحميل…")).toBeTruthy();
  await waitFor(() => expect(within(panel).queryByText("جارٍ التحميل…")).toBeNull());
  return panel;
}

/** A device of an open panel, by its platform label: the smallest block holding that label and the device's session list. */
function deviceBlock(panel: HTMLElement, platform: string): HTMLElement {
  let node: HTMLElement | null = within(panel).getByText(platform);
  while (node && !node.querySelector("ul")) node = node.parentElement;
  if (!node) throw new Error(`no device ${platform}`);
  return node;
}

function sessionItem(panel: HTMLElement, text: string): HTMLElement {
  const item = within(panel).getByText(fullText(text)).closest("li");
  if (!item) throw new Error(`no session ${text}`);
  return item;
}

function reasonBox(panel: HTMLElement, label: string) {
  return within(panel).getByLabelText(label) as HTMLTextAreaElement;
}

/** The reason form around a reason box (its submit button can share its name with the button that opened it). */
function formOf(reason: HTMLElement) {
  const form = reason.closest("form");
  if (!form) throw new Error("no reason form");
  return within(form);
}

function chooseRole(panel: HTMLElement, role: OrgRole) {
  fireEvent.change(within(panel).getByRole("combobox", { name: "الدور" }), { target: { value: role } });
}

function expectNoActionCalls() {
  for (const method of ACTION_METHODS) expect(client[method]).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "OWNER";
  client.listMembers.mockResolvedValue(MEMBERS);
  client.listMemberDevices.mockImplementation(async (id: string) => DEVICES[id] ?? []);
  client.changeMemberRole.mockResolvedValue({ ...MANAGER, role: OrgRole.OWNER });
  client.suspendMember.mockResolvedValue({ ...MANAGER, status: AccountStatus.SUSPENDED });
  client.reactivateMember.mockResolvedValue({ ...SUSPENDED, status: AccountStatus.ACTIVE });
  client.archiveMember.mockResolvedValue({ ...WORKER, status: AccountStatus.ARCHIVED });
  client.setMemberTimeTracking.mockResolvedValue(MANAGER);
  client.revokeMemberSession.mockResolvedValue({ id: "sess-1", revokedAt: "2026-10-12T06:00:00.000Z" });
  client.revokeMemberDeviceKey.mockResolvedValue({ id: "key-1", revokedAt: "2026-10-12T06:00:00.000Z" });
});

describe("Users and devices page", () => {
  it("shows the loading state while the members load", () => {
    client.listMembers.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "المستخدمون والأجهزة" })).toBeTruthy();
    expect(screen.getByText("أعضاء المؤسسة وأدوارهم وأجهزتهم وجلساتهم. يحتاج كل تغيير إلى سبب ويُسجَّل في سجل التدقيق.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الإعدادات" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByText("جارٍ التحميل…").closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(client.listMembers).toHaveBeenCalledTimes(1);
    expect(client.listMemberDevices).not.toHaveBeenCalled();
  });

  it.each([OrgRole.FIELD_MANAGER, OrgRole.WORKER])("is for Owners only: a %s is sent to the dashboard and nothing is loaded", async (role) => {
    auth.role = role;
    renderPage();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.getByRole("status").textContent).toBe("جارٍ التحميل…");
    expect(screen.queryByRole("heading", { name: "المستخدمون والأجهزة" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(client.listMembers).not.toHaveBeenCalled();
    expect(client.listMemberDevices).not.toHaveBeenCalled();
  });

  it("lists every member with phone, role, status, time tracking and last activity", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: "أعضاء المؤسسة مع الدور والحالة وتسجيل الحضور وآخر نشاط" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["الاسم", "الهاتف", "الدور", "الحالة", "تسجيل الحضور", "آخر نشاط", "الإجراءات"]);

    // The Owner's own account carries the "حسابك" badge; no other row does.
    expect(rowTexts("سلمى منصور")).toEqual(["سلمى منصورحسابك", "+972500000001", "المالك", "نشط", "غير مفعّل", "11 أكتوبر 2026 في 09:30", "إدارة"]);
    expect(within(table).getAllByText("حسابك")).toHaveLength(1);
    expect(rowTexts("يوسف الخطيب")).toEqual(["يوسف الخطيب", "+972500000011", "مدير ميدان", "نشط", "غير مفعّل", "10 أكتوبر 2026 في 18:05", "إدارة"]);
    expect(rowTexts("خالد ناصر")).toEqual(["خالد ناصر", "+972500010001", "عامل", "نشط", "مفعّل", "لم يسجّل الدخول بعد", "إدارة"]);
    expect(rowTexts("محمود جبارين")).toEqual(["محمود جبارين", "+972500010002", "عامل", "موقوف", "مفعّل", "1 أكتوبر 2026 في 08:00", "إدارة"]);
    expect(rowTexts("سامي عودة")).toEqual(["سامي عودة", "+972500010003", "عامل", "مؤرشف", "مفعّل", "1 سبتمبر 2026 في 08:00", "إدارة"]);

    // Phone numbers keep their left-to-right order inside the Arabic page.
    expect(within(table).getByText("+972500000001").getAttribute("dir")).toBe("ltr");
    for (const { fullLegalName } of MEMBERS) {
      expect(manageButton(fullLegalName).getAttribute("aria-expanded")).toBe("false");
    }
    // A member's devices are loaded only when their panel is opened.
    expect(client.listMemberDevices).not.toHaveBeenCalled();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("opens a member's panel with the role, the actions their status allows, and their devices and sessions", async () => {
    renderPage();
    const panel = await openPanel("يوسف الخطيب");
    const view = within(panel);

    const role = view.getByRole("combobox", { name: "الدور" }) as HTMLSelectElement;
    expect(role.value).toBe(OrgRole.FIELD_MANAGER);
    expect(
      within(role)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["المالك", "مدير ميدان", "عامل"]);
    // The role can only be changed to another role.
    const changeRole = view.getByRole("button", { name: "تغيير الدور" }) as HTMLButtonElement;
    expect(changeRole.disabled).toBe(true);
    chooseRole(panel, OrgRole.OWNER);
    expect(changeRole.disabled).toBe(false);
    chooseRole(panel, OrgRole.FIELD_MANAGER);
    expect(changeRole.disabled).toBe(true);

    // An active member can be suspended (not reactivated); time tracking is off, so it can be turned on.
    expect(view.getByRole("button", { name: "إيقاف الحساب مؤقتًا" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "إعادة التفعيل" })).toBeNull();
    expect(view.getByRole("button", { name: "تفعيل تسجيل الحضور" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "إيقاف تسجيل الحضور" })).toBeNull();
    expect(view.getByRole("button", { name: "أرشفة" })).toBeTruthy();
    expect(view.getByText(OWNER_LIMITS_HINT)).toBeTruthy();
    expect(view.queryByText(SUSPEND_WARNING)).toBeNull();
    expect(view.queryByText(ARCHIVE_WARNING)).toBeNull();

    // Devices and sessions.
    expect(await view.findByText("آيفون")).toBeTruthy();
    expect(client.listMemberDevices).toHaveBeenCalledTimes(1);
    expect(client.listMemberDevices).toHaveBeenCalledWith("m-fm");
    expect(view.getByRole("heading", { name: "الأجهزة والجلسات" })).toBeTruthy();

    const iphone = within(deviceBlock(panel, "آيفون"));
    expect(iphone.getByText("إصدار التطبيق 1.4.0")).toBeTruthy();
    expect(iphone.getByText("مفتاح التسجيل دون اتصال مفعّل")).toBeTruthy();
    expect(iphone.getByText(fullText("آخر نشاط: 10 أكتوبر 2026 في 18:05"))).toBeTruthy();
    expect(iphone.getByRole("button", { name: "إلغاء مفتاح الجهاز" })).toBeTruthy();
    const activeSession = within(sessionItem(panel, "جلسة برمز تحقق: بدأت 1 أكتوبر 2026 في 08:00، آخر استخدام 10 أكتوبر 2026 في 18:05"));
    expect(activeSession.getByText("نشطة")).toBeTruthy();
    expect(activeSession.getByRole("button", { name: "إنهاء الجلسة" })).toBeTruthy();
    const endedSession = within(sessionItem(panel, "جلسة دخول تجريبي: بدأت 20 سبتمبر 2026 في 09:00، آخر استخدام 21 سبتمبر 2026 في 09:00"));
    expect(endedSession.getByText("منتهية")).toBeTruthy();
    expect(endedSession.queryByRole("button")).toBeNull();

    const android = within(deviceBlock(panel, "أندرويد"));
    expect(android.getByText("لا يوجد مفتاح للتسجيل دون اتصال")).toBeTruthy();
    expect(android.getByText(fullText("آخر نشاط: 15 سبتمبر 2026 في 12:00"))).toBeTruthy();
    expect(android.queryByText(/إصدار التطبيق/)).toBeNull();
    expect(android.getByText(fullText("جلسة برمز تجريبي ثابت: بدأت 15 سبتمبر 2026 في 11:00، آخر استخدام 15 سبتمبر 2026 في 12:00"))).toBeTruthy();
    expect(android.queryAllByRole("button")).toHaveLength(0);

    // An unknown platform and an unknown sign-in origin get generic labels.
    const other = within(deviceBlock(panel, "جهاز آخر"));
    expect(other.getByText("إصدار التطبيق 0.9.2")).toBeTruthy();
    expect(other.getByText("مفتاح التسجيل دون اتصال ملغى")).toBeTruthy();
    expect(other.getByText(fullText("جلسة أخرى: بدأت 1 أغسطس 2026 في 08:00، آخر استخدام 3 أغسطس 2026 في 13:15"))).toBeTruthy();
    expect(other.queryAllByRole("button")).toHaveLength(0);

    // Only the active session can be ended and only the active key revoked.
    expect(view.getAllByRole("button", { name: "إنهاء الجلسة" })).toHaveLength(1);
    expect(view.getAllByRole("button", { name: "إلغاء مفتاح الجهاز" })).toHaveLength(1);
    expect(hasArabicIndicDigits(panel.textContent)).toBe(false);

    // "إدارة" again closes the panel.
    fireEvent.click(manageButton("يوسف الخطيب"));
    expect(manageButton("يوسف الخطيب").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox", { name: "الدور" })).toBeNull();
    expectNoActionCalls();
  });

  it("offers a suspended member reactivation instead of suspension, and a time-tracked member turning it off", async () => {
    renderPage();
    const suspended = within(await openPanel("محمود جبارين"));
    expect(suspended.getByRole("button", { name: "إعادة التفعيل" })).toBeTruthy();
    expect(suspended.queryByRole("button", { name: "إيقاف الحساب مؤقتًا" })).toBeNull();
    expect(suspended.getByRole("button", { name: "إيقاف تسجيل الحضور" })).toBeTruthy();
    expect(suspended.queryByRole("button", { name: "تفعيل تسجيل الحضور" })).toBeNull();
    expect(await suspended.findByText("لم يسجّل هذا العضو الدخول من أي جهاز بعد.")).toBeTruthy();
    expect(client.listMemberDevices).toHaveBeenCalledWith("m-w2");

    // Only one panel is open at a time.
    const worker = within(await openPanel("خالد ناصر"));
    expect(manageButton("محمود جبارين").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByRole("combobox", { name: "الدور" })).toHaveLength(1);
    expect(worker.getByRole("button", { name: "إيقاف الحساب مؤقتًا" })).toBeTruthy();
    expect(worker.queryByRole("button", { name: "إعادة التفعيل" })).toBeNull();
    expectNoActionCalls();
  });

  it("shows an archived member's note and devices without any action", async () => {
    renderPage();
    const panel = await openPanel("سامي عودة");
    const view = within(panel);

    expect(view.getByText("هذا العضو مؤرشف، ولا يمكن تعديله.")).toBeTruthy();
    expect(await view.findByText("أندرويد")).toBeTruthy();
    expect(client.listMemberDevices).toHaveBeenCalledWith("m-w3");
    expect(view.getByText("مفتاح التسجيل دون اتصال مفعّل")).toBeTruthy();
    expect(view.getByText(fullText("جلسة برمز تحقق: بدأت 20 أغسطس 2026 في 08:00، آخر استخدام 1 سبتمبر 2026 في 08:00"))).toBeTruthy();
    expect(view.getByText("منتهية")).toBeTruthy();

    expect(view.queryByRole("combobox", { name: "الدور" })).toBeNull();
    expect(view.queryAllByRole("button")).toHaveLength(0);
    expect(view.queryByText(OWNER_LIMITS_HINT)).toBeNull();
    expectNoActionCalls();
  });

  // ── Every action: a written reason, the exact request, the announcement ──
  interface ActionCase {
    action: string;
    member: string;
    start: (panel: HTMLElement) => Promise<void> | void;
    label: string;
    submit: string;
    warning?: string;
    method: ActionMethod;
    args: unknown[];
    announcement: string;
  }

  const clickAction = (name: string) => (panel: HTMLElement) => {
    fireEvent.click(within(panel).getByRole("button", { name }));
  };
  const clickWhenLoaded = (name: string) => async (panel: HTMLElement) => {
    fireEvent.click(await within(panel).findByRole("button", { name }));
  };

  const ACTIONS: ActionCase[] = [
    {
      action: "changes a role",
      member: "يوسف الخطيب",
      start: (panel) => {
        chooseRole(panel, OrgRole.OWNER);
        clickAction("تغيير الدور")(panel);
      },
      label: "سبب تغيير الدور إلى «المالك»",
      submit: "تأكيد تغيير الدور",
      method: "changeMemberRole",
      args: ["m-fm", "OWNER", REASON],
      announcement: "أصبح دور يوسف الخطيب: المالك.",
    },
    {
      action: "suspends a member",
      member: "يوسف الخطيب",
      start: clickAction("إيقاف الحساب مؤقتًا"),
      label: "سبب الإيقاف المؤقت",
      submit: "تأكيد الإيقاف",
      warning: SUSPEND_WARNING,
      method: "suspendMember",
      args: ["m-fm", REASON],
      announcement: "تم إيقاف حساب يوسف الخطيب مؤقتًا، وانتهت كل جلسات الحساب.",
    },
    {
      action: "reactivates a suspended member",
      member: "محمود جبارين",
      start: clickAction("إعادة التفعيل"),
      label: "سبب إعادة التفعيل",
      submit: "تأكيد إعادة التفعيل",
      method: "reactivateMember",
      args: ["m-w2", REASON],
      announcement: "تمت إعادة تفعيل حساب محمود جبارين.",
    },
    {
      action: "archives a member",
      member: "خالد ناصر",
      start: clickAction("أرشفة"),
      label: "سبب الأرشفة",
      submit: "تأكيد الأرشفة",
      warning: ARCHIVE_WARNING,
      method: "archiveMember",
      args: ["m-w1", REASON],
      announcement: "تمت أرشفة خالد ناصر، وانتهت كل جلسات الحساب.",
    },
    {
      action: "turns time tracking on",
      member: "سلمى منصور",
      start: clickAction("تفعيل تسجيل الحضور"),
      label: "سبب تفعيل تسجيل الحضور",
      submit: "تأكيد",
      method: "setMemberTimeTracking",
      args: ["m-owner", true, REASON],
      announcement: "تم تفعيل تسجيل الحضور لـسلمى منصور.",
    },
    {
      action: "turns time tracking off",
      member: "خالد ناصر",
      start: clickAction("إيقاف تسجيل الحضور"),
      label: "سبب إيقاف تسجيل الحضور",
      submit: "تأكيد",
      method: "setMemberTimeTracking",
      args: ["m-w1", false, REASON],
      announcement: "تم إيقاف تسجيل الحضور لـخالد ناصر.",
    },
    {
      action: "ends an active session",
      member: "يوسف الخطيب",
      start: clickWhenLoaded("إنهاء الجلسة"),
      label: "سبب إنهاء الجلسة",
      submit: "إنهاء الجلسة",
      method: "revokeMemberSession",
      args: ["m-fm", "sess-1", REASON],
      announcement: "تم إنهاء جلسة يوسف الخطيب.",
    },
    {
      action: "revokes an active device key",
      member: "يوسف الخطيب",
      start: clickWhenLoaded("إلغاء مفتاح الجهاز"),
      label: "سبب إلغاء مفتاح الجهاز",
      submit: "إلغاء المفتاح",
      method: "revokeMemberDeviceKey",
      args: ["m-fm", "dev-ios", REASON],
      announcement: "تم إلغاء مفتاح جهاز يوسف الخطيب، ولن تُقبل التسجيلات دون اتصال من هذا الجهاز.",
    },
  ];

  it.each(ACTIONS)("refuses a blank reason before sending anything when it $action", async ({ member: name, start, label, submit }) => {
    renderPage();
    const panel = await openPanel(name);
    await start(panel);

    const reason = reasonBox(panel, label);
    expect(reason.value).toBe("");
    expect(formOf(reason).getByText("يُحفظ السبب في سجل التدقيق.")).toBeTruthy();
    fireEvent.click(formOf(reason).getByRole("button", { name: submit }));
    const error = formOf(reason).getByText(REASON_REQUIRED);
    expect(error.getAttribute("role")).toBe("alert");
    expect(reason.getAttribute("aria-invalid")).toBe("true");

    // Spaces only are still blank.
    fireEvent.change(reason, { target: { value: "   " } });
    expect(formOf(reason).queryByText(REASON_REQUIRED)).toBeNull();
    fireEvent.click(formOf(reason).getByRole("button", { name: submit }));
    expect(formOf(reason).getByText(REASON_REQUIRED)).toBeTruthy();
    expectNoActionCalls();

    // Cancelling closes the form without a request.
    fireEvent.click(formOf(reason).getByRole("button", { name: "إلغاء" }));
    expect(within(panel).queryByLabelText(label)).toBeNull();
    expectNoActionCalls();
  });

  it.each(ACTIONS)("$action with the written reason and announces it", async ({ member: name, start, label, submit, warning, method, args, announcement }) => {
    renderPage();
    const panel = await openPanel(name);
    expect(client.listMemberDevices).toHaveBeenCalledTimes(1);
    await start(panel);

    const reason = reasonBox(panel, label);
    for (const text of [SUSPEND_WARNING, ARCHIVE_WARNING]) {
      if (text === warning) expect(within(panel).getByText(text)).toBeTruthy();
      else expect(within(panel).queryByText(text)).toBeNull();
    }
    fireEvent.change(reason, { target: { value: `  ${REASON}  ` } });
    fireEvent.click(formOf(reason).getByRole("button", { name: submit }));

    const done = await screen.findByText(announcement);
    expect(done.closest('[role="status"]')).toBeTruthy();
    expect(client[method]).toHaveBeenCalledTimes(1);
    expect(client[method]).toHaveBeenCalledWith(...args);
    for (const other of ACTION_METHODS.filter((candidate) => candidate !== method)) expect(client[other]).not.toHaveBeenCalled();
    expect(within(panel).queryByLabelText(label)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    // The members and this member's devices are reloaded.
    await waitFor(() => expect(client.listMembers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.listMemberDevices).toHaveBeenCalledTimes(2));
    expect(client.listMemberDevices).toHaveBeenLastCalledWith(args[0]);

    // Managing another member clears the announcement.
    fireEvent.click(manageButton(name === "سلمى منصور" ? "يوسف الخطيب" : "سلمى منصور"));
    expect(screen.queryByText(announcement)).toBeNull();
  });

  it("shows that the action is being sent and locks the form meanwhile", async () => {
    let finish: (value: unknown) => void = () => {};
    client.suspendMember.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    client.listMembers.mockResolvedValueOnce(MEMBERS).mockResolvedValue([OWNER, { ...MANAGER, status: AccountStatus.SUSPENDED }, WORKER, SUSPENDED, ARCHIVED]);
    renderPage();
    const panel = await openPanel("يوسف الخطيب");

    fireEvent.click(within(panel).getByRole("button", { name: "إيقاف الحساب مؤقتًا" }));
    fireEvent.change(reasonBox(panel, "سبب الإيقاف المؤقت"), { target: { value: "ترك العمل" } });
    fireEvent.click(within(panel).getByRole("button", { name: "تأكيد الإيقاف" }));

    const pending = (await within(panel).findByRole("button", { name: "جارٍ التنفيذ…" })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect((within(panel).getByRole("button", { name: "إلغاء" }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.suspendMember).toHaveBeenCalledWith("m-fm", "ترك العمل");

    finish({ ...MANAGER, status: AccountStatus.SUSPENDED });
    expect(await screen.findByText("تم إيقاف حساب يوسف الخطيب مؤقتًا، وانتهت كل جلسات الحساب.")).toBeTruthy();
    // The reloaded row shows the new status, and the panel now offers reactivation.
    await waitFor(() => expect(rowTexts("يوسف الخطيب")[3]).toBe("موقوف"));
    expect(within(panel).getByRole("button", { name: "إعادة التفعيل" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "إيقاف الحساب مؤقتًا" })).toBeNull();
  });

  // ── API errors, in Arabic ─────────────────────────────────────────────
  it.each([
    {
      code: "MAX_OWNERS_REACHED",
      english: "This organization already has the maximum of 2 active Owners.",
      message: "تم الوصول إلى الحد الأقصى لعدد المالكين في هذه المؤسسة.",
      member: "يوسف الخطيب",
      method: "changeMemberRole" as ActionMethod,
      start: (panel: HTMLElement) => {
        chooseRole(panel, OrgRole.OWNER);
        fireEvent.click(within(panel).getByRole("button", { name: "تغيير الدور" }));
      },
      label: "سبب تغيير الدور إلى «المالك»",
      submit: "تأكيد تغيير الدور",
    },
    {
      code: "LAST_ACTIVE_OWNER",
      english: "The organization must keep at least one active Owner.",
      message: "لا يمكن تنفيذ ذلك لأنه سيترك المؤسسة دون مالك نشط.",
      member: "سلمى منصور",
      method: "suspendMember" as ActionMethod,
      start: (panel: HTMLElement) => fireEvent.click(within(panel).getByRole("button", { name: "إيقاف الحساب مؤقتًا" })),
      label: "سبب الإيقاف المؤقت",
      submit: "تأكيد الإيقاف",
    },
    {
      code: "ROLE_REQUIRES_TIME_TRACKING",
      english: "A worker always has time tracking on.",
      message: "العامل يسجّل حضوره دائمًا: فعّل تسجيل الحضور لهذا العضو أولًا، أو اختر دورًا آخر.",
      member: "خالد ناصر",
      method: "setMemberTimeTracking" as ActionMethod,
      start: (panel: HTMLElement) => fireEvent.click(within(panel).getByRole("button", { name: "إيقاف تسجيل الحضور" })),
      label: "سبب إيقاف تسجيل الحضور",
      submit: "تأكيد",
    },
  ])("shows the 409 $code in Arabic and keeps the form open", async ({ code, english, message, member: name, method, start, label, submit }) => {
    client[method].mockRejectedValue(apiError(409, code, english));
    renderPage();
    const panel = await openPanel(name);
    start(panel);

    const reason = reasonBox(panel, label);
    fireEvent.change(reason, { target: { value: "تغيير مطلوب" } });
    fireEvent.click(formOf(reason).getByRole("button", { name: submit }));

    const alert = await within(panel).findByText(message);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(english)).toBeNull();
    expect(client[method]).toHaveBeenCalledTimes(1);
    expect(reasonBox(panel, label).value).toBe("تغيير مطلوب");
    expect((formOf(reason).getByRole("button", { name: submit }) as HTMLButtonElement).disabled).toBe(false);
    // No success announcement: the page's only status region stays empty.
    expect(screen.getAllByRole("status").map((region) => region.textContent)).toEqual([""]);
    expect(client.listMembers).toHaveBeenCalledTimes(1);

    // Abandoning the form clears the error, and the next attempt starts clean.
    fireEvent.click(formOf(reason).getByRole("button", { name: "إلغاء" }));
    expect(within(panel).queryByText(message)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    start(panel);
    expect(reasonBox(panel, label).value).toBe("");
    expect(reasonBox(panel, label).getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ── Page states ───────────────────────────────────────────────────────
  it("shows the empty state when the organization has no members to list", async () => {
    client.listMembers.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("لا يوجد أعضاء.")).toBeTruthy();
    expect(screen.getByText("لا توجد سجلات لعرضها حاليًا.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    client.listMembers.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderPage();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.getByText("حدث خطأ ما")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(manageButton("يوسف الخطيب")).toBeTruthy();
    expect(client.listMembers).toHaveBeenCalledTimes(2);
  });
});
