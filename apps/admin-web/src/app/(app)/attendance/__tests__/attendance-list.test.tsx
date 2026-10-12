import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AttendanceListItem, Project, Site, Worker } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";
import { LIST_ITEM, hasArabicIndicDigits, listPage } from "@/test/attendance-fixtures";
import AttendancePage from "../page";

// Step 5 list behaviour: tabs, filters kept in the URL, pagination, cards that open the
// evidence page, and the "missing clock-in" dialog. Approve / reject / full-day credit are
// covered by attendance-page.test.tsx.

const client = vi.hoisted(() => ({
  listAttendanceEntries: vi.fn(),
  listWorkers: vi.fn(),
  listProjects: vi.fn(),
  listSites: vi.fn(),
  // The "add a missing clock-in" dialog.
  listShifts: vi.fn(),
  listForgottenStampInfractions: vi.fn(),
  createManualCorrection: vi.fn(),
  approveTimeEntry: vi.fn(),
  rejectTimeEntry: vi.fn(),
  applyFullDayCredit: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "FIELD_MANAGER" as string }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/attendance",
  useSearchParams: () => nav.searchParams,
}));

const KHALED = "5a0e3c1d-2b4f-4c6a-8d9e-0f1a2b3c4d5e";
const SAMIR = "6b1f4d2e-3c5a-4d7b-9e0f-1a2b3c4d5e6f";
const AYALON = "7c2a5e3f-4d6b-4e8c-8f1a-2b3c4d5e6f70";
const NORTH_JUNCTION = "8d3b6f4a-5e7c-4f9d-9a2b-3c4d5e6f7081";
const SOUTH_DEPOT = "9e4c7a5b-6f8d-4a0e-8b3c-4d5e6f708192";
const SOUTH_PROJECT = "0a5d8b6c-7a9e-4b1f-9c4d-5e6f708192a3";

/** Workers as an Owner receives them: with compensation, which this page must never show. */
const WORKERS: Worker[] = [
  {
    id: KHALED,
    organizationId: "org-1",
    fullLegalName: "خالد ناصر",
    preferredName: null,
    phoneNumber: "+972500010001",
    accountStatus: "ACTIVE",
    role: "WORKER",
    createdAt: "2026-01-10T08:30:00.000Z",
    compensation: {
      compensationType: "DAILY",
      dailyBaseRateAgorot: 45678,
      baseHourlyRateAgorot: null,
      overtimeHourlyRateAgorot: 7123,
      effectiveStartDate: "2026-01-15T00:00:00.000Z",
    },
  },
  {
    id: SAMIR,
    organizationId: "org-1",
    fullLegalName: "سمير حداد",
    preferredName: null,
    phoneNumber: "+972500010002",
    accountStatus: "ACTIVE",
    role: "WORKER",
    createdAt: "2026-02-01T06:00:00.000Z",
    compensation: {
      compensationType: "HOURLY",
      dailyBaseRateAgorot: null,
      baseHourlyRateAgorot: 3456,
      overtimeHourlyRateAgorot: 5189,
      effectiveStartDate: "2026-02-01T00:00:00.000Z",
    },
  },
];
/** Money that must never appear on the page, however the rates or the budget would be written. */
const MONEY_TEXTS = ["45678", "456.78", "7123", "71.23", "3456", "34.56", "5189", "51.89", "1234567", "12,345.67", "7654321", "76,543.21"];

/** Projects as an Owner receives them: with a budget, which this page must never show either. */
const PROJECTS: Project[] = [
  { id: AYALON, name: "مشروع أيالون", client: null, projectCode: "AYL-01", status: "ACTIVE", budgetAgorot: 1_234_567 },
  { id: SOUTH_PROJECT, name: "مشروع الجنوب", client: null, projectCode: "STH-02", status: "ACTIVE", budgetAgorot: 7_654_321 },
];
const SITES: Site[] = [
  { id: NORTH_JUNCTION, projectId: AYALON, name: "تقاطع الشمال", latitude: 32.0853, longitude: 34.7818, defaultGeofenceRadiusMeters: 150 },
  { id: SOUTH_DEPOT, projectId: SOUTH_PROJECT, name: "مستودع الجنوب", latitude: 31.25, longitude: 34.79, defaultGeofenceRadiusMeters: 200 },
];

