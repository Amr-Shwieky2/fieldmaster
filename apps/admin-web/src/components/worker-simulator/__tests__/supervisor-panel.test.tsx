import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import type { FieldMasterClient, MyTemporarySupervision, SupervisedShift } from "@fieldmaster/api-client";
import { renderWithIntl, createIntlWrapper, createTestQueryClient } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { SupervisorPanel } from "../supervisor-panel";

// ── The simulated worker's own API client ───────────────────────────────
const client = {
  myTemporarySupervisions: vi.fn(),
  getSupervisedShift: vi.fn(),
  reportSupervisorIssue: vi.fn(),
  closeTemporaryCheckInPoint: vi.fn(),
};

// ── Test data (times are UTC; in Asia/Jerusalem, IDT = UTC+3, 04:00Z reads 07:00) ──
const SUPERVISION: MyTemporarySupervision = {
  id: "ta-1",
  activatedAt: "2026-10-12T04:00:00.000Z",
  expiresAt: "2026-10-12T13:00:00.000Z",
  canOpenCheckInPoints: true,
  shift: {
    id: "s-1",
    title: "تنظيم حركة المرور صباحًا",
    shiftType: "STANDARD",
    scheduledStart: "2026-10-12T04:00:00.000Z",
    scheduledEnd: "2026-10-12T13:00:00.000Z",
    siteName: "تقاطع الشمال",
  },
};

/** An emergency call-out the same worker supervises later that day (the API's placeholder title). */
const CALLOUT_SUPERVISION: MyTemporarySupervision = {
  id: "ta-2",
  activatedAt: "2026-10-12T17:00:00.000Z",
  expiresAt: "2026-10-12T20:00:00.000Z",
  canOpenCheckInPoints: false,
  shift: {
    id: "s-2",
    title: "Emergency Call-out",
    shiftType: "EMERGENCY_CALLOUT",
    scheduledStart: "2026-10-12T17:00:00.000Z",
    scheduledEnd: "2026-10-12T20:00:00.000Z",
    siteName: null,
  },
};

const SHIFT_VIEW: SupervisedShift = {
  assignment: { id: "ta-1", activatedAt: SUPERVISION.activatedAt, expiresAt: SUPERVISION.expiresAt, canOpenCheckInPoints: true },
  shift: {
    id: "s-1",
    title: "تنظيم حركة المرور صباحًا",
    shiftType: "STANDARD",
    status: "ACTIVE",
    scheduledStart: "2026-10-12T04:00:00.000Z",
    scheduledEnd: "2026-10-12T13:00:00.000Z",
    businessDate: "2026-10-12",
    checkInMethod: "GEOFENCED",
    projectName: "مشروع أيالون",
    site: { name: "تقاطع الشمال", latitude: 32.0853, longitude: 34.7818 },
    geofence: { centerLatitude: 32.0853, centerLongitude: 34.7818, radiusMeters: 150 },
  },
  workers: [
    {
      workerProfileId: "wp-1",
      fullLegalName: "خالد ناصر",
      presence: "CLOCKED_IN",
      clockInAt: "2026-10-12T04:02:00.000Z",
      clockOutAt: null,
      locationOutcome: "PASSED",
      flags: [],
    },
    {
      workerProfileId: "wp-2",
      fullLegalName: "محمود جبارين",
      presence: "CLOCKED_OUT",
      clockInAt: "2026-10-12T04:10:00.000Z",
      clockOutAt: "2026-10-12T12:30:00.000Z",
      locationOutcome: "FLAGGED",
      flags: ["OFFLINE", "SUSPICIOUS_LOCATION"],
    },
    { workerProfileId: "wp-3", fullLegalName: "سامي عودة", presence: "NOT_CLOCKED_IN", clockInAt: null, clockOutAt: null, locationOutcome: null, flags: [] },
  ],
  temporaryCheckInPoints: [
    {
      id: "tp-1",
      name: "مدخل النفق",
      latitude: 32.086,
      longitude: 34.782,
      radiusMeters: 75,
      expiresAt: "2026-10-12T13:00:00.000Z",
      createdAt: "2026-10-12T05:00:00.000Z",
    },
  ],
};

