import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ForgottenStampInfraction } from "@fieldmaster/api-client";
import { toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits, infractions } from "@/test/attendance-fixtures";
import ForgottenStampsPage from "../page";

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listForgottenStampInfractions: vi.fn(),
  reverseForgottenStampInfraction: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "FIELD_MANAGER" }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/attendance/forgotten-stamps",
  useSearchParams: () => nav.search,
}));

// The correction cells reuse the attendance evidence sections, which load the Leaflet map through next/dynamic.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub() {
      return <div data-testid="map" />;
    },
}));

// ── Helpers ─────────────────────────────────────────────────────────────
const WORKER = "خالد ناصر";
const REVERSE_THIRD = `إلغاء خصم المخالفة رقم 3 لـ${WORKER}`;
const REVERSED_THIRD = `أُلغي خصم المخالفة رقم 3 لـ${WORKER}.`;
const REASON_REQUIRED = "اكتب السبب قبل المتابعة.";
const CONFLICT_MESSAGE = "لا يمكن تنفيذ هذا الإجراء الآن لأن البيانات تغيّرت. حدّث البيانات وحاول مرة أخرى.";

function renderPage() {
  return renderWithIntl(<ForgottenStampsPage />, { queryClient: true });
}

/** The table row of infraction number `sequence`. */
function rowOf(sequence: number): HTMLElement {
  const row = screen.getByText(`المخالفة رقم ${sequence}`).closest("tr");
  if (!row) throw new Error(`no row for infraction ${sequence}`);
  return row;
}

function cellsOf(sequence: number): HTMLElement[] {
  return within(rowOf(sequence)).getAllByRole("cell");
}

/** The value next to a term of the month totals. */
function totalOf(term: string): string | null | undefined {
  return screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
}

/** Matches the innermost element whose whole text (nested elements included) is exactly `text`. */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text);
}

/** The Owner's third infraction (the one with a ₪ 10.00 deduction) after it was cancelled. */
function withThirdReversed(): ForgottenStampInfraction[] {
  const rows = infractions(true);
  rows[2] = {
    ...rows[2],
    reversedAt: "2026-10-05T09:00:00.000Z", // 12:00 in Asia/Jerusalem (IDT)
    reversedBy: "u-owner",
    reversedByName: "سلمى منصور",
    reversalReason: "كان العامل في مهمة طارئة",
    reversalAdjustmentId: "adj-9",
  };
  return rows;
}

async function openReverseForm() {
  fireEvent.click(await screen.findByRole("button", { name: REVERSE_THIRD }));
  return screen.getByLabelText("سبب إلغاء الخصم") as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "FIELD_MANAGER";
  nav.search = new URLSearchParams("month=2026-10");
  client.listForgottenStampInfractions.mockResolvedValue(infractions(false));
});