const APPROVED_ENTRY: AttendanceListItem = {
  ...LIST_ITEM,
  status: "APPROVED",
  approvedRegularMinutes: 540,
  approvedOvertimeMinutes: 90,
  flags: ["OUTSIDE_GEOFENCE_ATTEMPT", "OFFLINE"],
};
const CORRECTION_REQUESTED_ENTRY: AttendanceListItem = {
  ...LIST_ITEM,
  id: "te-2",
  status: "CORRECTION_REQUESTED",
  worker: { id: "wp-2", fullLegalName: "سمير حداد" },
  flags: [],
};

const COUNTS = { PENDING: 3, APPROVED: 12, REJECTED: 1, ALL: 16 };

function renderAt(query = "") {
  nav.searchParams = new URLSearchParams(query);
  return renderWithIntl(<AttendancePage />, { queryClient: true });
}

/** The URL of the last `router.replace`, with its query decoded. */
function lastReplace(): { path: string; query: Record<string, string> } {
  const url = nav.router.replace.mock.lastCall?.[0] as string | undefined;
  if (url === undefined) throw new Error("router.replace was not called");
  const [path, query = ""] = url.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
}

/** Each tab as [label, count, aria-selected]. */
function tabsState(): [string | null | undefined, string | null | undefined, string | null][] {
  return screen.getAllByRole("tab").map((tab) => [tab.firstChild?.textContent, tab.querySelector("bdi")?.textContent, tab.getAttribute("aria-selected")]);
}

function cardOf(workerName: string) {
  const item = screen.getByRole("link", { name: workerName }).closest("li");
  if (!item) throw new Error(`no card for ${workerName}`);
  return within(item);
}

/** The value next to a label in a card's description list. */
function fieldValue(card: ReturnType<typeof within>, label: string): string | null | undefined {
  return card.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

/** Lets pending effects (such as a redirect) run before asserting that nothing happened. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** The loading state inside the list panel. */
const listLoading = () => within(screen.getByRole("tabpanel")).queryByText("جارٍ التحميل…");

const checkbox = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const control = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "FIELD_MANAGER";
  client.listAttendanceEntries.mockResolvedValue(listPage([LIST_ITEM]));
  client.listWorkers.mockResolvedValue(WORKERS);
  client.listProjects.mockResolvedValue(PROJECTS);
  client.listSites.mockResolvedValue(SITES);
  client.listShifts.mockResolvedValue([]);
  client.listForgottenStampInfractions.mockResolvedValue([]);
});

describe("Attendance list: tabs", () => {
  it("shows the four tabs with the counts of the current filters and selects the URL's tab", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([], { tabCounts: COUNTS }));
    renderAt("tab=REJECTED");

    expect(screen.getByRole("tablist", { name: "تصنيف سجلات الحضور حسب الحالة" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("tab")[0].querySelector("bdi")).not.toBeNull());
    expect(tabsState()).toEqual([
      ["بانتظار الموافقة", "3", "false"],
      ["معتمد", "12", "false"],
      ["مرفوض", "1", "true"],
      ["الكل", "16", "false"],
    ]);
    // Every tab controls the list panel.
    for (const tab of screen.getAllByRole("tab")) {
      expect(document.getElementById(tab.getAttribute("aria-controls") ?? "")?.getAttribute("role")).toBe("tabpanel");
    }
    expect(client.listAttendanceEntries).toHaveBeenCalledWith({ tab: "REJECTED", page: 1, pageSize: 20 });
  });

  it("switches tabs through the URL", async () => {
    renderAt();
    await screen.findByRole("link", { name: "خالد ناصر" });
    expect(screen.getByRole("tab", { name: /^بانتظار الموافقة/ }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: /^معتمد/ }));
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith("/attendance?tab=APPROVED");
  });

  it("removes the tab (and the page) from the URL when the default tab is chosen, keeping the filters", async () => {
    renderAt("tab=ALL&shiftType=STANDARD&page=3");
    await screen.findByRole("link", { name: "خالد ناصر" });
    fireEvent.click(screen.getByRole("tab", { name: /^بانتظار الموافقة/ }));
    expect(nav.router.replace).toHaveBeenLastCalledWith("/attendance?shiftType=STANDARD");
  });
});

