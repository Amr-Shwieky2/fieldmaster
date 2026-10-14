import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Role, RoleDetail } from "@fieldmaster/api-client";
import { ALL_PERMISSIONS, Permission, SYSTEM_ROLE_PERMISSIONS, SystemRoleKey } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { authWithAccess, builtInAccess } from "@/test/access-fixtures";
import RolesPage from "../page";

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listRoles: vi.fn(),
  getRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  archiveRole: vi.fn(),
}));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/settings/roles",
  useSearchParams: () => new URLSearchParams(),
}));

// ── Test data ───────────────────────────────────────────────────────────
function role(fields: Pick<Role, "id" | "name" | "permissions" | "memberCount"> & Partial<Role>): Role {
  return {
    description: null,
    isSystem: false,
    systemKey: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    archivedAt: null,
    ...fields,
  };
}

const OWNER_ROLE = role({ id: "r-owner", name: "المالك", isSystem: true, systemKey: SystemRoleKey.OWNER, permissions: [...ALL_PERMISSIONS], memberCount: 2 });
const MANAGER_ROLE = role({
  id: "r-fm",
  name: "مدير ميدان",
  isSystem: true,
  systemKey: SystemRoleKey.FIELD_MANAGER,
  permissions: [...SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER],
  memberCount: 3,
});
const WORKER_ROLE = role({ id: "r-worker", name: "عامل", isSystem: true, systemKey: SystemRoleKey.WORKER, permissions: [...SYSTEM_ROLE_PERMISSIONS.WORKER], memberCount: 12 });
/** A custom role with money and one member. */
const ACCOUNTANT_ROLE = role({
  id: "r-acc",
  name: "محاسب",
  description: "الرواتب والتقارير المالية",
  permissions: [Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL, Permission.MANAGE_PAYROLL, Permission.GENERATE_OPERATIONAL_REPORTS, Permission.GENERATE_FINANCIAL_REPORTS],
  memberCount: 1,
});
/** A custom role nobody has: it may be archived. */
const OBSERVER_ROLE = role({ id: "r-obs", name: "مراقب مؤقت", permissions: [Permission.VIEW_ATTENDANCE], memberCount: 0 });
/** The API lists the custom roles after the built-in ones; here they come first to show the page orders them itself. */
const ROLES = [ACCOUNTANT_ROLE, OWNER_ROLE, MANAGER_ROLE, OBSERVER_ROLE, WORKER_ROLE];

function detail(of: Role, members: RoleDetail["members"] = []): RoleDetail {
  return { ...of, members };
}

const DETAILS: Record<string, RoleDetail> = {
  "r-fm": detail(MANAGER_ROLE, [
    { membershipId: "m-1", userId: "u-1", fullLegalName: "يوسف الخطيب", status: "ACTIVE" },
    { membershipId: "m-2", userId: "u-2", fullLegalName: "سارة حداد", status: "SUSPENDED" },
  ]),
  "r-acc": detail(ACCOUNTANT_ROLE, [{ membershipId: "m-3", userId: "u-3", fullLegalName: "ليلى خوري", status: "ACTIVE" }]),
  "r-obs": detail(OBSERVER_ROLE),
};

const REASON = "توزيع جديد للمهام";

// ── Helpers ─────────────────────────────────────────────────────────────
function renderPage() {
  return renderWithIntl(<RolesPage />, { queryClient: true });
}

async function table() {
  return screen.findByRole("table", { name: "أدوار المؤسسة مع الوصف وعدد الصلاحيات وعدد الأعضاء" });
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("button", { name: `عرض الدور ${name}` }).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

function cells(name: string): string[] {
  return within(rowOf(name))
    .getAllByRole("cell")
    .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
}

/** A card (detail or editor) by its title. */
function card(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: title });
  const element = heading.closest(".rounded-lg");
  if (!element) throw new Error(`no card ${title}`);
  return element as HTMLElement;
}

function checkbox(container: HTMLElement, label: string): HTMLInputElement {
  return within(container).getByRole("checkbox", { name: label }) as HTMLInputElement;
}

