import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Shift, TemporarySupervisorListItem } from "@fieldmaster/api-client";
import { ShiftStatus, TemporarySupervisorState } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { TemporarySupervisorsCard } from "../temporary-supervisors-card";

// Business times are Asia/Jerusalem whatever the browser's zone. Run in another zone so that reading
// the inputs as local time could not pass by accident on a machine that is itself set to Jerusalem.
const machineTimeZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (machineTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = machineTimeZone;
});

// "Now" is 12 October 2026 at 08:00 in Jerusalem (IDT, UTC+3): the expiry must be later than that.
const NOW = new Date("2026-10-12T05:00:00.000Z");

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listShiftTemporarySupervisors: vi.fn(),
  revokeTemporarySupervisor: vi.fn(),
  assignTemporarySupervisor: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: "FIELD_MANAGER" } }) }));

// ── Test data ───────────────────────────────────────────────────────────
/** 07:00-16:00 in Jerusalem; wp-9 is on the shift but missing from the names the page passes. */
const SHIFT: Shift = {
  id: "s-1",
  organizationId: "org-1",
  projectId: "p-1",
  siteId: "site-1",
  geofenceId: "g-1",
  shiftType: "STANDARD",
  title: "تنظيم حركة المرور صباحًا",
  scheduledStart: "2026-10-12T04:00:00.000Z",
  scheduledEnd: "2026-10-12T13:00:00.000Z",
  checkInMethod: "GEOFENCED",
  status: ShiftStatus.ACTIVE,
  managerId: "u-fm",
  businessDate: "2026-10-12",
  assignments: [
    { id: "as-1", workerProfileId: "wp-1" },
    { id: "as-2", workerProfileId: "wp-2" },
    { id: "as-3", workerProfileId: "wp-3" },
    { id: "as-4", workerProfileId: "wp-4" },
    { id: "as-9", workerProfileId: "wp-9" },
  ],
};

/** Every worker of the organization (the shift page passes all of them); wp-5 is not on this shift. */
const WORKER_NAMES = new Map([
  ["wp-1", "خالد ناصر"],
  ["wp-2", "محمود جبارين"],
  ["wp-3", "سامي عودة"],
  ["wp-4", "عمر حداد"],
  ["wp-5", "رامي سليمان"],
]);

function assignment(
  fields: Pick<TemporarySupervisorListItem, "id" | "worker" | "activatedAt" | "expiresAt" | "state" | "createdAt"> & Partial<TemporarySupervisorListItem>,
): TemporarySupervisorListItem {
  return { shiftId: "s-1", canOpenCheckInPoints: true, assignedByName: "يوسف الخطيب", revokedAt: null, revokedByName: null, ...fields };
}

// The API lists a shift's assignments newest first.
const ACTIVE = assignment({
  id: "ta-1",
  worker: { id: "wp-1", fullLegalName: "خالد ناصر" },
  activatedAt: "2026-10-12T04:30:00.000Z",
  expiresAt: "2026-10-12T13:00:00.000Z",
  state: TemporarySupervisorState.ACTIVE,
  createdAt: "2026-10-12T04:30:00.000Z",
});
const UPCOMING = assignment({
  id: "ta-2",
  worker: { id: "wp-2", fullLegalName: "محمود جبارين" },
  activatedAt: "2026-10-12T09:00:00.000Z",
  expiresAt: "2026-10-12T13:00:00.000Z",
  canOpenCheckInPoints: false,
  state: TemporarySupervisorState.UPCOMING,
  assignedByName: null,
  createdAt: "2026-10-12T04:15:00.000Z",
});
const EXPIRED = assignment({
  id: "ta-3",
  worker: { id: "wp-3", fullLegalName: "سامي عودة" },
  activatedAt: "2026-10-12T04:00:00.000Z",
  expiresAt: "2026-10-12T04:45:00.000Z",
  state: TemporarySupervisorState.EXPIRED,
  createdAt: "2026-10-12T03:50:00.000Z",
});
const REVOKED = assignment({
  id: "ta-4",
  worker: { id: "wp-4", fullLegalName: "عمر حداد" },
  activatedAt: "2026-10-12T04:00:00.000Z",
  expiresAt: "2026-10-12T13:00:00.000Z",
  state: TemporarySupervisorState.REVOKED,
  assignedByName: "سلمى منصور",
  revokedAt: "2026-10-12T04:20:00.000Z",
  revokedByName: "سلمى منصور",
  createdAt: "2026-10-12T03:30:00.000Z",
});
const ASSIGNMENTS = [ACTIVE, UPCOMING, EXPIRED, REVOKED];

