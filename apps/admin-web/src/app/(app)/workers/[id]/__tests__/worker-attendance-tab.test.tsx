import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AttendanceListItem, WorkerMonthEarnings } from "@fieldmaster/api-client";
import { toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { LIST_ITEM, listPage } from "@/test/attendance-fixtures";
import WorkerDetailPage from "../page";
import { MANAGER_WORKERS, OWNER_WORKERS, apiError, hasArabicIndicDigits, renderWorkersPage } from "../../__tests__/workers-test-utils";

// Step 5: the worker page's "سجل الحضور" tab (a month of attendance; an Owner also sees the month's estimated earnings).

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/workers/w-daily",
  useParams: () => ({ id: "w-daily" }),
  useSearchParams: () => nav.searchParams,
}));

const auth = vi.hoisted(() => ({
  role: "FIELD_MANAGER" as string,
  client: { getWorker: vi.fn(), listAttendanceEntries: vi.fn(), getWorkerEstimatedEarnings: vi.fn() },
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ client: auth.client, session: { role: auth.role }, isAuthenticated: true, isReady: true, login: () => {}, logout: () => {} }),
}));

/**
 * Approved, then the clock-out was corrected: the times now give 600 worked minutes (540 + 60),
 * but the approved split (540 + 100) is what counts until it is approved again.
 */
const APPROVED_ROW: AttendanceListItem = {
  ...LIST_ITEM,
  id: "te-1",
  status: "APPROVED",
  businessDate: "2026-10-04",
  clockInAt: "2026-10-04T04:00:00.000Z", // 07:00 in Jerusalem
  clockOutAt: "2026-10-04T14:00:00.000Z", // 17:00
  rawDurationMinutes: 600,
  unpaidBreakMinutes: 0,
  approvedRegularMinutes: 540,
  approvedOvertimeMinutes: 100,
  flags: ["OFFLINE"],
};
/** Pending: 615 minutes with a 30-minute unpaid break -> 585 worked = 540 regular + 45 overtime (the shared split). */
const PENDING_ROW: AttendanceListItem = {
  ...LIST_ITEM,
  id: "te-2",
  status: "PENDING_APPROVAL",
  businessDate: "2026-10-05",
  clockInAt: "2026-10-05T05:00:00.000Z", // 08:00
  clockOutAt: "2026-10-05T15:15:00.000Z", // 18:15
  rawDurationMinutes: 615,
  unpaidBreakMinutes: 30,
  flags: ["OUTSIDE_GEOFENCE_ATTEMPT", "TEMPORARY_POINT"],
};
/** Pending with full-day credit: 300 worked minutes count as 540 regular (the shared split). */
const CREDITED_ROW: AttendanceListItem = {
  ...LIST_ITEM,
  id: "te-3",
  status: "PENDING_APPROVAL",
  businessDate: "2026-10-06",
  clockInAt: "2026-10-06T04:00:00.000Z", // 07:00
  clockOutAt: "2026-10-06T09:00:00.000Z", // 12:00
  rawDurationMinutes: 300,
  unpaidBreakMinutes: 0,
  fullDayCredit: true,
  flags: [],
};
/** Still clocked in: no duration yet. */
const OPEN_ROW: AttendanceListItem = {
  ...LIST_ITEM,
  id: "te-4",
  status: "ACTIVE",
  businessDate: "2026-10-12",
  clockInAt: "2026-10-12T04:00:00.000Z", // 07:00
  clockOutAt: null,
  rawDurationMinutes: null,
  dailySummary: null,
  flags: [],
};
const ROWS = [APPROVED_ROW, PENDING_ROW, CREDITED_ROW, OPEN_ROW];
/** Rejected: 630 worked minutes (540 + 90 had it been approved), which are not paid and not counted. */
const REJECTED_ROW: AttendanceListItem = {
  ...LIST_ITEM,
  id: "te-5",
  status: "REJECTED",
  businessDate: "2026-10-07",
  clockInAt: "2026-10-07T04:00:00.000Z", // 07:00
  clockOutAt: "2026-10-07T14:30:00.000Z", // 17:30
  rawDurationMinutes: 630,
  unpaidBreakMinutes: 0,
  flags: ["SUSPICIOUS_LOCATION"],
};
const REJECTED_NOT_COUNTED = "السجلات المرفوضة غير محسوبة في المجموع.";

