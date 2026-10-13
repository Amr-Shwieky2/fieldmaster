import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Shift, Worker } from "@fieldmaster/api-client";
import { formatMinutes, formatMonth } from "@fieldmaster/i18n";
import { rawDurationMinutes, splitWorkedMinutes, toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { renderWithIntl } from "@/test/render-with-intl";
import { EVIDENCE, apiError, hasArabicIndicDigits, infractions } from "@/test/attendance-fixtures";
import { CorrectionDialog, type CorrectionEntry } from "../correction-dialog";

// Business times are Asia/Jerusalem whatever the browser's zone. Run in another zone so that reading
// the input as local time could not pass by accident on a machine that is itself set to Jerusalem.
const machineTimeZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (machineTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = machineTimeZone;
});

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  createManualCorrection: vi.fn(),
  listForgottenStampInfractions: vi.fn(),
  listWorkers: vi.fn(),
  listShifts: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "FIELD_MANAGER" as "OWNER" | "FIELD_MANAGER" }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

// ── Test data ───────────────────────────────────────────────────────────
/** The detail page's entry (te-1, clock-in 07:00 in Jerusalem), here ended at 15:00 after 8 hours. */
const ENDED: CorrectionEntry = {
  id: EVIDENCE.id,
  workerProfileId: EVIDENCE.worker.id,
  workerName: EVIDENCE.worker.fullLegalName,
  status: EVIDENCE.status,
  clockInAt: EVIDENCE.clockInAt, // 2026-10-04T04:00Z = 07:00 IDT
  clockOutAt: "2026-10-04T12:00:00.000Z", // 15:00 IDT
  rawDurationMinutes: 480,
  unpaidBreakMinutes: EVIDENCE.duration.unpaidBreakMinutes,
  fullDayCredit: EVIDENCE.fullDayCredit.applied,
};

/** The same entry while the worker is still on shift (no clock-out yet). */
const OPEN: CorrectionEntry = { ...ENDED, status: "ACTIVE", clockOutAt: null, rawDurationMinutes: null };

function worker(id: string, fullLegalName: string): Worker {
  return {
    id,
    organizationId: "org-1",
    fullLegalName,
    preferredName: null,
    phoneNumber: "+972500010001",
    accountStatus: "ACTIVE",
    role: "WORKER",
    createdAt: "2026-01-10T08:30:00.000Z",
  };
}

function shift(fields: Pick<Shift, "id" | "title" | "businessDate" | "scheduledStart" | "scheduledEnd"> & Partial<Shift>): Shift {
  return {
    organizationId: "org-1",
    projectId: "p-1",
    siteId: "site-1",
    geofenceId: "g-1",
    shiftType: "STANDARD",
    checkInMethod: "GEOFENCED",
    status: "PUBLISHED",
    managerId: "u-fm",
    assignments: [],
    ...fields,
  };
}

const WORKERS: Worker[] = [worker("wp-1", "خالد ناصر"), worker("wp-2", "محمود جبارين"), worker("wp-3", "سامي عودة")];

const SHIFTS: Shift[] = [
  shift({
    id: "s-1",
    title: "تنظيم حركة المرور صباحًا",
    businessDate: "2026-10-04",
    scheduledStart: "2026-10-04T04:00:00.000Z", // 07:00 IDT
    scheduledEnd: "2026-10-04T13:00:00.000Z",
    assignments: [{ id: "as-1", workerProfileId: "wp-1" }],
  }),
  shift({
    id: "s-night",
    title: "صيانة الإشارات ليلًا",
    businessDate: "2026-09-01",
    scheduledStart: "2026-08-31T22:30:00.000Z", // 01:30 IDT on 1 September (still 31 August in UTC)
    scheduledEnd: "2026-09-01T06:00:00.000Z",
    assignments: [{ id: "as-2", workerProfileId: "wp-1" }],
  }),
  shift({
    id: "s-other",
    title: "تركيب لافتات",
    businessDate: "2026-10-04",
    scheduledStart: "2026-10-04T05:00:00.000Z",
    scheduledEnd: "2026-10-04T14:00:00.000Z",
    assignments: [{ id: "as-3", workerProfileId: "wp-2" }],
  }),
  // An emergency call-out shift is never offered: a missing emergency clock-in is not added this way.
  shift({
    id: "s-emergency",
    title: "Emergency Call-out",
    shiftType: "EMERGENCY_CALLOUT",
    businessDate: "2026-10-04",
    scheduledStart: "2026-10-04T20:00:00.000Z",
    scheduledEnd: "2026-10-04T21:00:00.000Z",
    assignments: [{ id: "as-4", workerProfileId: "wp-1" }],
  }),
];