describe("Forgotten stamps page", () => {
  it("shows the loading state while the month loads", () => {
    client.listForgottenStampInfractions.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "نسيان التسجيل" })).toBeTruthy();
    expect(screen.getByText("جارٍ التحميل…").closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: "العودة إلى الحضور" }).getAttribute("href")).toBe("/attendance");
  });

  it("requests the month from the URL and shows it in the month picker", async () => {
    renderPage();

    await screen.findByText("المخالفة رقم 1");
    expect(client.listForgottenStampInfractions).toHaveBeenCalledWith({ month: "2026-10" });
    expect((screen.getByLabelText("الشهر") as HTMLInputElement).value).toBe("2026-10");
    expect(screen.getByText("أكتوبر 2026")).toBeTruthy();
  });

  it("uses the current business month without a valid month in the URL", async () => {
    const currentMonth = toBusinessYearMonth(new Date());
    nav.search = new URLSearchParams();
    const { unmount } = renderPage();
    await screen.findByText("المخالفة رقم 1");
    expect(client.listForgottenStampInfractions).toHaveBeenLastCalledWith({ month: currentMonth });
    expect((screen.getByLabelText("الشهر") as HTMLInputElement).value).toBe(currentMonth);
    unmount();

    nav.search = new URLSearchParams("month=2026-13");
    renderPage();
    await screen.findByText("المخالفة رقم 1");
    expect(client.listForgottenStampInfractions).toHaveBeenLastCalledWith({ month: currentMonth });
    expect(client.listForgottenStampInfractions).not.toHaveBeenCalledWith({ month: "2026-13" });
  });

  it("moves to the next and previous month through the URL", async () => {
    renderPage();
    await screen.findByText("المخالفة رقم 1");

    fireEvent.click(screen.getByRole("button", { name: "الشهر التالي" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/attendance/forgotten-stamps?month=2026-11");
    fireEvent.click(screen.getByRole("button", { name: "الشهر السابق" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/attendance/forgotten-stamps?month=2026-09");
    expect(nav.replace).toHaveBeenCalledTimes(2);
  });

  it("shows a Field Manager each worker's infractions without any money", async () => {
    renderPage();

    const list = await screen.findByRole("list", { name: "العمال الذين نسوا التسجيل في هذا الشهر" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(1);
    const card = within(cards[0]);
    expect(card.getByRole("link", { name: WORKER }).getAttribute("href")).toBe("/workers/wp-1");
    // Arabic plural: 3 takes the "few" form.
    expect(card.getByText("3 مخالفات")).toBeTruthy();
    expect(screen.getByText("عامل واحد، 3 مخالفات")).toBeTruthy();
    expect(card.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "رقم المخالفة",
      "يوم العمل",
      "التسجيل المنسي",
      "التصحيح المرتبط",
      "إلغاء الخصم",
    ]);

    for (const sequence of [1, 2, 3]) {
      const cells = cellsOf(sequence);
      expect(cells).toHaveLength(5);
      expect(cells[0].textContent).toBe(`المخالفة رقم ${sequence}`);
      expect(cells[1].textContent).toBe(`${sequence} أكتوبر 2026`);
      expect(cells[2].textContent).toBe(sequence === 2 ? "بدء الدوام" : "إنهاء الدوام");
      const correction = within(cells[3]);
      // newValue 14:00Z and createdAt 15:00Z read 17:00 and 18:00 in Asia/Jerusalem.
      expect(correction.getByText(fullText(`إنهاء الدوام: من لا شيء إلى ${sequence} أكتوبر 2026 في 17:00`))).toBeTruthy();
      expect(correction.getByText(fullText(`يوسف الخطيب، ${sequence} أكتوبر 2026 في 18:00`))).toBeTruthy();
      expect(correction.getByRole("link", { name: "عرض الحضور" }).getAttribute("href")).toBe(`/attendance/te-${sequence}`);
      expect(cells[4].textContent).toBe("—");
    }

    expect(screen.queryByText("إجماليات الشهر")).toBeNull();
    expect(screen.queryByText(/الخصم هذا الشهر/)).toBeNull();
    expect(screen.queryByText("بلا خصم")).toBeNull();
    expect(screen.queryByRole("button", { name: /إلغاء خصم/ })).toBeNull();
    expect(screen.queryAllByRole("button").filter((button) => button.textContent === "إلغاء الخصم")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("₪");
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("shows the Owner the deductions, the month totals and the worker's month deduction", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true));
    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: "إجماليات الشهر" })).toBeTruthy();
    expect(totalOf("الخصومات")).toBe("₪ 10.00");
    expect(totalOf("خصومات أُلغيت")).toBe("₪ 0.00");
    expect(totalOf("صافي الخصومات")).toBe("₪ 10.00");
    expect(screen.getByText(fullText("الخصم هذا الشهر: ₪ 10.00"))).toBeTruthy();

    const table = screen.getByRole("table", { name: `مخالفات نسيان التسجيل لـ${WORKER}` });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toContain("الخصم");
    expect(cellsOf(1)[5].textContent).toBe("بلا خصم");
    expect(cellsOf(2)[5].textContent).toBe("بلا خصم");
    const deducted = within(cellsOf(3)[5]);
    expect(deducted.getByText("₪ 10.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // Only the deducted, not yet cancelled infraction can be cancelled.
    expect(deducted.getByRole("button", { name: REVERSE_THIRD }).textContent).toBe("إلغاء الخصم");
    expect(within(table).getAllByRole("button")).toHaveLength(1);
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("asks the Owner for a reason and refuses a blank one without calling the API", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true));
    renderPage();

    const reason = await openReverseForm();
    expect(reason.value).toBe("");
    expect(screen.getByText("السبب مطلوب ويُحفظ في سجل التدقيق. يبقى الخصم الأصلي محفوظًا، ويُضاف تعديل يلغيه.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: REVERSE_THIRD })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }));
    expect(screen.getByText(REASON_REQUIRED).getAttribute("role")).toBe("alert");
    expect(reason.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(reason, { target: { value: "   " } });
    expect(screen.queryByText(REASON_REQUIRED)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }));
    expect(screen.getByText(REASON_REQUIRED)).toBeTruthy();
    expect(client.reverseForgottenStampInfraction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByLabelText("سبب إلغاء الخصم")).toBeNull();
    expect(screen.getByRole("button", { name: REVERSE_THIRD })).toBeTruthy();
    expect(client.reverseForgottenStampInfraction).not.toHaveBeenCalled();
  });

  it("cancels the third infraction's deduction with the written reason and announces it", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValueOnce(infractions(true)).mockResolvedValue(withThirdReversed());
    let finishReversal: (value: unknown) => void = () => {};
    client.reverseForgottenStampInfraction.mockReturnValue(new Promise((resolve) => (finishReversal = resolve)));
    renderPage();

    const reason = await openReverseForm();
    fireEvent.change(reason, { target: { value: "  نسي العامل التسجيل بسبب عطل في الهاتف  " } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }));

    await waitFor(() => expect(client.reverseForgottenStampInfraction).toHaveBeenCalledWith("inf-3", "نسي العامل التسجيل بسبب عطل في الهاتف"));
    const pending = (await screen.findByRole("button", { name: "جارٍ الإلغاء…" })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "إلغاء" }) as HTMLButtonElement).disabled).toBe(true);

    finishReversal(withThirdReversed()[2]);
    const announcement = await screen.findByText(REVERSED_THIRD);
    expect(announcement.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByLabelText("سبب إلغاء الخصم")).toBeNull();

    // The month is reloaded: the infraction now shows as cancelled and cannot be cancelled again.
    await waitFor(() => expect(client.listForgottenStampInfractions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("بواسطة سلمى منصور. السبب: كان العامل في مهمة طارئة")).toBeTruthy();
    expect(screen.queryByRole("button", { name: REVERSE_THIRD })).toBeNull();
    expect(client.reverseForgottenStampInfraction).toHaveBeenCalledTimes(1);
  });

  it("shows an API error during the cancellation in Arabic and keeps the form open", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true));
    client.reverseForgottenStampInfraction.mockRejectedValue(apiError(409, "CONFLICT", "This infraction has already been reversed."));
    renderPage();

    const reason = await openReverseForm();
    fireEvent.change(reason, { target: { value: "خطأ في التسجيل" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }));

    const alert = await screen.findByText(CONFLICT_MESSAGE);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("This infraction has already been reversed.")).toBeNull();
    expect(screen.queryByText(REVERSED_THIRD)).toBeNull();
    expect((screen.getByLabelText("سبب إلغاء الخصم") as HTMLTextAreaElement).value).toBe("خطأ في التسجيل");
    expect((screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }) as HTMLButtonElement).disabled).toBe(false);
  });

  // Regression: the failed attempt's error used to come back on the next, empty form.
  it("opens a clean form again after a failed cancellation was abandoned, and the next attempt goes through", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true));
    client.reverseForgottenStampInfraction
      .mockRejectedValueOnce(apiError(409, "CONFLICT", "This infraction has already been reversed."))
      .mockResolvedValue(withThirdReversed()[2]);
    renderPage();

    const first = await openReverseForm();
    fireEvent.change(first, { target: { value: "خطأ في التسجيل" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }));
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("alert")).toBeNull();

    const reopened = await openReverseForm();
    expect(reopened.value).toBe("");
    expect(reopened.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(reopened, { target: { value: "تصحيح بعد مراجعة السجل" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }));
    expect(await screen.findByText(REVERSED_THIRD)).toBeTruthy();
    expect(client.reverseForgottenStampInfraction).toHaveBeenCalledTimes(2);
    expect(client.reverseForgottenStampInfraction).toHaveBeenLastCalledWith("inf-3", "تصحيح بعد مراجعة السجل");
  });

  // Regression: the success message of one month used to stay on screen after moving to another month.
  it("clears the cancellation announcement when the month picker moves to another month", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockImplementation(async ({ month }: { month: string }) => (month === "2026-10" ? infractions(true) : []));
    client.reverseForgottenStampInfraction.mockResolvedValue(withThirdReversed()[2]);
    const { rerender } = renderPage();

    const reason = await openReverseForm();
    fireEvent.change(reason, { target: { value: "نسي العامل التسجيل بسبب عطل في الهاتف" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إلغاء الخصم" }));
    expect(await screen.findByText(REVERSED_THIRD)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "الشهر التالي" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/attendance/forgotten-stamps?month=2026-11");
    expect(screen.queryByText(REVERSED_THIRD)).toBeNull();

    // The router opens November: the October message does not come back.
    nav.search = new URLSearchParams("month=2026-11");
    rerender(<ForgottenStampsPage />);
    expect(await screen.findByText("لا توجد حالات نسيان تسجيل في هذا الشهر")).toBeTruthy();
    expect(client.listForgottenStampInfractions).toHaveBeenLastCalledWith({ month: "2026-11" });
    expect(screen.queryByText(REVERSED_THIRD)).toBeNull();
  });

  it("shows a cancelled deduction with its date, who cancelled it and why, and counts it as cancelled", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue(withThirdReversed());
    renderPage();

    await screen.findByText("إجماليات الشهر");
    const reversal = within(cellsOf(3)[4]);
    expect(reversal.getByText(fullText("أُلغي في 5 أكتوبر 2026 في 12:00"))).toBeTruthy();
    expect(reversal.getByText("بواسطة سلمى منصور. السبب: كان العامل في مهمة طارئة")).toBeTruthy();
    // The original deduction stays on the row, without a cancel action.
    expect(cellsOf(3)[5].textContent).toBe("₪ 10.00");
    expect(screen.queryByRole("button", { name: REVERSE_THIRD })).toBeNull();
    expect(within(screen.getByRole("table")).queryAllByRole("button")).toHaveLength(0);

    expect(totalOf("الخصومات")).toBe("₪ 10.00");
    expect(totalOf("خصومات أُلغيت")).toBe("₪ 10.00");
    expect(totalOf("صافي الخصومات")).toBe("₪ 0.00");
    expect(screen.getByText(fullText("الخصم هذا الشهر: ₪ 0.00"))).toBeTruthy();
    // The other infractions were never cancelled.
    expect(cellsOf(1)[4].textContent).toBe("—");
    expect(cellsOf(2)[4].textContent).toBe("—");
  });

  it("shows the page's empty state for a month without infractions, without totals even for the Owner", async () => {
    auth.role = "OWNER";
    client.listForgottenStampInfractions.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("لا توجد حالات نسيان تسجيل في هذا الشهر")).toBeTruthy();
    expect(screen.getByText("تُسجَّل المخالفة عند تصحيح يدوي سببه نسيان تسجيل بدء الدوام أو إنهائه.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("إجماليات الشهر")).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    client.listForgottenStampInfractions.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderPage();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.getByText("حدث خطأ ما")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("المخالفة رقم 1")).toBeTruthy();
    expect(client.listForgottenStampInfractions).toHaveBeenCalledTimes(2);
  });

  it("shows access denied when the API answers 403", async () => {
    client.listForgottenStampInfractions.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden"));
    renderPage();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByText("ليست لديك صلاحية لعرض هذه الصفحة. إذا كنت تعتقد أن هذا خطأ، تواصل مع المالك في مؤسستك.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
    expect(screen.queryByText("Forbidden")).toBeNull();
  });
});