describe("Attendance list: filters in the URL", () => {
  it("sends the URL's filters to the API with the page size", async () => {
    renderAt(
      `tab=ALL&workerProfileId=${KHALED}&from=2026-10-01&to=2026-10-31&projectId=${AYALON}&siteId=${NORTH_JUNCTION}&shiftType=STANDARD&flags=OFFLINE,EMERGENCY&page=2`,
    );
    await screen.findByRole("link", { name: "خالد ناصر" });
    expect(client.listAttendanceEntries).toHaveBeenCalledTimes(1);
    expect(client.listAttendanceEntries).toHaveBeenCalledWith({
      tab: "ALL",
      workerProfileId: KHALED,
      from: "2026-10-01",
      to: "2026-10-31",
      projectId: AYALON,
      siteId: NORTH_JUNCTION,
      shiftType: "STANDARD",
      flags: ["OFFLINE", "EMERGENCY"],
      page: 2,
      pageSize: 20,
    });
  });

  it("drops invalid values instead of sending them (the tab falls back to pending)", async () => {
    renderAt("tab=OPEN&workerProfileId=wp-1&from=2026-13-01&to=31-10-2026&projectId=p-1&siteId=123&shiftType=WEEKEND&flags=OFFLINE,NOT_A_FLAG&page=0");
    await screen.findByRole("link", { name: "خالد ناصر" });
    expect(client.listAttendanceEntries).toHaveBeenCalledWith({ tab: "PENDING", flags: ["OFFLINE"], page: 1, pageSize: 20 });
    const sent = client.listAttendanceEntries.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.entries(sent).filter(([, value]) => value !== undefined)).toEqual([
      ["tab", "PENDING"],
      ["flags", ["OFFLINE"]],
      ["page", 1],
      ["pageSize", 20],
    ]);
    expect(screen.getByRole("tab", { name: /^بانتظار الموافقة/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the filter panel closed by default without loading its lists", async () => {
    renderAt();
    await screen.findByRole("link", { name: "خالد ناصر" });
    expect(screen.getByRole("heading", { name: "التصفية" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "عرض التصفية" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("العامل")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "مسح التصفية" })).toBeNull();
    expect(client.listWorkers).not.toHaveBeenCalled();
    expect(client.listProjects).not.toHaveBeenCalled();
    expect(client.listSites).not.toHaveBeenCalled();
  });

  it("opens the panel, loads the workers, projects and sites, and closes it again", async () => {
    renderAt();
    await screen.findByRole("link", { name: "خالد ناصر" });
    fireEvent.click(screen.getByRole("button", { name: "عرض التصفية" }));

    const hide = screen.getByRole("button", { name: "إخفاء التصفية" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(hide.getAttribute("aria-controls") ?? "")?.contains(control("العامل"))).toBe(true);

    expect(await screen.findByRole("option", { name: "سمير حداد" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "مشروع أيالون" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "تقاطع الشمال" })).toBeTruthy();
    expect(client.listWorkers).toHaveBeenCalledTimes(1);
    expect(client.listProjects).toHaveBeenCalledTimes(1);
    expect(client.listSites).toHaveBeenCalledTimes(1);
    expect(control("العامل").value).toBe("");
    expect(screen.getByRole("option", { name: "كل العمال" })).toBeTruthy();
    expect(
      within(control("نوع الوردية") as HTMLSelectElement)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["كل الأنواع", "وردية عادية", "مناوبة نهارية", "مناوبة ليلية", "استدعاء طوارئ"]);
    // Every flag is offered with its Arabic label, none ticked.
    expect(screen.getAllByRole("checkbox").map((box) => [box.closest("label")?.textContent, (box as HTMLInputElement).checked])).toEqual([
      ["محاولة خارج نطاق الموقع", false],
      ["موقع وهمي أو مشبوه", false],
      ["تسجيل دون اتصال", false],
      ["تسجيل مرن", false],
      ["نقطة تسجيل مؤقتة", false],
      ["استدعاء طوارئ", false],
      ["تعديل تجريبي", false],
    ]);
    expect(nav.router.replace).not.toHaveBeenCalled();

    fireEvent.click(hide);
    expect(screen.getByRole("button", { name: "عرض التصفية" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("العامل")).toBeNull();
  });

  it("puts the chosen worker in the URL and goes back to the first page", async () => {
    renderAt("tab=APPROVED&page=3");
    await screen.findByRole("link", { name: "خالد ناصر" });
    fireEvent.click(screen.getByRole("button", { name: "عرض التصفية" }));
    await screen.findByRole("option", { name: "سمير حداد" });

    fireEvent.change(control("العامل"), { target: { value: SAMIR } });
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith(`/attendance?tab=APPROVED&workerProfileId=${SAMIR}`);
  });

  it("adds a ticked flag to the flags in the URL and removes an unticked one", async () => {
    renderAt("tab=ALL&flags=OFFLINE&page=2");
    await screen.findByRole("link", { name: "خالد ناصر" });
    expect(checkbox("تسجيل دون اتصال").checked).toBe(true);
    expect(checkbox("استدعاء طوارئ").checked).toBe(false);

    fireEvent.click(checkbox("استدعاء طوارئ"));
    expect(lastReplace()).toEqual({ path: "/attendance", query: { tab: "ALL", flags: "OFFLINE,EMERGENCY" } });

    fireEvent.click(checkbox("تسجيل دون اتصال"));
    expect(lastReplace()).toEqual({ path: "/attendance", query: { tab: "ALL" } });
  });

  it("clears the site when another project is chosen", async () => {
    renderAt(`projectId=${AYALON}&siteId=${NORTH_JUNCTION}`);
    await screen.findByRole("option", { name: "تقاطع الشمال" });
    fireEvent.change(control("المشروع"), { target: { value: SOUTH_PROJECT } });
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith(`/attendance?projectId=${SOUTH_PROJECT}`);
  });

  it("opens the panel for filters in the URL, shows them and how many there are, and clears them all", async () => {
    renderAt(
      `tab=APPROVED&workerProfileId=${KHALED}&from=2026-10-01&to=2026-10-31&projectId=${AYALON}&siteId=${NORTH_JUNCTION}&shiftType=STANDARD&flags=OFFLINE,EMERGENCY&page=2`,
    );
    await screen.findByRole("option", { name: "تقاطع الشمال" });

    // Six fields and two flags.
    expect(screen.getByText("8 عوامل تصفية")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "عرض التصفية" })).toBeNull();
    expect(control("العامل").value).toBe(KHALED);
    expect(control("من تاريخ").value).toBe("2026-10-01");
    expect(control("إلى تاريخ").value).toBe("2026-10-31");
    expect(control("المشروع").value).toBe(AYALON);
    expect(control("الموقع").value).toBe(NORTH_JUNCTION);
    expect(control("نوع الوردية").value).toBe("STANDARD");
    expect(checkbox("تسجيل دون اتصال").checked).toBe(true);
    expect(checkbox("استدعاء طوارئ").checked).toBe(true);
    expect(checkbox("محاولة خارج نطاق الموقع").checked).toBe(false);
    // Only the chosen project's sites are offered.
    expect(screen.queryByRole("option", { name: "مستودع الجنوب" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "مسح التصفية" }));
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith("/attendance?tab=APPROVED");
  });
});

describe("Attendance list: cards", () => {
  it("shows an approved entry with its status, flags, place and date, linking to its evidence page, without actions", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([APPROVED_ENTRY], { tabCounts: { PENDING: 0, APPROVED: 1, REJECTED: 0, ALL: 1 } }));
    renderAt("tab=APPROVED");

    const nameLink = await screen.findByRole("link", { name: "خالد ناصر" });
    expect(nameLink.getAttribute("href")).toBe("/attendance/te-1");
    expect(screen.getByRole("list", { name: "الورديات المعتمدة" })).toBeTruthy();

    const card = cardOf("خالد ناصر");
    expect(card.getByText("تمت الموافقة")).toBeTruthy();
    expect(card.getByText("محاولة خارج نطاق الموقع")).toBeTruthy();
    expect(card.getByText("تسجيل دون اتصال")).toBeTruthy();
    expect(card.getByText("تنظيم حركة المرور صباحًا")).toBeTruthy();
    expect(card.getByText("مشروع أيالون · تقاطع الشمال")).toBeTruthy();
    expect(fieldValue(card, "يوم العمل")).toBe("4 أكتوبر 2026");
    expect(fieldValue(card, "بدء الدوام")).toBe("4 أكتوبر 2026 في 07:00");
    expect(fieldValue(card, "إنهاء الدوام")).toBe("4 أكتوبر 2026 في 17:30");
    expect(fieldValue(card, "المدة")).toBe("10 س 30 د");

    const details = card.getByRole("link", { name: "عرض تفاصيل حضور خالد ناصر" });
    expect(details.getAttribute("href")).toBe("/attendance/te-1");
    expect(details.textContent).toBe("عرض التفاصيل");

    expect(card.queryByRole("button", { name: "موافقة" })).toBeNull();
    expect(card.queryByRole("button", { name: "رفض" })).toBeNull();
    expect(card.queryByRole("button", { name: "احتساب يوم كامل" })).toBeNull();
    // Everything fits on one page.
    expect(screen.queryByRole("navigation", { name: "صفحات سجلات الحضور" })).toBeNull();
  });

  it("shows the status of an entry waiting for a correction in the pending tab, with the actions", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([LIST_ITEM, CORRECTION_REQUESTED_ENTRY]));
    renderAt();
    await screen.findByRole("link", { name: "سمير حداد" });

    const correction = cardOf("سمير حداد");
    expect(correction.getByText("مطلوب تصحيح")).toBeTruthy();
    expect(correction.getByRole("button", { name: "موافقة" })).toBeTruthy();
    expect(correction.getByRole("button", { name: "رفض" })).toBeTruthy();
    expect(correction.getByRole("link", { name: "عرض تفاصيل حضور سمير حداد" }).getAttribute("href")).toBe("/attendance/te-2");

    // A plain pending entry needs no status badge in the pending tab, but keeps its actions.
    const pending = cardOf("خالد ناصر");
    expect(pending.queryByText("بانتظار الموافقة")).toBeNull();
    expect(pending.getByRole("button", { name: "موافقة" })).toBeTruthy();
    expect(pending.getByText("محاولة خارج نطاق الموقع")).toBeTruthy();
  });

  it("shows the empty state of the other tabs", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([]));
    renderAt("tab=REJECTED");
    expect(await screen.findByText("لا توجد سجلات حضور مطابقة")).toBeTruthy();
    expect(screen.getByText("غيّر التبويب أو التصفية لعرض سجلات أخرى.")).toBeTruthy();
    expect(screen.queryByText("لا توجد ورديات بانتظار الموافقة")).toBeNull();
    expect(screen.queryByRole("list", { name: "الورديات المرفوضة" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "صفحات سجلات الحضور" })).toBeNull();
  });
});