const NOT_ON_SHIFT = "يجب أن يكون المشرف المؤقت عاملًا مكلّفًا بهذه الوردية ويسجّل حضوره.";
const EXPIRY_ORDER = "يجب أن يكون وقت الانتهاء بعد وقت البدء وفي المستقبل.";
const CONFLICT_MESSAGE = "لا يمكن تنفيذ هذا الإجراء الآن لأن البيانات تغيّرت. حدّث البيانات وحاول مرة أخرى.";

// ── Helpers ─────────────────────────────────────────────────────────────
function renderCard(shift: Shift = SHIFT) {
  return renderWithIntl(<TemporarySupervisorsCard shift={shift} workerNames={WORKER_NAMES} />, { queryClient: true });
}

/** Matches the innermost element whose whole text (nested elements included) is exactly `text`. */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text);
}

/** The list item of a supervisor, by the worker's name. */
function itemOf(name: string): HTMLElement {
  const item = within(screen.getByRole("list")).getByText(name).closest("li");
  if (!item) throw new Error(`no assignment of ${name}`);
  return item;
}

const form = () => within(screen.getByRole("form", { name: "تكليف مشرف مؤقت" }));
const workerSelect = () => form().getByRole("combobox", { name: "العامل" }) as HTMLSelectElement;
const startInput = () => form().getByLabelText("يبدأ في (توقيت القدس)") as HTMLInputElement;
const expiryInput = () => form().getByLabelText("ينتهي في (توقيت القدس)") as HTMLInputElement;
const pointsCheckbox = () => form().getByRole("checkbox", { name: "السماح بفتح نقاط التسجيل المؤقتة وإغلاقها" }) as HTMLInputElement;
const submit = () => fireEvent.click(form().getByRole("button", { name: "تكليف المشرف" }));

function fillForm({ worker, start, expiry }: { worker?: string; start?: string; expiry?: string }) {
  if (worker !== undefined) fireEvent.change(workerSelect(), { target: { value: worker } });
  if (start !== undefined) fireEvent.change(startInput(), { target: { value: start } });
  if (expiry !== undefined) fireEvent.change(expiryInput(), { target: { value: expiry } });
}

