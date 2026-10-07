import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type ApiError, type TimeEntry, type Worker } from "@fieldmaster/api-client";
import type { Locale } from "@/i18n/config";
import { renderWithIntl } from "@/test/render-with-intl";
import AttendancePage from "../page";

// ── API mock ────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listPendingAttendanceApprovals: vi.fn(),
  listWorkers: vi.fn(),
  approveTimeEntry: vi.fn(),
  rejectTimeEntry: vi.fn(),
  applyFullDayCredit: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client }) }));

function apiError(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  const body: ApiError = { statusCode: status, code, message, details, correlationId: "corr-1" };
  return new ApiRequestError(status, body);
}

const WORKERS = [
  {
    id: "wp-1",
    fullLegalName: "Eli Ramzani",
    // Owners receive compensation with the worker list; the attendance page must never show it.
    compensation: { compensationType: "DAILY", dailyBaseRateAgorot: 45000, baseHourlyRateAgorot: null, overtimeHourlyRateAgorot: 7000, effectiveStartDate: "2026-01-01" },
  },
  { id: "wp-2", fullLegalName: "Samir Haddad", compensation: null },
] as unknown as Worker[];

const SHORT_SHIFT = {
  id: "te-1",
  organizationId: "org-1",
  workerProfileId: "wp-1",
  shiftId: "s-1",
  status: "PENDING_APPROVAL",
  businessDate: "2026-10-04",
  clockInAt: "2026-10-04T04:00:00.000Z", // 07:00 in Asia/Jerusalem (IDT)
  clockOutAt: "2026-10-04T12:00:00.000Z", // 15:00
  rawDurationMinutes: 480,
  approvedRegularMinutes: null,
  approvedOvertimeMinutes: null,
  fullDayCredit: false,
  shift: { title: "Ayalon road works" },
  dailySummary: { text: "Installed 12 traffic signs", taskCategory: "TRAFFIC_SIGN" },
} as unknown as TimeEntry;

const CREDITED_SHIFT = {
  ...SHORT_SHIFT,
  id: "te-2",
  workerProfileId: "wp-2",
  rawDurationMinutes: 300,
  fullDayCredit: true,
  shift: { title: "Night signal repair" },
  dailySummary: null,
} as unknown as TimeEntry;

function renderPage(locale: Locale = "ar") {
  return renderWithIntl(<AttendancePage />, { locale, queryClient: true });
}

function cardOf(workerName: string): HTMLElement {
  const item = screen.getByText(workerName).closest("li");
  if (!item) throw new Error(`no card for ${workerName}`);
  return item;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.listPendingAttendanceApprovals.mockResolvedValue([SHORT_SHIFT, CREDITED_SHIFT]);
  client.listWorkers.mockResolvedValue(WORKERS);
  client.approveTimeEntry.mockResolvedValue({});
  client.rejectTimeEntry.mockResolvedValue({});
  client.applyFullDayCredit.mockResolvedValue({});
});