describe("Attendance list: pagination", () => {
  it("shows the page out of the total and moves to the next page through the URL", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([APPROVED_ENTRY], { total: 45 }));
    renderAt("tab=APPROVED");

    const pagination = within(await screen.findByRole("navigation", { name: "صفحات سجلات الحضور" }));
    expect(pagination.getByText("صفحة 1 من 3")).toBeTruthy();
    expect((pagination.getByRole("button", { name: "السابق" }) as HTMLButtonElement).disabled).toBe(true);
    const next = pagination.getByRole("button", { name: "التالي" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);

    fireEvent.click(next);
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith("/attendance?tab=APPROVED&page=2");
  });

  it("asks for the URL's page and leaves the page out of the URL when going back to the first one", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([APPROVED_ENTRY], { page: 2, total: 45 }));
    renderAt("tab=APPROVED&page=2");

    const pagination = within(await screen.findByRole("navigation", { name: "صفحات سجلات الحضور" }));
    expect(client.listAttendanceEntries).toHaveBeenCalledWith({ tab: "APPROVED", page: 2, pageSize: 20 });
    expect(pagination.getByText("صفحة 2 من 3")).toBeTruthy();

    fireEvent.click(pagination.getByRole("button", { name: "السابق" }));
    expect(nav.router.replace).toHaveBeenLastCalledWith("/attendance?tab=APPROVED");
  });

  it("disables the next page on the last page", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([APPROVED_ENTRY], { page: 3, total: 45 }));
    renderAt("tab=APPROVED&page=3");
    const pagination = within(await screen.findByRole("navigation", { name: "صفحات سجلات الحضور" }));
    expect(pagination.getByText("صفحة 3 من 3")).toBeTruthy();
    expect((pagination.getByRole("button", { name: "التالي" }) as HTMLButtonElement).disabled).toBe(true);
    expect((pagination.getByRole("button", { name: "السابق" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Attendance list: a page past the end", () => {
  it("sends an empty page past the end to the last page, showing the loading state meanwhile and keeping the counts", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([], { page: 2, total: 20, tabCounts: { PENDING: 20, APPROVED: 5, REJECTED: 1, ALL: 26 } }));
    renderAt("tab=PENDING&page=2");

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalled());
    expect(client.listAttendanceEntries).toHaveBeenCalledWith({ tab: "PENDING", page: 2, pageSize: 20 });
    // The last page is page 1, the default (like the pending tab), so both leave the URL.
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith("/attendance");

    // Meanwhile: loading, never "nothing is waiting".
    expect(listLoading()).not.toBeNull();
    expect(screen.queryByText("لا توجد ورديات بانتظار الموافقة")).toBeNull();
    expect(screen.queryByText("تمت مراجعة كل الورديات المسجّلة.")).toBeNull();
    expect(screen.queryByRole("list", { name: "الورديات بانتظار الموافقة" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "صفحات سجلات الحضور" })).toBeNull();
    // The header badge and the tab counts still come from the response.
    expect(screen.getByText("20 وردية بانتظار الموافقة")).toBeTruthy();
    expect(tabsState()).toEqual([
      ["بانتظار الموافقة", "20", "true"],
      ["معتمد", "5", "false"],
      ["مرفوض", "1", "false"],
      ["الكل", "26", "false"],
    ]);

    await settle();
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
  });

  it("keeps the tab and the filters when the last page is not the first", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([], { page: 5, total: 45, tabCounts: { PENDING: 0, APPROVED: 45, REJECTED: 0, ALL: 45 } }));
    renderAt(`tab=APPROVED&workerProfileId=${KHALED}&flags=OFFLINE&page=5`);

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalled());
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(lastReplace()).toEqual({ path: "/attendance", query: { tab: "APPROVED", workerProfileId: KHALED, flags: "OFFLINE", page: "3" } });
    expect(listLoading()).not.toBeNull();
    expect(screen.queryByText("لا توجد سجلات حضور مطابقة")).toBeNull();
  });

  it("goes back a page after the only entry of the last page is approved, instead of saying nothing is waiting", async () => {
    const lastEntry: AttendanceListItem = { ...LIST_ITEM, id: "te-21" };
    client.listAttendanceEntries
      .mockResolvedValueOnce(listPage([lastEntry], { page: 2, total: 21, tabCounts: { PENDING: 21, APPROVED: 5, REJECTED: 0, ALL: 26 } }))
      .mockResolvedValue(listPage([], { page: 2, total: 20, tabCounts: { PENDING: 20, APPROVED: 6, REJECTED: 0, ALL: 26 } }));
    renderAt("page=2");
    await screen.findByRole("link", { name: "خالد ناصر" });
    expect(screen.getByText("صفحة 2 من 2")).toBeTruthy();
    expect(screen.getByText("21 وردية بانتظار الموافقة")).toBeTruthy();

    fireEvent.click(cardOf("خالد ناصر").getByRole("button", { name: "موافقة" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalled());
    expect(client.approveTimeEntry).toHaveBeenCalledWith("te-21");
    expect(client.listAttendanceEntries).toHaveBeenCalledTimes(2);
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith("/attendance");

    expect(screen.getByText("تمت الموافقة على وردية خالد ناصر.")).toBeTruthy();
    expect(listLoading()).not.toBeNull();
    expect(screen.queryByText("لا توجد ورديات بانتظار الموافقة")).toBeNull();
    expect(screen.queryByRole("link", { name: "خالد ناصر" })).toBeNull();
    expect(screen.getByText("20 وردية بانتظار الموافقة")).toBeTruthy();
  });

  it("does nothing for an empty list: the pending tab says nothing is waiting", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([]));
    renderAt();
    expect(await screen.findByText("لا توجد ورديات بانتظار الموافقة")).toBeTruthy();
    expect(screen.getByText("تمت مراجعة كل الورديات المسجّلة.")).toBeTruthy();
    await settle();
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(listLoading()).toBeNull();
  });

  it.each([1, 2, 3])("does nothing on page %i of 3", async (page) => {
    client.listAttendanceEntries.mockResolvedValue(listPage([APPROVED_ENTRY], { page, total: 45 }));
    renderAt(`tab=APPROVED&page=${page}`);
    expect(await screen.findByText(`صفحة ${page} من 3`)).toBeTruthy();
    await settle();
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(listLoading()).toBeNull();
    expect(screen.getByRole("link", { name: "خالد ناصر" })).toBeTruthy();
  });
});