const EARNINGS: WorkerMonthEarnings = {
  workerProfileId: "w-daily",
  month: "2026-10",
  approvedAgorot: 49_000,
  pendingEstimateAgorot: 40_000,
  adjustmentsAgorot: -1_000,
  totalEstimatedAgorot: 88_000,
  approvedEntries: 1,
  pendingEntries: 2,
  openEntries: 1,
  entriesWithoutCompensationProfile: 0,
};

const TABLE_NAME = "سجلات حضور العامل في الشهر المختار";

function renderAt(query: string, role: "OWNER" | "FIELD_MANAGER" = "FIELD_MANAGER") {
  auth.role = role;
  auth.client.getWorker.mockResolvedValue(role === "OWNER" ? OWNER_WORKERS[0] : MANAGER_WORKERS[0]);
  nav.searchParams = new URLSearchParams(query);
  return renderWorkersPage(<WorkerDetailPage />);
}

/** The value next to a row label in a description list. */
function rowValue(label: string): string | null | undefined {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

/** A table row as cell texts; the flags cell as its badges. */
function rowCells(row: HTMLElement) {
  const cells = within(row).getAllByRole("cell");
  return {
    texts: cells.filter((_, index) => index !== 8).map((cell) => cell.textContent),
    flags: Array.from(cells[8].querySelectorAll("span")).map((badge) => badge.textContent),
    href: within(row).getByRole("link", { name: "التفاصيل" }).getAttribute("href"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.client.listAttendanceEntries.mockResolvedValue(listPage(ROWS));
  auth.client.getWorkerEstimatedEarnings.mockResolvedValue(EARNINGS);
});

describe("Worker detail page: tabs", () => {
  it("shows the profile tab by default, as before, and opens the attendance tab on the current month", async () => {
    renderAt("");
    const tablist = await screen.findByRole("tablist", { name: "أقسام ملف العامل" });
    const profileTab = within(tablist).getByRole("tab", { name: "الملف الشخصي" });
    const attendanceTab = within(tablist).getByRole("tab", { name: "سجل الحضور" });
    expect(profileTab.getAttribute("aria-selected")).toBe("true");
    expect(attendanceTab.getAttribute("aria-selected")).toBe("false");
    expect(profileTab.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);

    // The profile, as before.
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByRole("heading", { name: "الملف الشخصي" })).toBeTruthy();
    expect(rowValue("الحالة")).toBe("نشط");
    expect(rowValue("الدور")).toBe("عامل");
    expect(panel.getByText("لا تظهر بيانات أجر لهذا العامل.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(auth.client.listAttendanceEntries).not.toHaveBeenCalled();

    fireEvent.click(attendanceTab);
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith(`/workers/w-daily?tab=attendance&month=${toBusinessYearMonth(new Date())}`);
  });

  it("selects the attendance tab from the URL and goes back to the profile without a query", async () => {
    renderAt("tab=attendance&month=2026-10");
    await screen.findByRole("table", { name: TABLE_NAME });
    expect(screen.getByRole("tab", { name: "سجل الحضور" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "الملف الشخصي" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByText("الدور", { selector: "dt" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "الملف الشخصي" }));
    expect(nav.router.replace).toHaveBeenCalledWith("/workers/w-daily");
  });

  it("uses the current month when the URL's month is not a valid month", async () => {
    const month = toBusinessYearMonth(new Date());
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    renderAt("tab=attendance&month=2026-13");
    await screen.findByRole("table", { name: TABLE_NAME });
    expect(auth.client.listAttendanceEntries).toHaveBeenCalledWith({
      tab: "ALL",
      workerProfileId: "w-daily",
      from: `${month}-01`,
      to: `${month}-${lastDay}`,
      pageSize: 100,
    });
    expect((screen.getByLabelText("الشهر") as HTMLInputElement).value).toBe(month);
  });
});

describe("Worker detail page: attendance tab", () => {
  it("lists the month's entries with their minutes, status and flags, each linking to its evidence page", async () => {
    renderAt("tab=attendance&month=2026-10");
    const table = await screen.findByRole("table", { name: TABLE_NAME });

    expect(auth.client.listAttendanceEntries).toHaveBeenCalledTimes(1);
    expect(auth.client.listAttendanceEntries).toHaveBeenCalledWith({
      tab: "ALL",
      workerProfileId: "w-daily",
      from: "2026-10-01",
      to: "2026-10-31",
      pageSize: 100,
    });
    expect(screen.getByRole("heading", { name: "سجل الحضور" })).toBeTruthy();

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["يوم العمل", "الوردية", "بدء الدوام", "إنهاء الدوام", "مدة العمل", "ساعات عادية", "ساعات إضافية", "الحالة", "العلامات", "التفاصيل"]);

    const [, ...rows] = within(table).getAllByRole("row");
    expect(rows.map(rowCells)).toEqual([
      {
        // Approved: the approved regular / overtime minutes, not the split of the corrected times.
        texts: ["4 أكتوبر 2026", "تنظيم حركة المرور صباحًا", "07:00", "17:00", "10 س 0 د", "9 س 0 د", "1 س 40 د", "تمت الموافقة", "التفاصيل"],
        flags: ["تسجيل دون اتصال"],
        href: "/attendance/te-1",
      },
      {
        // Pending: the shared split of the worked minutes (break deducted).
        texts: ["5 أكتوبر 2026", "تنظيم حركة المرور صباحًا", "08:00", "18:15", "9 س 45 د", "9 س 0 د", "0 س 45 د", "بانتظار الموافقة", "التفاصيل"],
        flags: ["محاولة خارج نطاق الموقع", "نقطة تسجيل مؤقتة"],
        href: "/attendance/te-2",
      },
      {
        // Full-day credit lifts the regular minutes to a standard day.
        texts: ["6 أكتوبر 2026", "تنظيم حركة المرور صباحًا", "07:00", "12:00", "5 س 0 د", "9 س 0 د", "0 س 0 د", "بانتظار الموافقة", "التفاصيل"],
        flags: [],
        href: "/attendance/te-3",
      },
      {
        texts: ["12 أكتوبر 2026", "تنظيم حركة المرور صباحًا", "07:00", "—", "—", "—", "—", "جارٍ", "التفاصيل"],
        flags: [],
        href: "/attendance/te-4",
      },
    ]);

    // 600 + 585 + 300 worked; 540 x 3 regular; 100 + 45 overtime. The open entry counts as a record only.
    expect(screen.getByText(/^4 سجلات:/).textContent).toBe("4 سجلات: مدة العمل 24 س 45 د، ساعات عادية 27 س 0 د، ساعات إضافية 2 س 25 د");
    // Nothing was rejected, so there is no note about rejected entries.
    expect(screen.queryByText(REJECTED_NOT_COUNTED)).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("shows a rejected entry's worked minutes without regular or overtime, and leaves it out of the totals", async () => {
    auth.client.listAttendanceEntries.mockResolvedValue(listPage([APPROVED_ROW, PENDING_ROW, CREDITED_ROW, REJECTED_ROW, OPEN_ROW]));
    renderAt("tab=attendance&month=2026-10");
    const table = await screen.findByRole("table", { name: TABLE_NAME });

    const [, ...rows] = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(rowCells(rows[3])).toEqual({
      texts: ["7 أكتوبر 2026", "تنظيم حركة المرور صباحًا", "07:00", "17:30", "10 س 30 د", "—", "—", "مرفوض", "التفاصيل"],
      flags: ["موقع وهمي أو مشبوه"],
      href: "/attendance/te-5",
    });
    // The other rows are unchanged.
    expect(rowCells(rows[0]).texts).toEqual([
      "4 أكتوبر 2026",
      "تنظيم حركة المرور صباحًا",
      "07:00",
      "17:00",
      "10 س 0 د",
      "9 س 0 د",
      "1 س 40 د",
      "تمت الموافقة",
      "التفاصيل",
    ]);

    // The same totals as without the rejected entry (it would have added a record, 630 worked, 540 regular and 90 overtime).
    const totals = screen.getByText(/^4 سجلات:/);
    expect(totals.textContent).toBe("4 سجلات: مدة العمل 24 س 45 د، ساعات عادية 27 س 0 د، ساعات إضافية 2 س 25 د");
    // The note sits right under the totals.
    expect(totals.nextElementSibling?.textContent).toBe(REJECTED_NOT_COUNTED);
    expect(screen.getAllByText(REJECTED_NOT_COUNTED)).toHaveLength(1);
  });

  it("still lists a month whose only entry was rejected, with nothing counted", async () => {
    auth.client.listAttendanceEntries.mockResolvedValue(listPage([REJECTED_ROW]));
    renderAt("tab=attendance&month=2026-10");
    const table = await screen.findByRole("table", { name: TABLE_NAME });

    const [, ...rows] = within(table).getAllByRole("row");
    expect(rows.map((row) => rowCells(row).href)).toEqual(["/attendance/te-5"]);
    expect(screen.queryByText("لا توجد سجلات حضور في هذا الشهر")).toBeNull();
    const totals = screen.getByText(/: مدة العمل/);
    expect(totals.textContent).toContain("مدة العمل 0 س 0 د، ساعات عادية 0 س 0 د، ساعات إضافية 0 س 0 د");
    expect(totals.nextElementSibling?.textContent).toBe(REJECTED_NOT_COUNTED);
  });

  it("changes the month through the URL with the month picker", async () => {
    renderAt("tab=attendance&month=2026-10");
    await screen.findByRole("table", { name: TABLE_NAME });
    const monthInput = screen.getByLabelText("الشهر") as HTMLInputElement;
    expect(monthInput.value).toBe("2026-10");
    expect(screen.getByText("أكتوبر 2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "الشهر التالي" }));
    expect(nav.router.replace).toHaveBeenLastCalledWith("/workers/w-daily?tab=attendance&month=2026-11");

    fireEvent.click(screen.getByRole("button", { name: "الشهر السابق" }));
    expect(nav.router.replace).toHaveBeenLastCalledWith("/workers/w-daily?tab=attendance&month=2026-09");

    fireEvent.change(monthInput, { target: { value: "2026-07" } });
    expect(nav.router.replace).toHaveBeenLastCalledWith("/workers/w-daily?tab=attendance&month=2026-07");
    expect(nav.router.replace).toHaveBeenCalledTimes(3);
  });

  it("never asks a Field Manager's page for earnings and shows no money", async () => {
    renderAt("tab=attendance&month=2026-10", "FIELD_MANAGER");
    await screen.findByRole("table", { name: TABLE_NAME });
    expect(auth.client.getWorkerEstimatedEarnings).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "الأرباح التقديرية لهذا الشهر" })).toBeNull();
    expect(screen.queryByText("للمالك فقط")).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows an Owner the month's estimated earnings, marked Owner-only", async () => {
    renderAt("tab=attendance&month=2026-10", "OWNER");
    expect(await screen.findByText("₪ 490.00")).toBeTruthy();
    expect(auth.client.getWorkerEstimatedEarnings).toHaveBeenCalledTimes(1);
    expect(auth.client.getWorkerEstimatedEarnings).toHaveBeenCalledWith("w-daily", "2026-10");

    expect(screen.getByRole("heading", { name: "الأرباح التقديرية لهذا الشهر" })).toBeTruthy();
    expect(screen.getByText("للمالك فقط")).toBeTruthy();
    expect(rowValue("حضور معتمد (1)")).toBe("₪ 490.00");
    expect(rowValue("بانتظار الموافقة، تقديرًا (2)")).toBe("₪ 400.00");
    expect(rowValue("خصومات وتعديلات")).toBe("-₪ 10.00");
    expect(rowValue("الإجمالي التقديري")).toBe("₪ 880.00");
    expect(screen.getByText("₪ 880.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("دوام جارٍ واحد لم يُحتسب بعد.")).toBeTruthy();

    // The attendance list itself still carries no money.
    expect(within(await screen.findByRole("table", { name: TABLE_NAME })).queryByText(/₪/)).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("says when the month has no attendance", async () => {
    auth.client.listAttendanceEntries.mockResolvedValue(listPage([]));
    renderAt("tab=attendance&month=2026-10");
    expect(await screen.findByText("لا توجد سجلات حضور في هذا الشهر")).toBeTruthy();
    expect(screen.getByText("اختر شهرًا آخر.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    auth.client.listAttendanceEntries.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderAt("tab=attendance&month=2026-10");
    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("table", { name: TABLE_NAME })).toBeTruthy();
    await waitFor(() => expect(auth.client.listAttendanceEntries).toHaveBeenCalledTimes(2));
  });
});