// ── Helpers ─────────────────────────────────────────────────────────────
function renderDialog(entry?: CorrectionEntry) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const { unmount } = renderWithIntl(<CorrectionDialog entry={entry} onClose={onClose} onSaved={onSaved} />, { queryClient: true });
  return { onClose, onSaved, unmount, dialog: screen.getByRole("dialog") };
}

/**
 * Submits a valid clock-out correction whose save stays pending until `finish` is called, and
 * waits until the dialog shows it is saving (with its effects flushed, so the key handler is current).
 */
async function startPendingSave() {
  let finish: (value: unknown) => void = () => {};
  client.createManualCorrection.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  chooseKind("تصحيح وقت إنهاء الدوام");
  setTime("2026-10-04T17:30");
  chooseReason("DEVICE_FAILURE");
  submit();
  await screen.findByRole("button", { name: "جارٍ الحفظ…" });
  await act(async () => {});
  return (value: unknown) => finish(value);
}

/** Presses Tab (or Shift+Tab) on `element`; true when the dialog took over (the browser's own move was prevented). */
function pressTab(element: Element, shiftKey = false): boolean {
  return !fireEvent.keyDown(element, { key: "Tab", shiftKey });
}

const timeInput = () => screen.getByLabelText("الوقت الجديد (توقيت القدس)") as HTMLInputElement;
const reasonSelect = () => screen.getByRole("combobox", { name: "السبب" }) as HTMLSelectElement;
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);

function chooseKind(name: string) {
  fireEvent.click(screen.getByRole("radio", { name }));
}
function setTime(value: string) {
  fireEvent.change(timeInput(), { target: { value } });
}
function chooseReason(value: string) {
  fireEvent.change(reasonSelect(), { target: { value } });
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "حفظ التصحيح" }));
}