/** The permissions ticked in a checklist, by their Arabic labels. */
function ticked(container: HTMLElement): string[] {
  return (within(container).getAllByRole("checkbox") as HTMLInputElement[]).filter((box) => box.checked).map((box) => box.labels?.[0]?.textContent ?? "");
}

/** The notes under a permission (its «مالي» / organization-wide marks and what it requires). */
function notesOf(container: HTMLElement, label: string): string {
  const box = checkbox(container, label);
  return document.getElementById(box.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.value = authWithAccess(builtInAccess(SystemRoleKey.OWNER), client);
  client.listRoles.mockResolvedValue(ROLES);
  client.getRole.mockImplementation(async (id: string) => DETAILS[id]);
  client.createRole.mockImplementation(async (input: { name: string; description?: string; permissions: Permission[] }) =>
    role({ id: "r-new", name: input.name, description: input.description ?? null, permissions: input.permissions, memberCount: 0 }),
  );
  client.updateRole.mockImplementation(async (id: string, input: Partial<Role>) => ({ ...ROLES.find((candidate) => candidate.id === id)!, ...input }));
  client.archiveRole.mockResolvedValue({ ...OBSERVER_ROLE, archivedAt: "2026-10-14T10:00:00.000Z" });
});

describe("Roles and permissions page", () => {
  it("lists the built-in roles first («أساسي», «لا يُعدَّل»), then the custom ones, with their permissions and members", async () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "الأدوار والصلاحيات" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "الإعدادات" }).getAttribute("href")).toBe("/settings");
    const list = await table();
    expect(
      within(list)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["الدور", "الوصف", "الصلاحيات", "الأعضاء", "الإجراءات"]);
    const names = within(list)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].firstChild?.textContent);
    expect(names).toEqual(["المالك", "مدير ميدان", "عامل", "محاسب", "مراقب مؤقت"]);

    expect(cells("المالك")).toEqual(["المالكأساسي", "كل الصلاحيات، ومنها الرواتب والمبالغ المالية وإدارة المستخدمين والأدوار.", "29", "2", "عرضلا يُعدَّل"]);
    expect(cells("مدير ميدان")).toEqual(["مدير ميدانأساسي", "الحضور والجدولة والمواقع والعمال والتقارير التشغيلية، دون أي مبالغ مالية.", "16", "3", "عرضلا يُعدَّل"]);
    expect(cells("عامل")).toEqual(["عاملأساسي", "تسجيل الدوام ورؤية سجل الحضور الشخصي من تطبيق الهاتف.", "2", "12", "عرضلا يُعدَّل"]);
    expect(cells("محاسب")).toEqual(["محاسب", "الرواتب والتقارير المالية", "5", "1", "عرضتعديل"]);
    expect(cells("مراقب مؤقت")).toEqual(["مراقب مؤقت", "بلا وصف", "1", "0", "عرضتعديل"]);
    // Built-in roles can only be viewed.
    expect(screen.queryByRole("button", { name: "تعديل الدور المالك" })).toBeNull();
    expect(screen.getByRole("button", { name: "تعديل الدور محاسب" })).toBeTruthy();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
    expect(document.body.textContent).not.toMatch(/[A-Za-z]/);
  });

  it("opens a built-in role read-only: its permissions ticked but locked, its members, and no edit or archive", async () => {
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "عرض الدور مدير ميدان" }));

    const view = card("مدير ميدان");
    expect(within(view).getByText("أساسي")).toBeTruthy();
    expect(within(view).getByText("دور أساسي: صلاحياته ثابتة، ولا يمكن تعديله ولا أرشفته.")).toBeTruthy();
    const boxes = within(view).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(29);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    expect(ticked(view)).toHaveLength(16);
    expect(checkbox(view, "رؤية سجل حضور الجميع").checked).toBe(true);
    expect(checkbox(view, "رؤية المبالغ المالية").checked).toBe(false);
    expect(checkbox(view, "رؤية كشوف الرواتب").checked).toBe(false);

    // The members, with their status.
    expect(await within(view).findByText("يوسف الخطيب")).toBeTruthy();
    expect(within(view).getByText("سارة حداد").nextElementSibling?.textContent).toBe("موقوف");
    expect(client.getRole).toHaveBeenCalledWith("r-fm");
    expect(within(view).queryByRole("button", { name: "تعديل الدور" })).toBeNull();
    expect(within(view).queryByRole("button", { name: "أرشفة الدور" })).toBeNull();
  });

  it("creates a custom role: ticking a permission ticks what it requires, unticking one unticks what depends on it", async () => {
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "إنشاء دور" }));
    const editor = card("دور جديد");

    // The catalog's groups, in order.
    expect(
      Array.from(editor.querySelectorAll("legend"), (legend) => legend.firstChild?.textContent?.trim()),
    ).toEqual(["الحضور", "الجدولة", "المواقع", "العمال", "الرواتب والمالية", "التقارير", "الإعدادات", "سجل التدقيق"]);
    // Money is marked, and so is what a member restricted to some projects never has.
    expect(notesOf(editor, "رؤية كشوف الرواتب")).toBe("ماليلا يتاح للأعضاء المقيَّدين بمشاريعيتطلب: رؤية المبالغ المالية");
    expect(notesOf(editor, "رؤية المبالغ المالية")).toBe("مالي");
    expect(notesOf(editor, "إدارة المستخدمين والأجهزة")).toBe("لا يتاح للأعضاء المقيَّدين بمشاريع");
    expect(notesOf(editor, "اعتماد الحضور أو رفضه")).toBe("يتطلب: رؤية سجل حضور الجميع");
    expect(ticked(editor)).toEqual([]);

    // Ticking "حساب الرواتب" ticks the money and the payroll it needs.
    fireEvent.click(checkbox(editor, "حساب الرواتب وتسجيل التعديلات"));
    expect(ticked(editor)).toEqual(["رؤية المبالغ المالية", "رؤية كشوف الرواتب", "حساب الرواتب وتسجيل التعديلات"]);
    // Unticking the money unticks everything that needs it.
    fireEvent.click(checkbox(editor, "رؤية المبالغ المالية"));
    expect(ticked(editor)).toEqual([]);

    fireEvent.click(checkbox(editor, "اعتماد الحضور أو رفضه"));
    fireEvent.click(checkbox(editor, "إصدار التقارير التشغيلية"));
    expect(ticked(editor)).toEqual(["رؤية سجل حضور الجميع", "اعتماد الحضور أو رفضه", "إصدار التقارير التشغيلية"]);
    expect(within(editor).getByRole("heading", { level: 3 }).textContent).toBe("الصلاحيات — 3 صلاحيات مختارة");

    // The name is required before anything is sent.
    fireEvent.click(within(editor).getByRole("button", { name: "إنشاء الدور" }));
    expect(within(editor).getByRole("alert").textContent).toBe("اكتب اسمًا من 2 إلى 60 حرفًا.");
    expect(client.createRole).not.toHaveBeenCalled();

    fireEvent.change(within(editor).getByLabelText("اسم الدور"), { target: { value: "  منسق الحضور  " } });
    fireEvent.change(within(editor).getByLabelText("الوصف (اختياري)"), { target: { value: "يعتمد الحضور اليومي" } });
    fireEvent.click(within(editor).getByRole("button", { name: "إنشاء الدور" }));

    await waitFor(() => expect(client.createRole).toHaveBeenCalledTimes(1));
    expect(client.createRole).toHaveBeenCalledWith({
      name: "منسق الحضور",
      description: "يعتمد الحضور اليومي",
      permissions: [Permission.VIEW_ATTENDANCE, Permission.APPROVE_ATTENDANCE, Permission.GENERATE_OPERATIONAL_REPORTS],
    });
    const done = await screen.findByText("تم إنشاء الدور «منسق الحضور».");
    expect(done.closest('[role="status"]')).toBeTruthy();
    await waitFor(() => expect(client.listRoles).toHaveBeenCalledTimes(2));
  });

  it("edits a custom role with a reason, sending only what changed", async () => {
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "تعديل الدور محاسب" }));
    const editor = card("تعديل الدور «محاسب»");

    expect((within(editor).getByLabelText("اسم الدور") as HTMLInputElement).value).toBe("محاسب");
    expect(ticked(editor)).toEqual(["رؤية المبالغ المالية", "رؤية كشوف الرواتب", "حساب الرواتب وتسجيل التعديلات", "إصدار التقارير التشغيلية", "إصدار التقارير المالية"]);
    expect(within(editor).getByText("يُحفظ السبب في سجل التدقيق. تُطبَّق التغييرات على أعضاء هذا الدور (1) في طلبهم التالي.")).toBeTruthy();

    // Nothing changed yet.
    fireEvent.change(within(editor).getByLabelText("سبب التعديل"), { target: { value: REASON } });
    fireEvent.click(within(editor).getByRole("button", { name: "حفظ التعديلات" }));
    expect(within(editor).getByText("لم يتغيّر شيء في هذا الدور.")).toBeTruthy();
    expect(client.updateRole).not.toHaveBeenCalled();

    // A reason is required.
    fireEvent.click(checkbox(editor, "اعتماد الرواتب وإعادة فتحها"));
    fireEvent.change(within(editor).getByLabelText("سبب التعديل"), { target: { value: "   " } });
    fireEvent.click(within(editor).getByRole("button", { name: "حفظ التعديلات" }));
    expect(within(editor).getByRole("alert").textContent).toBe("اكتب سبب التعديل.");
    expect(client.updateRole).not.toHaveBeenCalled();

    fireEvent.change(within(editor).getByLabelText("سبب التعديل"), { target: { value: REASON } });
    fireEvent.click(within(editor).getByRole("button", { name: "حفظ التعديلات" }));
    await waitFor(() => expect(client.updateRole).toHaveBeenCalledTimes(1));
    expect(client.updateRole).toHaveBeenCalledWith("r-acc", {
      permissions: [
        Permission.VIEW_FINANCIALS,
        Permission.VIEW_PAYROLL,
        Permission.MANAGE_PAYROLL,
        Permission.FINALIZE_PAYROLL,
        Permission.GENERATE_OPERATIONAL_REPORTS,
        Permission.GENERATE_FINANCIAL_REPORTS,
      ],
      reason: REASON,
    });
    expect(await screen.findByText("تم حفظ الدور «محاسب».")).toBeTruthy();
  });

  it.each([
    { code: "ROLE_NAME_TAKEN", status: 409, message: "يوجد دور بهذا الاسم بالفعل. اختر اسمًا آخر." },
    { code: "LAST_ADMIN", status: 409, message: "يجب أن يبقى في المؤسسة عضو فعّال واحد على الأقل يدير الأدوار والإعدادات." },
  ])("shows the API's $code in Arabic and keeps the form", async ({ code, status, message }) => {
    client.createRole.mockRejectedValue(apiError(status, code, "English API message"));
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "إنشاء دور" }));
    const editor = card("دور جديد");
    fireEvent.change(within(editor).getByLabelText("اسم الدور"), { target: { value: "محاسب" } });
    fireEvent.click(within(editor).getByRole("button", { name: "إنشاء الدور" }));

    expect((await within(editor).findByRole("alert")).textContent).toBe(message);
    expect(screen.queryByText("English API message")).toBeNull();
    expect((within(editor).getByLabelText("اسم الدور") as HTMLInputElement).value).toBe("محاسب");
  });

  it("lists which permission misses which when the API refuses the list (INVALID_ROLE_PERMISSIONS)", async () => {
    client.createRole.mockRejectedValue(
      apiError(400, "INVALID_ROLE_PERMISSIONS", "The role's permissions are not valid.", {
        problems: [{ permission: Permission.FINALIZE_PAYROLL, kind: "MISSING_REQUIRED", missing: [Permission.VIEW_PAYROLL] }],
      }),
    );
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "إنشاء دور" }));
    const editor = card("دور جديد");
    fireEvent.change(within(editor).getByLabelText("اسم الدور"), { target: { value: "مدقق" } });
    fireEvent.click(within(editor).getByRole("button", { name: "إنشاء الدور" }));

    const alert = await within(editor).findByRole("alert");
    expect(alert.querySelector("p")?.textContent).toBe("قائمة الصلاحيات غير صالحة: بعض الصلاحيات تحتاج إلى صلاحيات أخرى معها.");
    expect(within(alert).getByRole("listitem").textContent).toBe("«اعتماد الرواتب وإعادة فتحها» تحتاج أيضًا إلى: رؤية كشوف الرواتب.");
  });

  it("does not archive a role that has members, and says why", async () => {
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "عرض الدور محاسب" }));
    const view = card("محاسب");

    expect(await within(view).findByText("ليلى خوري")).toBeTruthy();
    const archive = within(view).getByRole("button", { name: "أرشفة الدور" }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    const why = document.getElementById(archive.getAttribute("aria-describedby") ?? "");
    expect(why?.textContent).toBe("لا يمكن أرشفة دور له أعضاء (1). انقل أعضاءه إلى دور آخر من صفحة المستخدمين أولًا.");
    expect(client.archiveRole).not.toHaveBeenCalled();
  });

  it("archives a role nobody has after a confirmation with a reason", async () => {
    client.listRoles.mockResolvedValueOnce(ROLES).mockResolvedValue(ROLES.filter((candidate) => candidate.id !== "r-obs"));
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "عرض الدور مراقب مؤقت" }));
    const view = card("مراقب مؤقت");
    expect(await within(view).findByText("لا يوجد أعضاء بهذا الدور.")).toBeTruthy();

    fireEvent.click(within(view).getByRole("button", { name: "أرشفة الدور" }));
    expect(within(view).getByText("الأرشفة نهائية: لا يمكن إسناد هذا الدور لأي عضو بعدها.")).toBeTruthy();
    fireEvent.click(within(view).getByRole("button", { name: "تأكيد الأرشفة" }));
    expect(within(view).getByText("اكتب السبب قبل المتابعة.")).toBeTruthy();
    expect(client.archiveRole).not.toHaveBeenCalled();

    fireEvent.change(within(view).getByLabelText("سبب الأرشفة"), { target: { value: REASON } });
    fireEvent.click(within(view).getByRole("button", { name: "تأكيد الأرشفة" }));
    await waitFor(() => expect(client.archiveRole).toHaveBeenCalledWith("r-obs", REASON));
    expect(await screen.findByText("تمت أرشفة الدور «مراقب مؤقت».")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "عرض الدور مراقب مؤقت" })).toBeNull());
  });

  it("shows the API's refusal to archive (ROLE_IN_USE) in Arabic", async () => {
    client.archiveRole.mockRejectedValue(apiError(409, "ROLE_IN_USE", "Move this role's members to another role first."));
    renderPage();
    await table();
    fireEvent.click(screen.getByRole("button", { name: "عرض الدور مراقب مؤقت" }));
    const view = card("مراقب مؤقت");
    fireEvent.click(within(view).getByRole("button", { name: "أرشفة الدور" }));
    fireEvent.change(within(view).getByLabelText("سبب الأرشفة"), { target: { value: REASON } });
    fireEvent.click(within(view).getByRole("button", { name: "تأكيد الأرشفة" }));

    expect((await within(view).findByRole("alert")).textContent).toBe("لا يمكن أرشفة دور له أعضاء. انقل أعضاءه إلى دور آخر أولًا.");
  });

  it("is only for whoever manages roles: a Field Manager is sent to the dashboard and nothing is loaded", async () => {
    auth.value = authWithAccess(builtInAccess(SystemRoleKey.FIELD_MANAGER), client);
    renderPage();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("heading", { name: "الأدوار والصلاحيات" })).toBeNull();
    expect(client.listRoles).not.toHaveBeenCalled();
  });
});