describe("Attendance approval page", () => {
  it("renders the pending shifts in Arabic with Western digits and no money", async () => {
    renderPage("ar");
    expect(screen.getByRole("heading", { level: 1, name: "الموافقة على الحضور" })).toBeTruthy();
    await screen.findByText("Eli Ramzani");

    expect(screen.getByText("ورديتان بانتظار الموافقة")).toBeTruthy();
    const card = within(cardOf("Eli Ramzani"));
    expect(card.getByText("بدء الدوام")).toBeTruthy();
    expect(card.getByText("إنهاء الدوام")).toBeTruthy();
    expect(card.getByText("8 س 0 د")).toBeTruthy();
    expect(card.getByText(/07:00/)).toBeTruthy();
    expect(card.getByText("ملخص العمل اليومي")).toBeTruthy();
    expect(card.getByText("Installed 12 traffic signs").getAttribute("dir")).toBe("auto");
    expect(card.getByRole("button", { name: "موافقة" })).toBeTruthy();
    expect(card.getByRole("button", { name: "رفض" })).toBeTruthy();
    expect(card.getByRole("button", { name: "احتساب يوم كامل" })).toBeTruthy();

    // Already credited: badge shown, the credit action is not offered again.
    const credited = within(cardOf("Samir Haddad"));
    expect(credited.getByText("تم احتساب يوم كامل")).toBeTruthy();
    expect(credited.queryByRole("button", { name: "احتساب يوم كامل" })).toBeNull();

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
    expect(text).not.toContain("₪");
    expect(text).not.toContain("450");
  });

  it("renders in English", async () => {
    renderPage("en");
    expect(screen.getByRole("heading", { level: 1, name: "Attendance approval" })).toBeTruthy();
    await screen.findByText("Eli Ramzani");
    expect(screen.getByText("2 shifts pending approval")).toBeTruthy();
    const card = within(cardOf("Eli Ramzani"));
    expect(card.getByText("Clock in")).toBeTruthy();
    expect(card.getByText("Clock out")).toBeTruthy();
    expect(card.getByText("8h 0m")).toBeTruthy();
    expect(card.getByText("Daily summary")).toBeTruthy();
    expect(card.getByRole("button", { name: "Credit as Full Day" })).toBeTruthy();
    expect(within(cardOf("Samir Haddad")).getByText("Credited as Full Day")).toBeTruthy();
  });

  it("shows the page-specific empty state", async () => {
    client.listPendingAttendanceApprovals.mockResolvedValue([]);
    renderPage("ar");
    expect(await screen.findByText("لا توجد ورديات بانتظار الموافقة")).toBeTruthy();
    expect(screen.getByText("تمت مراجعة كل الورديات المسجّلة.")).toBeTruthy();
  });

  it("shows a translated error with a working retry", async () => {
    client.listPendingAttendanceApprovals.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderPage("ar");
    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("Eli Ramzani")).toBeTruthy();
    expect(client.listPendingAttendanceApprovals).toHaveBeenCalledTimes(2);
  });

  it("shows access denied when the API answers 403", async () => {
    client.listPendingAttendanceApprovals.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden"));
    renderPage("ar");
    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.queryByText("Eli Ramzani")).toBeNull();
  });

  it("approves a shift and announces it", async () => {
    renderPage("ar");
    await screen.findByText("Eli Ramzani");
    fireEvent.click(within(cardOf("Eli Ramzani")).getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(client.approveTimeEntry).toHaveBeenCalledWith("te-1"));
    expect(await screen.findByText("تمت الموافقة على وردية Eli Ramzani.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("تمت الموافقة على وردية Eli Ramzani.");
  });

  it("asks for a reason before rejecting and sends the reason the manager wrote", async () => {
    renderPage("ar");
    await screen.findByText("Eli Ramzani");
    const card = within(cardOf("Eli Ramzani"));
    fireEvent.click(card.getByRole("button", { name: "رفض" }));

    const reason = card.getByLabelText("سبب الرفض") as HTMLTextAreaElement;
    expect(reason.value).toBe("تم الرفض بعد المراجعة.");
    expect(card.getByText("سيصل هذا السبب إلى العامل في إشعار.")).toBeTruthy();

    fireEvent.change(reason, { target: { value: "   " } });
    fireEvent.click(card.getByRole("button", { name: "تأكيد الرفض" }));
    expect(card.getByText("اكتب السبب قبل المتابعة.")).toBeTruthy();
    expect(client.rejectTimeEntry).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "ساعات الخروج غير صحيحة" } });
    fireEvent.click(card.getByRole("button", { name: "تأكيد الرفض" }));
    await waitFor(() => expect(client.rejectTimeEntry).toHaveBeenCalledWith("te-1", "ساعات الخروج غير صحيحة"));
    expect(await screen.findByText("تم رفض وردية Eli Ramzani.")).toBeTruthy();
  });

  it("can close the reason prompt without sending anything", async () => {
    renderPage("en");
    await screen.findByText("Eli Ramzani");
    const card = within(cardOf("Eli Ramzani"));
    fireEvent.click(card.getByRole("button", { name: "Reject" }));
    expect(card.getByLabelText("Reason for rejection")).toBeTruthy();
    fireEvent.click(card.getByRole("button", { name: "Cancel" }));
    expect(card.queryByLabelText("Reason for rejection")).toBeNull();
    expect(client.rejectTimeEntry).not.toHaveBeenCalled();
  });

  it("applies Credit as Full Day with the default reason in English", async () => {
    renderPage("en");
    await screen.findByText("Eli Ramzani");
    const card = within(cardOf("Eli Ramzani"));
    fireEvent.click(card.getByRole("button", { name: "Credit as Full Day" }));
    expect((card.getByLabelText("Reason for Credit as Full Day") as HTMLTextAreaElement).value).toBe("Weather stopped work");
    fireEvent.click(card.getByRole("button", { name: "Confirm Credit as Full Day" }));
    await waitFor(() => expect(client.applyFullDayCredit).toHaveBeenCalledWith("te-1", "Weather stopped work"));
    expect(await screen.findByText("Credit as Full Day applied to the shift of Eli Ramzani.")).toBeTruthy();
  });

  it("shows the translated PAYROLL_PERIOD_FINALIZED message, not the API's English text", async () => {
    client.applyFullDayCredit.mockRejectedValue(apiError(409, "PAYROLL_PERIOD_FINALIZED", "The payroll period for this date is finalized."));
    renderPage("ar");
    await screen.findByText("Eli Ramzani");
    const card = within(cardOf("Eli Ramzani"));
    fireEvent.click(card.getByRole("button", { name: "احتساب يوم كامل" }));
    expect((card.getByLabelText("سبب احتساب يوم كامل") as HTMLTextAreaElement).value).toBe("توقّف العمل بسبب الطقس");
    fireEvent.click(card.getByRole("button", { name: "تأكيد احتساب يوم كامل" }));

    const alert = await card.findByText("فترة الرواتب هذه مُقفلة. أعد فتحها لإجراء التعديلات.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("The payroll period for this date is finalized.")).toBeNull();
    // The prompt stays open so the manager can cancel or try again.
    expect(card.getByLabelText("سبب احتساب يوم كامل")).toBeTruthy();
  });

  it("shows a pending label and disables the card's actions while approving", async () => {
    let resolve: (value: unknown) => void = () => {};
    client.approveTimeEntry.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage("ar");
    await screen.findByText("Eli Ramzani");
    const card = within(cardOf("Eli Ramzani"));
    fireEvent.click(card.getByRole("button", { name: "موافقة" }));

    const pending = await card.findByRole("button", { name: "جارٍ الموافقة…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect((card.getByRole("button", { name: "رفض" }) as HTMLButtonElement).disabled).toBe(true);
    resolve({});
    expect(await screen.findByText("تمت الموافقة على وردية Eli Ramzani.")).toBeTruthy();
  });
});