const CALLOUT_VIEW: SupervisedShift = {
  ...SHIFT_VIEW,
  assignment: { id: "ta-2", activatedAt: CALLOUT_SUPERVISION.activatedAt, expiresAt: CALLOUT_SUPERVISION.expiresAt, canOpenCheckInPoints: false },
  shift: { ...SHIFT_VIEW.shift, id: "s-2", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" },
  workers: [SHIFT_VIEW.workers[0]],
};

const CLOSED_POINT = {
  id: "tp-1",
  shiftId: "s-1",
  name: "مدخل النفق",
  latitude: 32.086,
  longitude: 34.782,
  radiusMeters: 75,
  status: "REVOKED",
  expiresAt: "2026-10-12T13:00:00.000Z",
  revokedAt: "2026-10-12T06:00:00.000Z",
};

const INACTIVE = "صلاحية المشرف المؤقت غير نشطة الآن: لم تبدأ بعد، أو انتهت، أو أُلغيت، أو أُغلقت الوردية.";
const ISSUE_REQUIRED = "اكتب البلاغ قبل الإرسال.";
const ISSUE_HINT = "يصل إلى مدير الوردية والمالكين، ويُسجَّل في سجل التدقيق.";

// ── Helpers ─────────────────────────────────────────────────────────────
let simulatorQueryClient: QueryClient;
let adminQueryClient: QueryClient;

/**
 * Renders the panel as the simulator does: the worker's own client and QueryClient as props,
 * inside the admin's providers (whose QueryClient must stay separate from the worker's).
 */
function renderPanel() {
  const onLog = vi.fn();
  simulatorQueryClient = createTestQueryClient();
  adminQueryClient = createTestQueryClient();
  renderWithIntl(<SupervisorPanel client={client as unknown as FieldMasterClient} queryClient={simulatorQueryClient} memberKey="m-w1" onLog={onLog} />, {
    queryClient: adminQueryClient,
  });
  return { onLog };
}

/** Matches the innermost element whose whole text (nested elements included) is exactly `text`. */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text);
}

function rowOf(name: string): HTMLElement[] {
  const row = within(screen.getByRole("table", { name: "عمال الوردية وحضورهم" }))
    .getByText(name)
    .closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row).getAllByRole("cell");
}

const issueBox = () => screen.getByLabelText("بلاغ إلى الإدارة") as HTMLTextAreaElement;
const sendIssue = () => fireEvent.click(screen.getByRole("button", { name: "إرسال البلاغ" }));

/** The success notice region of the panel (the only status region once everything has loaded). */
function noticeText() {
  return screen.getAllByRole("status").map((region) => region.textContent);
}

beforeEach(() => {
  vi.resetAllMocks();
  client.myTemporarySupervisions.mockResolvedValue([SUPERVISION]);
  client.getSupervisedShift.mockResolvedValue(SHIFT_VIEW);
  client.reportSupervisorIssue.mockResolvedValue({ reportedAt: "2026-10-12T06:00:00.000Z", notifiedCount: 2 });
  client.closeTemporaryCheckInPoint.mockResolvedValue(CLOSED_POINT);
});