describe("Attendance list: no money", () => {
  it("shows no money to an Owner, even with the Owner's workers (with rates) and projects (with budgets) loaded for the filters", async () => {
    auth.role = "OWNER";
    client.listAttendanceEntries.mockResolvedValue(listPage([LIST_ITEM, CORRECTION_REQUESTED_ENTRY]));
    renderAt();
    await screen.findByRole("link", { name: "خالد ناصر" });
    fireEvent.click(screen.getByRole("button", { name: "عرض التصفية" }));
    await screen.findByRole("option", { name: "سمير حداد" });
    await screen.findByRole("option", { name: "مشروع الجنوب" });

    const text = document.body.textContent ?? "";
    expect(text).toContain("10 س 30 د");
    expect(text).not.toContain("₪");
    for (const money of MONEY_TEXTS) expect(text).not.toContain(money);
    expect(hasArabicIndicDigits(text)).toBe(false);
  });
});

describe("Attendance list: adding a missing clock-in", () => {
  it("opens the correction dialog and closes it again without saving", async () => {
    renderAt();
    await screen.findByRole("link", { name: "خالد ناصر" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إضافة بدء دوام منسي" }));
    const dialog = within(screen.getByRole("dialog", { name: "إضافة بدء دوام منسي" }));
    // A new entry: the manager picks the worker and the shift.
    expect(await dialog.findByRole("option", { name: "خالد ناصر" })).toBeTruthy();
    expect(dialog.getByLabelText("العامل")).toBeTruthy();
    expect(dialog.getByLabelText("الوردية")).toBeTruthy();
    await waitFor(() => expect(client.listShifts).toHaveBeenCalled());

    fireEvent.click(dialog.getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.createManualCorrection).not.toHaveBeenCalled();
    expect(nav.router.push).not.toHaveBeenCalled();
  });
});