/** Create mode: waits for the workers, then picks the worker and one of their shifts. */
async function pickWorkerAndShift(workerProfileId: string, shiftId: string) {
  const workerSelect = screen.getByRole("combobox", { name: "العامل" });
  await within(workerSelect).findByRole("option", { name: "خالد ناصر" });
  fireEvent.change(workerSelect, { target: { value: workerProfileId } });
  const shiftSelect = screen.getByRole("combobox", { name: "الوردية" });
  await waitFor(() => expect(within(shiftSelect).getAllByRole("option").length).toBeGreaterThan(1));
  fireEvent.change(shiftSelect, { target: { value: shiftId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "FIELD_MANAGER";
  client.createManualCorrection.mockResolvedValue({ timeEntry: { id: "te-1" }, correction: { id: "corr-2" } });
  client.listForgottenStampInfractions.mockResolvedValue([]);
  client.listWorkers.mockResolvedValue(WORKERS);
  client.listShifts.mockResolvedValue(SHIFTS);
});

describe("CorrectionDialog", () => {
  it("offers exactly the three corrections of an ended entry", () => {
    const { dialog } = renderDialog(ENDED);

    expect(screen.getByRole("dialog", { name: "تصحيح يدوي" })).toBe(dialog);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("خالد ناصر")).toBeTruthy();
    const kinds = within(within(dialog).getByRole("group", { name: "نوع التصحيح" })).getAllByRole("radio") as HTMLInputElement[];
    expect(kinds.map((radio) => radio.closest("label")?.textContent)).toEqual([
      "تصحيح وقت بدء الدوام",
      "تصحيح وقت إنهاء الدوام",
      "تصحيح دقائق الاستراحة غير المدفوعة",
    ]);
    expect(kinds[0].checked).toBe(true);
    expect(document.activeElement).toBe(kinds[0]);
    // Correcting the clock-in starts from the current clock-in, in Jerusalem wall time.
    expect(timeInput().value).toBe("2026-10-04T07:00");
    expect(within(dialog).getByText("الوقت الحالي:", { exact: false }).textContent).toBe("الوقت الحالي: 4 أكتوبر 2026 في 07:00");
    // Only create mode picks a worker and a shift.
    expect(within(dialog).queryByRole("combobox", { name: "العامل" })).toBeNull();
    expect(client.listWorkers).not.toHaveBeenCalled();
    expect(client.listShifts).not.toHaveBeenCalled();

    chooseKind("تصحيح دقائق الاستراحة غير المدفوعة");
    expect((within(dialog).getByLabelText("دقائق الاستراحة غير المدفوعة") as HTMLInputElement).value).toBe("0");
    expect(within(dialog).getByText("لا توجد استراحة مسجّلة الآن.")).toBeTruthy();
    expect(within(dialog).queryByLabelText("الوقت الجديد (توقيت القدس)")).toBeNull();
  });

  it("offers adding the missing clock-out or correcting the clock-in of an open entry", () => {
    const { dialog } = renderDialog(OPEN);

    const kinds = within(dialog).getAllByRole("radio") as HTMLInputElement[];
    expect(kinds.map((radio) => radio.closest("label")?.textContent)).toEqual(["إضافة إنهاء دوام منسي", "تصحيح وقت بدء الدوام"]);
    expect(kinds[0].checked).toBe(true);

    // A clock-in correction leaves the entry open: there is nothing to count yet.
    chooseKind("تصحيح وقت بدء الدوام");
    expect(within(dialog).getByText("يبقى الدوام جاريًا حتى يُضاف وقت إنهاء الدوام، فلا تُحسب المدة بعد.")).toBeTruthy();
    expect(within(dialog).queryByRole("table")).toBeNull();
  });

  it("asks for the worker and the shift when it creates the entry of a missing clock-in", async () => {
    const { dialog } = renderDialog();

    expect(screen.getByRole("dialog", { name: "إضافة بدء دوام منسي" })).toBe(dialog);
    expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
    const workerSelect = within(dialog).getByRole("combobox", { name: "العامل" }) as HTMLSelectElement;
    const shiftSelect = within(dialog).getByRole("combobox", { name: "الوردية" }) as HTMLSelectElement;
    expect(document.activeElement).toBe(workerSelect);
    expect(shiftSelect.disabled).toBe(true);

    await within(workerSelect).findByRole("option", { name: "خالد ناصر" });
    expect(client.listWorkers).toHaveBeenCalledTimes(1);
    expect(client.listShifts).toHaveBeenCalledTimes(1);
    expect(optionTexts(workerSelect)).toEqual(["اختر عاملًا…", "خالد ناصر", "محمود جبارين", "سامي عودة"]);
    expect(optionTexts(shiftSelect)).toEqual(["اختر وردية…"]);

    // Only the chosen worker's own shifts, never an emergency call-out shift.
    fireEvent.change(workerSelect, { target: { value: "wp-1" } });
    expect(shiftSelect.disabled).toBe(false);
    expect(optionTexts(shiftSelect)).toEqual(["اختر وردية…", "تنظيم حركة المرور صباحًا — 4 أكتوبر 2026", "صيانة الإشارات ليلًا — 1 سبتمبر 2026"]);

    fireEvent.change(workerSelect, { target: { value: "wp-3" } });
    expect(optionTexts(shiftSelect)).toEqual(["اختر وردية…"]);
    expect(within(dialog).getByText("لا توجد ورديات مخصّصة لهذا العامل.")).toBeTruthy();
  });

  it("previews the corrected minutes with the shared approval split", () => {
    const { dialog } = renderDialog(ENDED);
    chooseKind("تصحيح وقت إنهاء الدوام");
    expect(timeInput().value).toBe("2026-10-04T15:00");

    setTime("2026-10-04T17:30"); // 14:30Z: 10 h 30 m after the 07:00 clock-in
    const raw = rawDurationMinutes(new Date("2026-10-04T04:00:00.000Z"), new Date("2026-10-04T14:30:00.000Z"));
    const split = splitWorkedMinutes({ rawDurationMinutes: raw, unpaidBreakMinutes: 0, fullDayCredit: false });
    expect(split).toMatchObject({ workedMinutes: 630, regularMinutes: 540, overtimeMinutes: 90 });

    const table = within(dialog).getByRole("table", { name: "معاينة قبل الحفظ" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["", "الآن", "بعد التصحيح"]);
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => Array.from(row.children).map((cell) => cell.textContent)),
    ).toEqual([
      ["مدة العمل", "8 س 0 د", "10 س 30 د"],
      ["ساعات عادية", "8 س 0 د", "9 س 0 د"],
      ["ساعات إضافية", "0 س 0 د", "1 س 30 د"],
    ]);
    expect(screen.getByTestId("preview-worked").textContent).toBe(formatMinutes(split.workedMinutes));
    expect(screen.getByTestId("preview-regular").textContent).toBe(formatMinutes(split.regularMinutes));
    expect(screen.getByTestId("preview-overtime").textContent).toBe(formatMinutes(split.overtimeMinutes));
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("refuses a clock-out that is not after the clock-in, without calling the API", () => {
    renderDialog(ENDED);
    chooseKind("تصحيح وقت إنهاء الدوام");
    chooseReason("DEVICE_FAILURE");
    setTime("2026-10-04T06:00"); // 03:00Z, an hour before the 07:00 clock-in
    // Nothing is flagged before a save attempt, and there is no "after" preview.
    expect(screen.queryByText("يجب أن يكون إنهاء الدوام بعد بدء الدوام.")).toBeNull();
    expect(screen.getByTestId("preview-worked").textContent).toBe("—");

    submit();
    const error = screen.getByText("يجب أن يكون إنهاء الدوام بعد بدء الدوام.");
    expect(error.getAttribute("role")).toBe("alert");
    expect(timeInput().getAttribute("aria-invalid")).toBe("true");
    expect(timeInput().getAttribute("aria-describedby")).toBe(error.id);

    // Exactly the clock-in time is refused too.
    setTime("2026-10-04T07:00");
    submit();
    expect(screen.getByText("يجب أن يكون إنهاء الدوام بعد بدء الدوام.")).toBeTruthy();
    expect(client.createManualCorrection).not.toHaveBeenCalled();
  });

  it("sends the Jerusalem wall time of the input as the UTC instant", async () => {
    // Read as the browser's local time, the same value would be another instant here.
    expect(new Date("2026-10-04T17:30").toISOString()).not.toBe("2026-10-04T14:30:00.000Z");
    const { onSaved, onClose } = renderDialog(ENDED);
    chooseKind("تصحيح وقت إنهاء الدوام");
    setTime("2026-10-04T17:30"); // IDT (UTC+3)
    chooseReason("DEVICE_FAILURE");
    submit();

    await waitFor(() => expect(client.createManualCorrection).toHaveBeenCalledTimes(1));
    expect(client.createManualCorrection.mock.calls[0][0]).toStrictEqual({
      timeEntryId: "te-1",
      field: "CLOCK_OUT",
      newValue: "2026-10-04T14:30:00.000Z",
      reason: "DEVICE_FAILURE",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("te-1"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("requires a reason, and a note when the reason is «أخرى»", async () => {
    renderDialog(ENDED);
    expect(screen.getByLabelText("ملاحظة (اختياري)")).toBeTruthy();

    submit();
    const reasonError = screen.getByText("اختر سبب التصحيح.");
    expect(reasonError.getAttribute("role")).toBe("alert");
    expect(reasonSelect().getAttribute("aria-invalid")).toBe("true");
    expect(reasonSelect().getAttribute("aria-describedby")).toBe(reasonError.id);
    expect(client.createManualCorrection).not.toHaveBeenCalled();

    chooseReason("OTHER");
    expect(screen.queryByText("اختر سبب التصحيح.")).toBeNull();
    const note = screen.getByLabelText("ملاحظة (مطلوبة عند اختيار «أخرى»)") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "   " } });
    submit();
    expect(screen.getByText("اكتب ملاحظة عند اختيار «أخرى».").getAttribute("role")).toBe("alert");
    expect(note.getAttribute("aria-invalid")).toBe("true");
    expect(client.createManualCorrection).not.toHaveBeenCalled();

    fireEvent.change(note, { target: { value: "  طلب المدير تعديل الوقت  " } });
    expect(screen.queryByText("اكتب ملاحظة عند اختيار «أخرى».")).toBeNull();
    submit();
    await waitFor(() => expect(client.createManualCorrection).toHaveBeenCalledTimes(1));
    expect(client.createManualCorrection.mock.calls[0][0]).toStrictEqual({
      timeEntryId: "te-1",
      field: "CLOCK_IN",
      newValue: "2026-10-04T04:00:00.000Z",
      reason: "OTHER",
      note: "طلب المدير تعديل الوقت",
    });
  });

  it("tells an Owner a forgotten stamp is this month's third infraction and that it deducts ₪ 10.00", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true).slice(0, 2));
    renderDialog(ENDED);
    chooseKind("تصحيح وقت إنهاء الدوام");
    chooseReason("FORGOTTEN_CLOCK_OUT");

    const status = screen.getByRole("status");
    expect(within(status).getByText("جارٍ حساب رقم المخالفة…")).toBeTruthy();
    expect(await within(status).findByText("هذه المخالفة رقم 3 لهذا الشهر")).toBeTruthy();
    // A correction to an existing entry counts in the month it is made.
    const month = toBusinessYearMonth(new Date());
    expect(client.listForgottenStampInfractions).toHaveBeenCalledTimes(1);
    expect(client.listForgottenStampInfractions).toHaveBeenCalledWith({ workerProfileId: "wp-1", month });
    expect(within(status).getByText("تُحتسب في شهر", { exact: false }).textContent).toBe(`تُحتسب في شهر ${formatMonth(month)}.`);
    const money = within(status).getByText("₪ 10.00");
    expect(money.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(money.closest("p")?.textContent).toBe("سيُخصم ₪ 10.00");
  });

  it("tells a Field Manager the infraction number but never the deduction", async () => {
    auth.role = "FIELD_MANAGER";
    client.listForgottenStampInfractions.mockResolvedValue(infractions(false).slice(0, 2));
    renderDialog(ENDED);
    chooseReason("FORGOTTEN_CLOCK_OUT");

    const status = screen.getByRole("status");
    expect(await within(status).findByText("هذه المخالفة رقم 3 لهذا الشهر")).toBeTruthy();
    expect(client.listForgottenStampInfractions).toHaveBeenCalledWith({ workerProfileId: "wp-1", month: toBusinessYearMonth(new Date()) });
    expect(status.textContent).not.toContain("سيُخصم");
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows an Owner the month's first infraction without a deduction", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue([]);
    renderDialog(ENDED);
    chooseReason("FORGOTTEN_CLOCK_OUT");

    const status = screen.getByRole("status");
    expect(await within(status).findByText("هذه المخالفة رقم 1 لهذا الشهر")).toBeTruthy();
    expect(status.textContent).not.toContain("سيُخصم");
    expect(document.body.textContent).not.toContain("₪");
  });

  it("creates the entry of a missing clock-in from the chosen worker, shift and time", async () => {
    client.createManualCorrection.mockResolvedValue({ timeEntry: { id: "te-new" }, correction: { id: "corr-9" } });
    const { onSaved } = renderDialog();

    submit();
    expect(screen.getByText("اختر العامل.").getAttribute("role")).toBe("alert");
    expect(screen.getByText("اختر الوردية.").getAttribute("role")).toBe("alert");
    expect(screen.getByText("اختر سبب التصحيح.")).toBeTruthy();
    expect(client.createManualCorrection).not.toHaveBeenCalled();

    await pickWorkerAndShift("wp-1", "s-1");
    // The clock-in starts at the shift's scheduled start, in Jerusalem wall time.
    expect(timeInput().value).toBe("2026-10-04T07:00");
    setTime("2026-10-04T07:20");
    chooseReason("FORGOTTEN_CLOCK_IN");
    submit();

    await waitFor(() => expect(client.createManualCorrection).toHaveBeenCalledTimes(1));
    expect(client.createManualCorrection.mock.calls[0][0]).toStrictEqual({
      shiftId: "s-1",
      workerProfileId: "wp-1",
      field: "CLOCK_IN",
      newValue: "2026-10-04T04:20:00.000Z",
      reason: "FORGOTTEN_CLOCK_IN",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("te-new"));
  });

  it("counts a created entry's forgotten clock-in in the Jerusalem month of the entered clock-in", async () => {
    // The month must not be the current one, or this would not tell the two rules apart.
    expect(toBusinessYearMonth(new Date())).not.toBe("2026-09");
    renderDialog();
    await pickWorkerAndShift("wp-1", "s-night");
    expect(timeInput().value).toBe("2026-09-01T01:30");
    chooseReason("FORGOTTEN_CLOCK_IN");

    const status = screen.getByRole("status");
    expect(await within(status).findByText("هذه المخالفة رقم 1 لهذا الشهر")).toBeTruthy();
    // 01:30 on 1 September in Jerusalem is still 31 August in UTC: the infraction is September's.
    expect(client.listForgottenStampInfractions).toHaveBeenCalledTimes(1);
    expect(client.listForgottenStampInfractions).toHaveBeenCalledWith({ workerProfileId: "wp-1", month: "2026-09" });
    expect(within(status).getByText("تُحتسب في شهر", { exact: false }).textContent).toBe("تُحتسب في شهر سبتمبر 2026.");

    // Another clock-in month asks again, for that month.
    setTime("2026-08-15T08:00");
    await waitFor(() => expect(client.listForgottenStampInfractions).toHaveBeenLastCalledWith({ workerProfileId: "wp-1", month: "2026-08" }));
    await waitFor(() => expect(within(status).queryByText("تُحتسب في شهر", { exact: false })?.textContent).toBe("تُحتسب في شهر أغسطس 2026."));
  });

  it("shows the API's error in Arabic inside the dialog and keeps it open", async () => {
    client.createManualCorrection.mockRejectedValue(apiError(409, "PAYROLL_PERIOD_FINALIZED", "The payroll period for this date is finalized."));
    const { dialog, onSaved, onClose } = renderDialog(ENDED);
    chooseKind("تصحيح وقت إنهاء الدوام");
    setTime("2026-10-04T17:30");
    chooseReason("DEVICE_FAILURE");
    submit();

    const alert = await within(dialog).findByText("رواتب هذا الشهر معتمدة نهائياً. أعد فتحها لإجراء التعديلات.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("The payroll period for this date is finalized.")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(timeInput().value).toBe("2026-10-04T17:30");
    expect((within(dialog).getByRole("button", { name: "حفظ التصحيح" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes with Escape or the close button without saving", () => {
    const { onClose } = renderDialog(ENDED);

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(client.createManualCorrection).not.toHaveBeenCalled();
  });

  it("ignores Escape while the correction is being saved, like the disabled «إغلاق», and closes with it again afterwards", async () => {
    const { onClose, onSaved } = renderDialog(ENDED);
    const finishSave = await startPendingSave();

    expect((screen.getByRole("button", { name: "جارٍ الحفظ…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "إغلاق" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    finishSave({ timeEntry: { id: "te-1" }, correction: { id: "corr-2" } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("te-1"));
    await screen.findByRole("button", { name: "حفظ التصحيح" });
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab and Shift+Tab inside the dialog, counting only the checked radio of the type group", () => {
    const { dialog } = renderDialog(ENDED);
    const [clockIn, clockOut] = within(dialog).getAllByRole("radio");
    const close = within(dialog).getByRole("button", { name: "إغلاق" });
    expect(document.activeElement).toBe(clockIn);

    // The first stop is the checked radio, the last is «إغلاق»: Tab and Shift+Tab wrap between them.
    expect(pressTab(clockIn, true)).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(pressTab(close)).toBe(true);
    expect(document.activeElement).toBe(clockIn);

    // In between, the browser moves focus as usual.
    timeInput().focus();
    expect(pressTab(timeInput())).toBe(false);
    expect(pressTab(timeInput(), true)).toBe(false);
    expect(document.activeElement).toBe(timeInput());

    // Another checked type becomes the first stop; the unchecked radios are not stops at all.
    fireEvent.click(clockOut);
    clockOut.focus();
    expect(pressTab(clockOut, true)).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(pressTab(close)).toBe(true);
    expect(document.activeElement).toBe(clockOut);

    // From outside the dialog, Tab enters at the first stop and Shift+Tab at the last.
    clockOut.blur();
    expect(pressTab(document.body)).toBe(true);
    expect(document.activeElement).toBe(clockOut);
    clockOut.blur();
    expect(pressTab(document.body, true)).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("skips disabled controls when Tab wraps: while saving, the note is the last stop", async () => {
    const { dialog } = renderDialog(ENDED);
    await startPendingSave();

    const first = within(dialog).getByRole("radio", { name: "تصحيح وقت إنهاء الدوام" });
    const note = within(dialog).getByLabelText("ملاحظة (اختياري)");
    note.focus();
    expect(pressTab(note)).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(pressTab(first, true)).toBe(true);
    expect(document.activeElement).toBe(note);
  });

  it("gives focus back to what was focused when it opened, once it closes", () => {
    // Outside the rendered tree, so Testing Library's cleanup does not remove it: done in `finally`.
    const opener = document.body.appendChild(document.createElement("button"));
    opener.textContent = "تصحيح يدوي";
    try {
      opener.focus();
      const { dialog, unmount } = renderDialog(ENDED);
      expect(document.activeElement).toBe(within(dialog).getByRole("radio", { name: "تصحيح وقت بدء الدوام" }));
      unmount();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });
});