describe("SupervisorPanel", () => {
  it("loads the worker's active supervisions", () => {
    client.myTemporarySupervisions.mockReturnValue(new Promise(() => {}));
    renderPanel();

    expect(screen.getByRole("heading", { name: "مشرف مؤقت" })).toBeTruthy();
    expect(screen.getByText("جارٍ التحميل…").closest('[role="status"]')).toBeTruthy();
    expect(client.myTemporarySupervisions).toHaveBeenCalledTimes(1);
    expect(client.getSupervisedShift).not.toHaveBeenCalled();
  });

  it("says the worker is not an active temporary supervisor when there is no active assignment", async () => {
    client.myTemporarySupervisions.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText("هذا العامل ليس مشرفًا مؤقتًا نشطًا الآن.")).toBeTruthy();
    expect(client.getSupervisedShift).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByLabelText("بلاغ إلى الإدارة")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows the supervised shift: the window, each worker's presence, times, location outcome and flags, and the active points", async () => {
    renderPanel();

    const table = await screen.findByRole("table", { name: "عمال الوردية وحضورهم" });
    expect(client.getSupervisedShift).toHaveBeenCalledTimes(1);
    expect(client.getSupervisedShift).toHaveBeenCalledWith("ta-1");
    // A single assignment needs no picker.
    expect(screen.queryByRole("combobox", { name: "الوردية المشرف عليها" })).toBeNull();

    expect(screen.getByText("تنظيم حركة المرور صباحًا").tagName).toBe("BDI");
    expect(screen.getByText(fullText("الإشراف من 12 أكتوبر 2026 في 07:00 إلى 12 أكتوبر 2026 في 16:00"))).toBeTruthy();
    expect(screen.getByText("مسموح بفتح نقاط التسجيل المؤقتة وإغلاقها.")).toBeTruthy();

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["العامل", "الحالة", "الأوقات", "نتيجة فحص الموقع", "العلامات"]);
    expect(rowOf("خالد ناصر").map((cell) => cell.textContent)).toEqual(["خالد ناصر", "في الدوام", "07:02 – جارٍ", "سليم", ""]);
    expect(rowOf("محمود جبارين").map((cell) => cell.textContent)).toEqual([
      "محمود جبارين",
      "أنهى الدوام",
      "07:10 – 15:30",
      "مُعلَّم للمراجعة",
      "تسجيل دون اتصالموقع وهمي أو مشبوه",
    ]);
    expect(rowOf("سامي عودة").map((cell) => cell.textContent)).toEqual(["سامي عودة", "لم يبدأ الدوام", "لم يبدأ", "لا يوجد", ""]);
    // Times read left to right; each flag is its own badge.
    expect(within(rowOf("محمود جبارين")[2]).getByText("15:30").getAttribute("dir")).toBe("ltr");
    expect(within(rowOf("محمود جبارين")[4]).getByText("تسجيل دون اتصال")).toBeTruthy();
    expect(within(rowOf("محمود جبارين")[4]).getByText("موقع وهمي أو مشبوه")).toBeTruthy();

    expect(screen.getByText("نقاط التسجيل المؤقتة النشطة")).toBeTruthy();
    const point = screen.getByText("«مدخل النفق»، نصف القطر 75 م").closest("li");
    expect(point && within(point).getByRole("button", { name: "إغلاق النقطة" })).toBeTruthy();
    expect(screen.getByText("لفتح نقطة: اختر الوردية واضغط «فتح نقطة تسجيل مؤقتة» في لوحة الإجراءات، ثم انقر على الخريطة.")).toBeTruthy();
    expect(screen.getByText(ISSUE_HINT)).toBeTruthy();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
    expect(document.body.textContent).not.toContain("₪");
  });

  it("keeps the worker's queries in the simulator's own QueryClient, never the admin's", async () => {
    renderPanel();
    await screen.findByRole("table");

    expect(simulatorQueryClient.getQueryData(["sim", "m-w1", "supervisions"])).toEqual([SUPERVISION]);
    expect(simulatorQueryClient.getQueryData(["sim", "m-w1", "supervised", "ta-1"])).toEqual(SHIFT_VIEW);
    expect(adminQueryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  // Regression: the issue report and the point closing used the admin's QueryClient (from the provider), so the
  // worker's issue text, the point id and both API responses landed in the admin's mutation cache.
  it("keeps the worker's mutations in the simulator's own QueryClient, never the admin's", async () => {
    renderPanel();
    await screen.findByRole("table");

    fireEvent.change(issueBox(), { target: { value: "نقص في الأقماع المرورية" } });
    sendIssue();
    await screen.findByText("أُرسل البلاغ إلى شخصين.");
    fireEvent.click(screen.getByRole("button", { name: "إغلاق النقطة" }));
    await screen.findByText("أُغلقت النقطة «مدخل النفق».");

    expect(adminQueryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(
      simulatorQueryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.variables),
    ).toEqual(["نقص في الأقماع المرورية", "tp-1"]);
  });

  // Regression: without the admin's QueryClientProvider above it, the panel threw "No QueryClient set".
  it("works with only the simulator's QueryClient, without the admin's provider", async () => {
    simulatorQueryClient = createTestQueryClient();
    const onLog = vi.fn();
    expect(() =>
      render(<SupervisorPanel client={client as unknown as FieldMasterClient} queryClient={simulatorQueryClient} memberKey="m-w1" onLog={onLog} />, {
        wrapper: createIntlWrapper(),
      }),
    ).not.toThrow();

    await screen.findByRole("table", { name: "عمال الوردية وحضورهم" });
    fireEvent.change(issueBox(), { target: { value: "نقص في الأقماع المرورية" } });
    sendIssue();
    expect(await screen.findByText("أُرسل البلاغ إلى شخصين.")).toBeTruthy();
    expect(client.reportSupervisorIssue).toHaveBeenCalledWith("ta-1", "نقص في الأقماع المرورية");
    expect(onLog).toHaveBeenCalledWith({ action: "supervisorReport", outcome: "success" });
    expect(simulatorQueryClient.getMutationCache().getAll()).toHaveLength(1);
  });

  it("without permission to manage points lists them without a close button", async () => {
    client.getSupervisedShift.mockResolvedValue({ ...SHIFT_VIEW, assignment: { ...SHIFT_VIEW.assignment, canOpenCheckInPoints: false } });
    renderPanel();

    expect(await screen.findByText("غير مسموح بفتح نقاط تسجيل مؤقتة.")).toBeTruthy();
    expect(screen.getByText("«مدخل النفق»، نصف القطر 75 م")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "إغلاق النقطة" })).toBeNull();
  });

  it("closes a temporary point, says so, logs it and reloads the shift", async () => {
    client.getSupervisedShift.mockResolvedValueOnce(SHIFT_VIEW).mockResolvedValue({ ...SHIFT_VIEW, temporaryCheckInPoints: [] });
    const { onLog } = renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "إغلاق النقطة" }));

    const notice = await screen.findByText("أُغلقت النقطة «مدخل النفق».");
    expect(notice.closest('[role="status"]')).toBeTruthy();
    expect(client.closeTemporaryCheckInPoint).toHaveBeenCalledTimes(1);
    expect(client.closeTemporaryCheckInPoint).toHaveBeenCalledWith("tp-1");
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith({ action: "closePoint", params: { name: "مدخل النفق" }, outcome: "success" });
    await waitFor(() => expect(client.getSupervisedShift).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("لا توجد نقاط تسجيل مؤقتة نشطة.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "إغلاق النقطة" })).toBeNull();
  });

  it("shows a refused point closing in Arabic and logs the error", async () => {
    client.closeTemporaryCheckInPoint.mockRejectedValue(apiError(403, "TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS", "Not allowed to manage points."));
    const { onLog } = renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "إغلاق النقطة" }));

    const message = "لا يملك هذا المشرف المؤقت صلاحية فتح نقاط التسجيل المؤقتة أو إغلاقها.";
    const alert = await screen.findByText(message);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("Not allowed to manage points.")).toBeNull();
    expect(screen.queryByText("غير مصرّح بالوصول")).toBeNull();
    expect(onLog).toHaveBeenCalledWith({ action: "closePoint", outcome: "error", message });
    expect(screen.getByText("«مدخل النفق»، نصف القطر 75 م")).toBeTruthy();
  });

  it("refuses a blank issue report without sending it", async () => {
    const { onLog } = renderPanel();
    await screen.findByRole("table");

    expect(issueBox().getAttribute("aria-describedby")).toBe(screen.getByText(ISSUE_HINT).id);
    sendIssue();
    const error = screen.getByText(ISSUE_REQUIRED);
    expect(error.getAttribute("role")).toBe("alert");
    expect(issueBox().getAttribute("aria-invalid")).toBe("true");
    expect(issueBox().getAttribute("aria-describedby")).toBe(error.id);
    expect(screen.queryByText(ISSUE_HINT)).toBeNull();

    // Typing clears the error; spaces only are still blank.
    fireEvent.change(issueBox(), { target: { value: "  \n " } });
    expect(screen.queryByText(ISSUE_REQUIRED)).toBeNull();
    expect(issueBox().getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText(ISSUE_HINT)).toBeTruthy();
    sendIssue();
    expect(screen.getByText(ISSUE_REQUIRED)).toBeTruthy();
    expect(client.reportSupervisorIssue).not.toHaveBeenCalled();
    expect(onLog).not.toHaveBeenCalled();
  });

  it("sends the issue report, clears the box, says it is being sent and logs it", async () => {
    let finish: (value: unknown) => void = () => {};
    client.reportSupervisorIssue.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { onLog } = renderPanel();
    await screen.findByRole("table");

    fireEvent.change(issueBox(), { target: { value: "  إشارة المرور عند المدخل الشمالي معطّلة.  " } });
    sendIssue();

    const pending = (await screen.findByRole("button", { name: "جارٍ الإرسال…" })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(client.reportSupervisorIssue).toHaveBeenCalledTimes(1);
    expect(client.reportSupervisorIssue).toHaveBeenCalledWith("ta-1", "إشارة المرور عند المدخل الشمالي معطّلة.");

    finish({ reportedAt: "2026-10-12T06:00:00.000Z", notifiedCount: 2 });
    const notice = await screen.findByText("أُرسل البلاغ إلى شخصين.");
    expect(notice.closest('[role="status"]')).toBeTruthy();
    expect(issueBox().value).toBe("");
    expect(screen.getByRole("button", { name: "إرسال البلاغ" })).toBeTruthy();
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith({ action: "supervisorReport", outcome: "success" });
  });

  it.each([
    [0, "أُرسل البلاغ، ولم يصل إلى أحد حسب إعدادات الإشعارات."],
    [1, "أُرسل البلاغ إلى شخص واحد."],
    [2, "أُرسل البلاغ إلى شخصين."],
    [3, "أُرسل البلاغ إلى 3 أشخاص."],
    [10, "أُرسل البلاغ إلى 10 أشخاص."],
    [11, "أُرسل البلاغ إلى 11 شخصًا."],
  ])("says the report reached %i people with the Arabic plural", async (notifiedCount, text) => {
    client.reportSupervisorIssue.mockResolvedValue({ reportedAt: "2026-10-12T06:00:00.000Z", notifiedCount });
    renderPanel();
    await screen.findByRole("table");

    fireEvent.change(issueBox(), { target: { value: "نقص في الأقماع المرورية" } });
    sendIssue();

    expect(await screen.findByText(text)).toBeTruthy();
    expect(noticeText()).toEqual([text]);
    expect(hasArabicIndicDigits(text)).toBe(false);
  });

  it("shows a 403 TEMPORARY_SUPERVISOR_INACTIVE on the supervised shift as the Arabic error, not the access-denied page", async () => {
    client.getSupervisedShift.mockRejectedValue(apiError(403, "TEMPORARY_SUPERVISOR_INACTIVE", "This temporary supervisor assignment is not active."));
    renderPanel();

    const alert = await screen.findByText(INACTIVE);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("This temporary supervisor assignment is not active.")).toBeNull();
    expect(screen.queryByText("غير مصرّح بالوصول")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByLabelText("بلاغ إلى الإدارة")).toBeNull();
  });

  it("shows a report refused because the supervision ended in Arabic, keeps the text and logs the error", async () => {
    client.reportSupervisorIssue.mockRejectedValue(apiError(403, "TEMPORARY_SUPERVISOR_INACTIVE", "This temporary supervisor assignment is not active."));
    const { onLog } = renderPanel();
    await screen.findByRole("table");

    fireEvent.change(issueBox(), { target: { value: "نقص في الأقماع المرورية" } });
    sendIssue();

    const alert = await screen.findByText(INACTIVE);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("This temporary supervisor assignment is not active.")).toBeNull();
    expect(issueBox().value).toBe("نقص في الأقماع المرورية");
    expect(noticeText()).toEqual([""]);
    expect(onLog).toHaveBeenCalledWith({ action: "supervisorReport", outcome: "error", message: INACTIVE });
  });

  it("with several assignments, shows the first and switches to the one picked", async () => {
    client.myTemporarySupervisions.mockResolvedValue([SUPERVISION, CALLOUT_SUPERVISION]);
    client.getSupervisedShift.mockImplementation(async (id: string) => (id === "ta-2" ? CALLOUT_VIEW : SHIFT_VIEW));
    renderPanel();

    const picker = (await screen.findByRole("combobox", { name: "الوردية المشرف عليها" })) as HTMLSelectElement;
    // The call-out's placeholder title is shown as its Arabic shift type.
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["تنظيم حركة المرور صباحًا", "استدعاء طوارئ"]);
    await screen.findByRole("table");
    expect(picker.value).toBe("ta-1");
    expect(client.getSupervisedShift).toHaveBeenLastCalledWith("ta-1");

    fireEvent.change(picker, { target: { value: "ta-2" } });
    expect(await screen.findByText("غير مسموح بفتح نقاط تسجيل مؤقتة.")).toBeTruthy();
    expect(client.getSupervisedShift).toHaveBeenLastCalledWith("ta-2");
    expect(screen.getByText("استدعاء طوارئ", { selector: "bdi" })).toBeTruthy();
    expect(screen.getByText(fullText("الإشراف من 12 أكتوبر 2026 في 20:00 إلى 12 أكتوبر 2026 في 23:00"))).toBeTruthy();
    expect(screen.queryByText("Emergency Call-out")).toBeNull();

    // A report goes to the picked assignment.
    fireEvent.change(issueBox(), { target: { value: "تأخر وصول المعدات" } });
    sendIssue();
    await waitFor(() => expect(client.reportSupervisorIssue).toHaveBeenCalledWith("ta-2", "تأخر وصول المعدات"));
  });

  it("refreshes the assignments and the shift and logs the view", async () => {
    const { onLog } = renderPanel();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));

    await waitFor(() => expect(onLog).toHaveBeenCalledTimes(1));
    expect(onLog).toHaveBeenCalledWith({ action: "supervisorView", outcome: "success" });
    expect(client.myTemporarySupervisions).toHaveBeenCalledTimes(2);
    expect(client.getSupervisedShift).toHaveBeenCalledTimes(2);
    expect(client.getSupervisedShift).toHaveBeenLastCalledWith("ta-1");
  });

  it("logs a refresh refused because the supervision is no longer active", async () => {
    client.getSupervisedShift
      .mockResolvedValueOnce(SHIFT_VIEW)
      .mockRejectedValue(apiError(403, "TEMPORARY_SUPERVISOR_INACTIVE", "This temporary supervisor assignment is not active."));
    const { onLog } = renderPanel();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));

    await waitFor(() => expect(onLog).toHaveBeenCalledTimes(1));
    expect(onLog).toHaveBeenCalledWith({ action: "supervisorView", outcome: "error", message: INACTIVE });
    expect((await screen.findByText(INACTIVE)).getAttribute("role")).toBe("alert");
  });
});
