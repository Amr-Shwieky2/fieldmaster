import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Member, MemberAccess, OwnerLimit, Project, Role, Site } from "@fieldmaster/api-client";
import { ALL_PERMISSIONS, AccountStatus, OrgRole, Permission, SYSTEM_ROLE_PERMISSIONS, SystemRoleKey } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { authWithAccess, builtInAccess } from "@/test/access-fixtures";
import UsersPage from "../page";

// Flexible organization model on the users page: role names (custom roles too), changing to any role,
// the project scope of a member, and the limit of active Owners. (The Step 6 behaviour is in users-page.test.tsx.)

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listMemberDevices: vi.fn(),
  listMemberAccess: vi.fn(),
  listRoles: vi.fn(),
  listProjects: vi.fn(),
  listSites: vi.fn(),
  getOwnerLimit: vi.fn(),
  updateOwnerLimit: vi.fn(),
  changeMemberRole: vi.fn(),
  setMemberScope: vi.fn(),
}));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/settings/users",
  useSearchParams: () => new URLSearchParams(),
}));

// ── Test data ───────────────────────────────────────────────────────────
function member(fields: Pick<Member, "id" | "fullLegalName" | "role"> & Partial<Member>): Member {
  return {
    userId: `u-${fields.id}`,
    phoneNumber: "+972500000001",
    status: AccountStatus.ACTIVE,
    isTimeTrackable: false,
    workerProfileId: null,
    lastActiveAt: null,
    createdAt: "2026-01-10T08:30:00.000Z",
    archivedAt: null,
    isSelf: false,
    ...fields,
  };
}

const OWNER = member({ id: "m-owner", fullLegalName: "سلمى منصور", role: OrgRole.OWNER, isSelf: true });
const MANAGER = member({ id: "m-fm", fullLegalName: "يوسف الخطيب", role: OrgRole.FIELD_MANAGER });
const ACCOUNTANT = member({ id: "m-acc", fullLegalName: "ليلى خوري", role: OrgRole.CUSTOM });
const WORKER = member({ id: "m-w1", fullLegalName: "خالد ناصر", role: OrgRole.WORKER, isTimeTrackable: true, workerProfileId: "wp-1" });
const MEMBERS = [OWNER, MANAGER, ACCOUNTANT, WORKER];

function access(membershipId: string, roleId: string, roleName: string, scope: Partial<MemberAccess> = {}): MemberAccess {
  return { membershipId, roleId, roleName, restrictedToScope: false, projectIds: [], siteIds: [], ...scope };
}
const ACCESS: MemberAccess[] = [
  access("m-owner", "r-owner", "المالك"),
  // Restricted to a whole project and one site of another.
  access("m-fm", "r-fm", "مدير ميدان", { restrictedToScope: true, projectIds: ["pr-1"], siteIds: ["si-3"] }),
  access("m-acc", "r-acc", "محاسب"),
  access("m-w1", "r-worker", "عامل"),
];

function role(fields: Pick<Role, "id" | "name" | "permissions"> & Partial<Role>): Role {
  return {
    description: null,
    isSystem: false,
    systemKey: null,
    memberCount: 1,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    archivedAt: null,
    ...fields,
  };
}
const ROLES: Role[] = [
  role({ id: "r-owner", name: "المالك", isSystem: true, systemKey: SystemRoleKey.OWNER, permissions: [...ALL_PERMISSIONS] }),
  role({ id: "r-fm", name: "مدير ميدان", isSystem: true, systemKey: SystemRoleKey.FIELD_MANAGER, permissions: [...SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER] }),
  role({ id: "r-worker", name: "عامل", isSystem: true, systemKey: SystemRoleKey.WORKER, permissions: [...SYSTEM_ROLE_PERMISSIONS.WORKER] }),
  role({ id: "r-acc", name: "محاسب", permissions: [Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL] }),
  // Archived: never offered.
  role({ id: "r-old", name: "دور قديم", permissions: [Permission.VIEW_ATTENDANCE], memberCount: 0, archivedAt: "2026-10-05T08:00:00.000Z" }),
];