/** The expiry error currently shown, checked to be announced and tied to the expiry input. */
function expiryError(): string | null {
  const input = expiryInput();
  const errorId = input.getAttribute("aria-describedby");
  if (input.getAttribute("aria-invalid") !== "true" || !errorId) return null;
  const error = document.getElementById(errorId);
  expect(error?.getAttribute("role")).toBe("alert");
  return error?.textContent ?? null;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.setSystemTime(NOW);
  client.listShiftTemporarySupervisors.mockResolvedValue(ASSIGNMENTS);
  client.assignTemporarySupervisor.mockResolvedValue({ id: "ta-5" });
  client.revokeTemporarySupervisor.mockResolvedValue({ id: "ta-1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TemporarySupervisorsCard", () => {
  it("lists the shift's supervisors with their state, window, permission and who assigned or revoked them", async () => {
    renderCard();

    expect(screen.getByRole("heading", { name: "المشرفون المؤقتون" })).toBeTruthy();
    expect(screen.getByText("جارٍ التحميل…")).toBeTruthy();
    const items = await within(await screen.findByRole("list")).findAllByRole("listitem");
    expect(client.listShiftTemporarySupervisors).toHaveBeenCalledWith("s-1");
    expect(items).toHaveLength(4);

    const active = within(items[0]);
    expect(active.getByText("خالد ناصر")).toBeTruthy();
    expect(active.getByText("نشط")).toBeTruthy();
    expect(active.getByText(fullText("من 12 أكتوبر 2026 في 07:30 إلى 12 أكتوبر 2026 في 16:00"))).toBeTruthy();
    expect(active.getByText("مسموح بفتح نقاط التسجيل المؤقتة وإغلاقها.")).toBeTruthy();
    expect(active.getByText(fullText("التكليف بواسطة يوسف الخطيب، 12 أكتوبر 2026 في 07:30"))).toBeTruthy();
    expect(active.queryByText(/أُلغي بواسطة/)).toBeNull();

    const upcoming = within(items[1]);
    expect(upcoming.getByText("محمود جبارين")).toBeTruthy();
    expect(upcoming.getByText("لم يبدأ بعد")).toBeTruthy();
    expect(upcoming.getByText(fullText("من 12 أكتوبر 2026 في 12:00 إلى 12 أكتوبر 2026 في 16:00"))).toBeTruthy();
    expect(upcoming.getByText("غير مسموح بفتح نقاط تسجيل مؤقتة.")).toBeTruthy();
    // The API could not name who assigned it.
    expect(upcoming.getByText(fullText("التكليف بواسطة مستخدم غير معروف، 12 أكتوبر 2026 في 07:15"))).toBeTruthy();

    const expired = within(items[2]);
    expect(expired.getByText("سامي عودة")).toBeTruthy();
    expect(expired.getByText("انتهى")).toBeTruthy();
    expect(expired.getByText(fullText("من 12 أكتوبر 2026 في 07:00 إلى 12 أكتوبر 2026 في 07:45"))).toBeTruthy();
    expect(expired.getByText(fullText("التكليف بواسطة يوسف الخطيب، 12 أكتوبر 2026 في 06:50"))).toBeTruthy();

    const revoked = within(items[3]);
    expect(revoked.getByText("عمر حداد")).toBeTruthy();
    expect(revoked.getByText("أُلغي")).toBeTruthy();
    expect(revoked.getByText(fullText("التكليف بواسطة سلمى منصور، 12 أكتوبر 2026 في 06:30"))).toBeTruthy();
    expect(revoked.getByText(fullText("أُلغي بواسطة سلمى منصور، 12 أكتوبر 2026 في 07:20"))).toBeTruthy();

    // Only an active or upcoming assignment can be revoked.
    expect(active.getByRole("button", { name: "إلغاء إشراف خالد ناصر" }).textContent).toBe("إلغاء الإشراف");
    expect(upcoming.getByRole("button", { name: "إلغاء إشراف محمود جبارين" }).textContent).toBe("إلغاء الإشراف");
    expect(expired.queryAllByRole("button")).toHaveLength(0);
    expect(revoked.queryAllByRole("button")).toHaveLength(0);
    expect(client.revokeTemporarySupervisor).not.toHaveBeenCalled();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("revokes in two steps: nothing is sent until the confirmation, and «تراجع» goes back", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "إلغاء إشراف خالد ناصر" }));

    const item = within(itemOf("خالد ناصر"));
    expect(item.getByText("إلغاء إشراف خالد ناصر الآن؟")).toBeTruthy();
    expect(item.getByRole("button", { name: "نعم، ألغِ الإشراف" })).toBeTruthy();
    expect(item.queryByRole("button", { name: "إلغاء إشراف خالد ناصر" })).toBeNull();
    // The other supervisor's button is unaffected.
    expect(within(itemOf("محمود جبارين")).getByRole("button", { name: "إلغاء إشراف محمود جبارين" })).toBeTruthy();
    expect(client.revokeTemporarySupervisor).not.toHaveBeenCalled();

    fireEvent.click(item.getByRole("button", { name: "تراجع" }));
    expect(item.queryByText("إلغاء إشراف خالد ناصر الآن؟")).toBeNull();
    expect(item.getByRole("button", { name: "إلغاء إشراف خالد ناصر" })).toBeTruthy();
    expect(client.revokeTemporarySupervisor).not.toHaveBeenCalled();
  });

  it("revokes the assignment after the confirmation, announces it and reloads the list", async () => {
    const revokedNow = { ...ACTIVE, state: TemporarySupervisorState.REVOKED, revokedAt: "2026-10-12T05:00:00.000Z", revokedByName: "يوسف الخطيب" };
    client.listShiftTemporarySupervisors.mockResolvedValueOnce(ASSIGNMENTS).mockResolvedValue([revokedNow, UPCOMING, EXPIRED, REVOKED]);
    let finish: (value: unknown) => void = () => {};
    client.revokeTemporarySupervisor.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "إلغاء إشراف خالد ناصر" }));
    fireEvent.click(screen.getByRole("button", { name: "نعم، ألغِ الإشراف" }));

    const pending = (await screen.findByRole("button", { name: "جارٍ الإلغاء…" })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "تراجع" }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.revokeTemporarySupervisor).toHaveBeenCalledTimes(1);
    expect(client.revokeTemporarySupervisor).toHaveBeenCalledWith("ta-1");

    finish({ id: "ta-1" });
    const announcement = await screen.findByText("تم إلغاء إشراف خالد ناصر.");
    expect(announcement.closest('[role="status"]')).toBeTruthy();
    await waitFor(() => expect(client.listShiftTemporarySupervisors).toHaveBeenCalledTimes(2));
    const item = within(itemOf("خالد ناصر"));
    expect(await item.findByText(fullText("أُلغي بواسطة يوسف الخطيب، 12 أكتوبر 2026 في 08:00"))).toBeTruthy();
    expect(item.getByText("أُلغي")).toBeTruthy();
    expect(item.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows a failed revocation in Arabic under that supervisor", async () => {
    client.revokeTemporarySupervisor.mockRejectedValue(apiError(409, "CONFLICT", "This assignment was already revoked."));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "إلغاء إشراف خالد ناصر" }));
    fireEvent.click(screen.getByRole("button", { name: "نعم، ألغِ الإشراف" }));

    const alert = await within(itemOf("خالد ناصر")).findByText(CONFLICT_MESSAGE);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("This assignment was already revoked.")).toBeNull();
    expect(within(itemOf("محمود جبارين")).queryByRole("alert")).toBeNull();
    expect(screen.queryByText("تم إلغاء إشراف خالد ناصر.")).toBeNull();
  });

  // Regression: «تراجع» after a failed revocation used to leave the error under the supervisor.
  it("clears a failed revocation's error on «تراجع», and reopening the confirmation shows no old error", async () => {
    client.revokeTemporarySupervisor.mockRejectedValueOnce(apiError(409, "CONFLICT", "This assignment was already revoked.")).mockResolvedValue({ id: "ta-1" });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "إلغاء إشراف خالد ناصر" }));
    fireEvent.click(screen.getByRole("button", { name: "نعم، ألغِ الإشراف" }));
    const item = within(itemOf("خالد ناصر"));
    expect(await item.findByText(CONFLICT_MESSAGE)).toBeTruthy();

    fireEvent.click(item.getByRole("button", { name: "تراجع" }));
    expect(item.queryByText(CONFLICT_MESSAGE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(item.queryByText("إلغاء إشراف خالد ناصر الآن؟")).toBeNull();
    expect(item.getByRole("button", { name: "إلغاء إشراف خالد ناصر" })).toBeTruthy();

    fireEvent.click(item.getByRole("button", { name: "إلغاء إشراف خالد ناصر" }));
    expect(item.getByText("إلغاء إشراف خالد ناصر الآن؟")).toBeTruthy();
    expect(item.queryByText(CONFLICT_MESSAGE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    // The next attempt goes through.
    fireEvent.click(item.getByRole("button", { name: "نعم، ألغِ الإشراف" }));
    expect(await screen.findByText("تم إلغاء إشراف خالد ناصر.")).toBeTruthy();
    expect(client.revokeTemporarySupervisor).toHaveBeenCalledTimes(2);
    expect(client.revokeTemporarySupervisor).toHaveBeenLastCalledWith("ta-1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers only the shift's own workers, with the shift's end as the default expiry", async () => {
    renderCard();
    await screen.findByRole("list");

    expect(form().getByRole("heading", { name: "تكليف مشرف مؤقت" })).toBeTruthy();
    expect(
      within(workerSelect())
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["اختر عاملًا من هذه الوردية…", "خالد ناصر", "محمود جبارين", "سامي عودة", "عمر حداد", "عامل"]);
    expect(workerSelect().value).toBe("");
    expect(form().queryByRole("option", { name: "رامي سليمان" })).toBeNull();
    expect(form().getByText("يجب أن يكون عاملًا مكلّفًا بهذه الوردية ويسجّل حضوره.")).toBeTruthy();

    expect(startInput().value).toBe("");
    expect(form().getByText("اتركه فارغًا ليبدأ الآن.")).toBeTruthy();
    // 13:00Z, the shift's end, is 16:00 in Jerusalem (in New York it would read 09:00).
    expect(expiryInput().value).toBe("2026-10-12T16:00");
    expect(form().getByText("افتراضيًا: نهاية الوردية.")).toBeTruthy();
    expect(pointsCheckbox().checked).toBe(true);
    expect((form().getByRole("button", { name: "تكليف المشرف" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires the worker before sending anything", async () => {
    renderCard();
    await screen.findByRole("list");

    submit();
    const error = form().getByText("اختر العامل.");
    expect(error.getAttribute("role")).toBe("alert");
    expect(workerSelect().getAttribute("aria-invalid")).toBe("true");
    expect(workerSelect().getAttribute("aria-describedby")).toBe(error.id);
    // The default expiry (the shift's end) is fine.
    expect(expiryError()).toBeNull();
    expect(client.assignTemporarySupervisor).not.toHaveBeenCalled();

    fillForm({ worker: "wp-1" });
    expect(form().queryByText("اختر العامل.")).toBeNull();
    expect(workerSelect().getAttribute("aria-invalid")).toBeNull();
  });

  it("requires an expiry after the start and in the future", async () => {
    renderCard();
    await screen.findByRole("list");
    fillForm({ worker: "wp-1" });

    fillForm({ expiry: "" });
    submit();
    expect(expiryError()).toBe("أدخل وقت الانتهاء.");

    // Before the chosen start.
    fillForm({ start: "2026-10-12T12:00", expiry: "2026-10-12T11:00" });
    expect(expiryError()).toBe(EXPIRY_ORDER);
    // Exactly at the start.
    fillForm({ expiry: "2026-10-12T12:00" });
    expect(expiryError()).toBe(EXPIRY_ORDER);
    // Starting now (no start time) and ending before now (07:30 < 08:00), or at now.
    fillForm({ start: "", expiry: "2026-10-12T07:30" });
    expect(expiryError()).toBe(EXPIRY_ORDER);
    fillForm({ expiry: "2026-10-12T08:00" });
    expect(expiryError()).toBe(EXPIRY_ORDER);
    expect(client.assignTemporarySupervisor).not.toHaveBeenCalled();

    // A minute later is accepted.
    fillForm({ expiry: "2026-10-12T08:01" });
    expect(expiryError()).toBeNull();
    expect(form().getByText("افتراضيًا: نهاية الوردية.")).toBeTruthy();
  });

  // Regression: with a start time, an expiry in the past (but after that start) passed the form and reached the API.
  it("refuses an expiry in the past even when it is after an earlier start time", async () => {
    renderCard();
    await screen.findByRole("list");

    // Now is 08:00 in Jerusalem: 07:30 is after the 06:00 start, but already past.
    fillForm({ worker: "wp-1", start: "2026-10-12T06:00", expiry: "2026-10-12T07:30" });
    submit();
    expect(expiryError()).toBe(EXPIRY_ORDER);
    expect(client.assignTemporarySupervisor).not.toHaveBeenCalled();
    // Exactly now is not in the future either.
    fillForm({ expiry: "2026-10-12T08:00" });
    expect(expiryError()).toBe(EXPIRY_ORDER);
    submit();
    expect(client.assignTemporarySupervisor).not.toHaveBeenCalled();

    // The same earlier start with a future expiry is accepted and sent as given.
    fillForm({ expiry: "2026-10-12T15:00" });
    expect(expiryError()).toBeNull();
    submit();
    await waitFor(() => expect(client.assignTemporarySupervisor).toHaveBeenCalledTimes(1));
    expect(client.assignTemporarySupervisor.mock.calls[0]).toStrictEqual([
      "s-1",
      { workerProfileId: "wp-1", activatedAt: "2026-10-12T03:00:00.000Z", expiresAt: "2026-10-12T12:00:00.000Z", canOpenCheckInPoints: true },
    ]);
  });

  it("sends the Jerusalem wall times of the inputs as UTC instants", async () => {
    // Read as the browser's local time, the same value would be another instant here.
    expect(new Date("2026-10-12T09:00").toISOString()).not.toBe("2026-10-12T06:00:00.000Z");
    renderCard();
    await screen.findByRole("list");

    fillForm({ worker: "wp-1", start: "2026-10-12T09:00", expiry: "2026-10-12T15:30" });
    fireEvent.click(pointsCheckbox());
    submit();

    await waitFor(() => expect(client.assignTemporarySupervisor).toHaveBeenCalledTimes(1));
    expect(client.assignTemporarySupervisor.mock.calls[0][0]).toBe("s-1");
    expect(client.assignTemporarySupervisor.mock.calls[0][1]).toStrictEqual({
      workerProfileId: "wp-1",
      activatedAt: "2026-10-12T06:00:00.000Z",
      expiresAt: "2026-10-12T12:30:00.000Z",
      canOpenCheckInPoints: false,
    });
  });

  it("starts now and ends at the shift's end by default, then announces the assignment and reloads the list", async () => {
    const assigned = assignment({
      id: "ta-5",
      worker: { id: "wp-2", fullLegalName: "محمود جبارين" },
      activatedAt: "2026-10-12T05:00:00.000Z",
      expiresAt: "2026-10-12T13:00:00.000Z",
      state: TemporarySupervisorState.ACTIVE,
      createdAt: "2026-10-12T05:00:00.000Z",
    });
    client.listShiftTemporarySupervisors.mockResolvedValueOnce(ASSIGNMENTS).mockResolvedValue([assigned, ...ASSIGNMENTS]);
    let finish: (value: unknown) => void = () => {};
    client.assignTemporarySupervisor.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderCard();
    await screen.findByRole("list");

    fillForm({ worker: "wp-2" });
    submit();

    const pending = (await form().findByRole("button", { name: "جارٍ التكليف…" })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(client.assignTemporarySupervisor).toHaveBeenCalledTimes(1);
    // No start time: the key is left out so the API starts it now.
    expect(client.assignTemporarySupervisor.mock.calls[0]).toStrictEqual([
      "s-1",
      { workerProfileId: "wp-2", expiresAt: "2026-10-12T13:00:00.000Z", canOpenCheckInPoints: true },
    ]);

    finish(assigned);
    const announcement = await screen.findByText("تم تكليف محمود جبارين مشرفًا مؤقتًا لهذه الوردية.");
    expect(announcement.closest('[role="status"]')).toBeTruthy();
    expect(workerSelect().value).toBe("");
    expect(startInput().value).toBe("");
    expect(form().queryByRole("alert")).toBeNull();
    await waitFor(() => expect(client.listShiftTemporarySupervisors).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(5));
  });

  it.each([
    ["TEMPORARY_SUPERVISOR_NOT_ON_SHIFT", "A temporary supervisor must be an active, time-trackable worker assigned to this shift.", NOT_ON_SHIFT],
    [
      "TEMPORARY_SUPERVISOR_ALREADY_ASSIGNED",
      "This worker is already a temporary supervisor of this shift for that time.",
      "هذا العامل مشرف مؤقت لهذه الوردية في الفترة نفسها بالفعل.",
    ],
  ])("shows the API's 409 %s in Arabic and keeps the form filled", async (code, english, message) => {
    client.assignTemporarySupervisor.mockRejectedValue(apiError(409, code, english));
    renderCard();
    await screen.findByRole("list");

    fillForm({ worker: "wp-1", start: "2026-10-12T09:00" });
    submit();

    const alert = await form().findByText(message);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(english)).toBeNull();
    expect(screen.queryByText(/مشرفًا مؤقتًا لهذه الوردية\.$/)).toBeNull();
    expect(workerSelect().value).toBe("wp-1");
    expect(startInput().value).toBe("2026-10-12T09:00");
    expect((form().getByRole("button", { name: "تكليف المشرف" }) as HTMLButtonElement).disabled).toBe(false);
    expect(client.listShiftTemporarySupervisors).toHaveBeenCalledTimes(1);
  });

  it.each([ShiftStatus.CLOSED, ShiftStatus.CANCELLED])("on a %s shift says the shift is closed instead of offering the form", async (status) => {
    renderCard({ ...SHIFT, status });
    await screen.findByRole("list");

    expect(screen.getByText("هذه الوردية مغلقة أو ملغاة، فلا يمكن تكليف مشرف مؤقت لها.")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "تكليف مشرف مؤقت" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "العامل" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تكليف المشرف" })).toBeNull();
  });

  it("cannot assign anyone on a shift without workers", async () => {
    client.listShiftTemporarySupervisors.mockResolvedValue([]);
    renderCard({ ...SHIFT, assignments: [] });

    expect(await screen.findByText("لا يوجد مشرف مؤقت لهذه الوردية.")).toBeTruthy();
    expect(form().getByText("لا يوجد عمال مكلّفون بهذه الوردية بعد.")).toBeTruthy();
    expect(within(workerSelect()).getAllByRole("option")).toHaveLength(1);
    expect((form().getByRole("button", { name: "تكليف المشرف" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a translated error with a working retry when the list cannot be loaded", async () => {
    client.listShiftTemporarySupervisors.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderCard();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("button", { name: "إلغاء إشراف خالد ناصر" })).toBeTruthy();
    expect(client.listShiftTemporarySupervisors).toHaveBeenCalledTimes(2);
  });
});