const PROJECTS: Project[] = [
  { id: "pr-1", name: "برج الميناء", client: null, projectCode: "PRJ-1", status: "ACTIVE" },
  { id: "pr-2", name: "مجمع الكرمل", client: null, projectCode: "PRJ-2", status: "ACTIVE" },
];
function site(id: string, projectId: string, name: string): Site {
  return { id, projectId, name, latitude: 32.8, longitude: 35, defaultGeofenceRadiusMeters: 100 };
}
const SITES: Site[] = [site("si-1", "pr-1", "الرصيف الشمالي"), site("si-2", "pr-1", "البوابة الشرقية"), site("si-3", "pr-2", "المبنى أ")];

const LIMIT: OwnerLimit = { maxOwners: 2, activeOwners: 1, canEdit: true };
const REASON = "قرار الإدارة بعد المراجعة";

// ── Helpers ─────────────────────────────────────────────────────────────
function renderPage() {
  return renderWithIntl(<UsersPage />, { queryClient: true });
}

function manageButton(name: string) {
  return screen.getByRole("button", { name: `إدارة ${name}` });
}

function rowTexts(name: string): (string | null)[] {
  const row = manageButton(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

async function openPanel(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole("button", { name: `إدارة ${name}` });
  fireEvent.click(button);
  const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (!panel) throw new Error(`no panel for ${name}`);
  await waitFor(() => expect(within(panel).queryByText("جارٍ التحميل…")).toBeNull());
  return panel;
}

function reasonForm(panel: HTMLElement, label: string) {
  const reason = within(panel).getByLabelText(label) as HTMLTextAreaElement;
  const form = reason.closest("form");
  if (!form) throw new Error("no reason form");
  return { reason, form: within(form) };
}

function ownerLimitCard(): HTMLElement {
  const element = screen.getByRole("heading", { level: 2, name: "الحد الأقصى للمالكين" }).closest(".rounded-lg");
  if (!element) throw new Error("no owner limit card");
  return element as HTMLElement;
}

function definition(container: HTMLElement, term: string): string | null | undefined {
  return within(container).getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.value = authWithAccess(builtInAccess(SystemRoleKey.OWNER), client);
  client.listMembers.mockResolvedValue(MEMBERS);
  client.listMemberDevices.mockResolvedValue([]);
  client.listMemberAccess.mockResolvedValue(ACCESS);
  client.listRoles.mockResolvedValue(ROLES);
  client.listProjects.mockResolvedValue(PROJECTS);
  client.listSites.mockResolvedValue(SITES);
  client.getOwnerLimit.mockResolvedValue(LIMIT);
  client.updateOwnerLimit.mockImplementation(async (maxOwners: number | null) => ({ ...LIMIT, maxOwners }));
  client.changeMemberRole.mockResolvedValue(WORKER);
  client.setMemberScope.mockResolvedValue(MANAGER);
});

describe("Users page: roles by name", () => {
  it("shows each member's role by name (a custom role by its own) and marks a member restricted to some projects", async () => {
    renderPage();

    await screen.findByRole("table");
    await waitFor(() => expect(rowTexts("ليلى خوري")[2]).toBe("محاسب"));
    expect(rowTexts("سلمى منصور")[2]).toBe("المالك");
    expect(rowTexts("يوسف الخطيب")[2]).toBe("مدير ميدانمقيَّد بمشاريع");
    expect(rowTexts("خالد ناصر")[2]).toBe("عامل");
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("offers every role that is not archived, and sends a custom role as its id", async () => {
    renderPage();
    const panel = await openPanel("خالد ناصر");
    const select = within(panel).getByRole("combobox", { name: "الدور" }) as HTMLSelectElement;
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["المالك", "مدير ميدان", "عامل", "محاسب"]),
    );
    expect(select.value).toBe(OrgRole.WORKER);

    fireEvent.change(select, { target: { value: "role:r-acc" } });
    fireEvent.click(within(panel).getByRole("button", { name: "تغيير الدور" }));
    const { reason, form } = reasonForm(panel, "سبب تغيير الدور إلى «محاسب»");
    fireEvent.change(reason, { target: { value: REASON } });
    fireEvent.click(form.getByRole("button", { name: "تأكيد تغيير الدور" }));

    expect(await screen.findByText("أصبح دور خالد ناصر: محاسب.")).toBeTruthy();
    expect(client.changeMemberRole).toHaveBeenCalledWith("m-w1", { roleId: "r-acc" }, REASON);
    // The members, their roles and scopes, and the roles' member counts are read again.
    await waitFor(() => expect(client.listMemberAccess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.listRoles).toHaveBeenCalledTimes(2));
  });

  it("shows a custom role's member their own role, and sends a built-in role by its kind", async () => {
    renderPage();
    const panel = await openPanel("ليلى خوري");
    const select = within(panel).getByRole("combobox", { name: "الدور" }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("role:r-acc"));
    expect((within(panel).getByRole("button", { name: "تغيير الدور" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(select, { target: { value: OrgRole.FIELD_MANAGER } });
    fireEvent.click(within(panel).getByRole("button", { name: "تغيير الدور" }));
    const { reason, form } = reasonForm(panel, "سبب تغيير الدور إلى «مدير ميدان»");
    fireEvent.change(reason, { target: { value: REASON } });
    fireEvent.click(form.getByRole("button", { name: "تأكيد تغيير الدور" }));

    expect(await screen.findByText("أصبح دور ليلى خوري: مدير ميدان.")).toBeTruthy();
    expect(client.changeMemberRole).toHaveBeenCalledWith("m-acc", OrgRole.FIELD_MANAGER, REASON);
  });
});

describe("Users page: project scope", () => {
  it("states a restricted member's projects and sites, and changes them with a reason", async () => {
    renderPage();
    const panel = await openPanel("يوسف الخطيب");

    expect(await within(panel).findByText("مقيَّد بـ: برج الميناء، المبنى أ (مجمع الكرمل)")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "تغيير النطاق" }));
    const editor = within(within(panel).getByRole("form", { name: "نطاق مشاريع العضو" }));
    expect((editor.getByRole("radio", { name: "مشاريع ومواقع محددة" }) as HTMLInputElement).checked).toBe(true);
    // A chosen project covers all its sites.
    const tower = editor.getByRole("checkbox", { name: "برج الميناء" }) as HTMLInputElement;
    expect(tower.checked).toBe(true);
    const north = editor.getByRole("checkbox", { name: "الرصيف الشمالي" }) as HTMLInputElement;
    expect(north.checked).toBe(true);
    expect(north.disabled).toBe(true);
    expect((editor.getByRole("checkbox", { name: "المبنى أ" }) as HTMLInputElement).checked).toBe(true);
    expect(editor.getByText(/لا يملك صلاحيات المؤسسة كلها/)).toBeTruthy();
    // Unchanged: nothing to save yet.
    expect((editor.getByRole("button", { name: "حفظ النطاق" }) as HTMLButtonElement).disabled).toBe(true);

    // Only one site of the tower now.
    fireEvent.click(tower);
    expect(north.checked).toBe(false);
    expect(north.disabled).toBe(false);
    fireEvent.click(editor.getByRole("checkbox", { name: "البوابة الشرقية" }));
    fireEvent.click(editor.getByRole("button", { name: "حفظ النطاق" }));

    expect(within(panel).getByText("ما دام العضو مقيَّدًا بمشاريع فلا يملك صلاحيات المؤسسة كلها (الرواتب، سجل التدقيق، المستخدمون، الأدوار، الإعدادات…) أيًّا كان دوره.")).toBeTruthy();
    const { reason, form } = reasonForm(panel, "سبب تغيير نطاق المشاريع");
    fireEvent.change(reason, { target: { value: REASON } });
    fireEvent.click(form.getByRole("button", { name: "تأكيد تغيير النطاق" }));

    expect(await screen.findByText("أصبح يوسف الخطيب مقيَّدًا بالمشاريع والمواقع المحددة.")).toBeTruthy();
    expect(client.setMemberScope).toHaveBeenCalledWith("m-fm", { restricted: true, projectIds: [], siteIds: ["si-3", "si-2"], reason: REASON });
    await waitFor(() => expect(client.listMemberAccess).toHaveBeenCalledTimes(2));
  });

  it("gives a restricted member every project again", async () => {
    renderPage();
    const panel = await openPanel("يوسف الخطيب");
    await within(panel).findByText("مقيَّد بـ: برج الميناء، المبنى أ (مجمع الكرمل)");
    fireEvent.click(within(panel).getByRole("button", { name: "تغيير النطاق" }));
    const editor = within(within(panel).getByRole("form", { name: "نطاق مشاريع العضو" }));
    fireEvent.click(editor.getByRole("radio", { name: "كل المشاريع" }));
    expect(editor.queryByRole("checkbox", { name: "برج الميناء" })).toBeNull();
    fireEvent.click(editor.getByRole("button", { name: "حفظ النطاق" }));

    const { reason, form } = reasonForm(panel, "سبب تغيير نطاق المشاريع");
    fireEvent.change(reason, { target: { value: REASON } });
    fireEvent.click(form.getByRole("button", { name: "تأكيد تغيير النطاق" }));

    expect(await screen.findByText("أصبح يوسف الخطيب يرى كل المشاريع.")).toBeTruthy();
    expect(client.setMemberScope).toHaveBeenCalledWith("m-fm", { restricted: false, projectIds: [], siteIds: [], reason: REASON });
  });

  it("refuses restricting a member to nothing", async () => {
    renderPage();
    const panel = await openPanel("خالد ناصر");
    expect(within(panel).getByText("كل المشاريع")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "تغيير النطاق" }));
    const editor = within(within(panel).getByRole("form", { name: "نطاق مشاريع العضو" }));
    fireEvent.click(editor.getByRole("radio", { name: "مشاريع ومواقع محددة" }));
    expect(await editor.findByRole("checkbox", { name: "مجمع الكرمل" })).toBeTruthy();
    fireEvent.click(editor.getByRole("button", { name: "حفظ النطاق" }));

    expect(editor.getByRole("alert").textContent).toBe("اختر مشروعًا أو موقعًا واحدًا على الأقل.");
    expect(within(panel).queryByLabelText("سبب تغيير نطاق المشاريع")).toBeNull();
    expect(client.setMemberScope).not.toHaveBeenCalled();
  });
});

describe("Users page: the limit of active Owners", () => {
  it("states the limit and the active Owners, and the members' panel says it", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 2, name: "الحد الأقصى للمالكين" });
    const card = ownerLimitCard();
    expect(definition(card, "الحد الحالي")).toBe("2");
    expect(definition(card, "المالكون النشطون الآن")).toBe("1");
    expect(within(card).getByText("اتركه فارغًا لإلغاء الحد. لا يقل عن عدد المالكين النشطين الآن (1).")).toBeTruthy();

    const panel = await openPanel("يوسف الخطيب");
    expect(within(panel).getByText("يبقى للمؤسسة دائمًا مالك نشط واحد على الأقل، ومالكان نشطان على الأكثر.")).toBeTruthy();
  });

  it("changes the limit with a reason, and removes it when left empty", async () => {
    client.getOwnerLimit.mockResolvedValueOnce(LIMIT).mockResolvedValue({ ...LIMIT, maxOwners: 3 });
    renderPage();
    await screen.findByRole("heading", { level: 2, name: "الحد الأقصى للمالكين" });
    let card = within(ownerLimitCard());
    const input = card.getByLabelText("الحد الأقصى للمالكين النشطين") as HTMLInputElement;
    expect(input.value).toBe("2");

    // A reason is required.
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(card.getByRole("button", { name: "حفظ الحد" }));
    expect(card.getByRole("alert").textContent).toBe("اكتب السبب قبل المتابعة.");
    expect(client.updateOwnerLimit).not.toHaveBeenCalled();

    fireEvent.change(card.getByLabelText("سبب التغيير"), { target: { value: REASON } });
    fireEvent.click(card.getByRole("button", { name: "حفظ الحد" }));
    expect(await screen.findByText("أصبح الحد الأقصى للمالكين النشطين: 3.")).toBeTruthy();
    expect(client.updateOwnerLimit).toHaveBeenCalledWith(3, REASON);
    const panel = await openPanel("يوسف الخطيب");
    expect(within(panel).getByText("يبقى للمؤسسة دائمًا مالك نشط واحد على الأقل، و3 مالكين نشطين على الأكثر.")).toBeTruthy();

    // Empty: no limit.
    card = within(ownerLimitCard());
    fireEvent.change(card.getByLabelText("الحد الأقصى للمالكين النشطين"), { target: { value: "" } });
    fireEvent.change(card.getByLabelText("سبب التغيير"), { target: { value: REASON } });
    fireEvent.click(card.getByRole("button", { name: "حفظ الحد" }));
    expect(await screen.findByText("أُلغي الحد الأقصى لعدد المالكين.")).toBeTruthy();
    expect(client.updateOwnerLimit).toHaveBeenLastCalledWith(null, REASON);
    expect(definition(ownerLimitCard(), "الحد الحالي")).toBe("بلا حد");
    expect(within(panel).getByText("يبقى للمؤسسة دائمًا مالك نشط واحد على الأقل، ولا حد أقصى لعدد المالكين.")).toBeTruthy();
  });

  it("refuses a limit below the active Owners before sending, and shows the API's refusal in Arabic", async () => {
    client.getOwnerLimit.mockResolvedValue({ maxOwners: 3, activeOwners: 2, canEdit: true });
    client.updateOwnerLimit.mockRejectedValue(apiError(409, "OWNER_LIMIT_BELOW_CURRENT", "Below the active Owners."));
    renderPage();
    await screen.findByRole("heading", { level: 2, name: "الحد الأقصى للمالكين" });
    const card = within(ownerLimitCard());
    const input = card.getByLabelText("الحد الأقصى للمالكين النشطين");
    fireEvent.change(card.getByLabelText("سبب التغيير"), { target: { value: REASON } });

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(card.getByRole("button", { name: "حفظ الحد" }));
    expect(card.getByRole("alert").textContent).toBe("أدخل عددًا صحيحًا من 2 إلى 100، أو اتركه فارغًا.");
    fireEvent.change(input, { target: { value: "1" } });
    expect(card.getByRole("alert").textContent).toBe("لا يمكن أن يكون الحد أقل من عدد المالكين النشطين الآن (2).");
    expect(client.updateOwnerLimit).not.toHaveBeenCalled();

    // The API refuses too (the number of Owners changed meanwhile).
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(card.getByRole("button", { name: "حفظ الحد" }));
    expect((await card.findByRole("alert")).textContent).toBe("لا يمكن أن يكون الحد أقل من عدد المالكين الفعّالين حاليًا.");
    expect(screen.queryByText("Below the active Owners.")).toBeNull();
  });

  it("is read-only for a member who may not change the settings", async () => {
    client.getOwnerLimit.mockResolvedValue({ maxOwners: null, activeOwners: 1, canEdit: false });
    renderPage();
    await screen.findByRole("heading", { level: 2, name: "الحد الأقصى للمالكين" });
    const card = within(ownerLimitCard());
    expect(definition(ownerLimitCard(), "الحد الحالي")).toBe("بلا حد");
    expect(card.getByText("للاطلاع فقط: يغيّره من يملك صلاحية تعديل إعدادات المؤسسة.")).toBeTruthy();
    expect(card.queryByRole("spinbutton")).toBeNull();
    expect(card.queryByRole("button")).toBeNull();
  });
});
