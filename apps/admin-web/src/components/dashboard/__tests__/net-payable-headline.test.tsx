import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { NetPayableHeadline, compareWithPreviousMonth } from "../net-payable-headline";
import { FINANCIALS, financials } from "./dashboard-fixtures";

/** The <dd> next to a <dt> label in the comparison list. */
function valueOf(label: string): HTMLElement {
  const value = screen.getByText(label).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value next to "${label}"`);
  return value;
}

/** True when the text sits in a left-to-right isolate (money and signed numbers inside Arabic). */
function isLtrIsolated(element: HTMLElement): boolean {
  return element.closest("bdi")?.getAttribute("dir") === "ltr";
}

describe("compareWithPreviousMonth", () => {
  it("returns the signed difference and the change relative to the previous month", () => {
    expect(compareWithPreviousMonth(1234567, 1000000)).toEqual({ differenceAgorot: 234567, changeRatio: 0.234567 });
    expect(compareWithPreviousMonth(800, 1000)).toEqual({ differenceAgorot: -200, changeRatio: -0.2 });
    // A negative previous month (deductions above pay) still reads as a rise when the month is higher.
    expect(compareWithPreviousMonth(500, -1000)).toEqual({ differenceAgorot: 1500, changeRatio: 1.5 });
  });

  it("does not divide by zero when the previous month is 0", () => {
    expect(compareWithPreviousMonth(100, 0)).toEqual({ differenceAgorot: 100, changeRatio: null });
    expect(compareWithPreviousMonth(0, 0)).toEqual({ differenceAgorot: 0, changeRatio: null });
  });
});

describe("NetPayableHeadline", () => {
  it("shows the month's net payable with its live source and the labor cost", () => {
    renderWithIntl(<NetPayableHeadline data={FINANCIALS} />);

    const headline = screen.getByRole("region", { name: "صافي المستحق للدفع في أكتوبر 2026" });
    const net = within(headline).getByText("₪ 12,345.67");
    expect(isLtrIsolated(net)).toBe(true);
    expect(within(headline).getByText("تقدير مباشر من الحضور المعتمد حتى الآن")).toBeTruthy();
    // A live estimate has no payroll version.
    expect(within(headline).queryByText(/الإصدار/)).toBeNull();
    const laborCost = within(headline).getByText("₪ 12,500.00");
    expect(isLtrIsolated(laborCost)).toBe(true);
    expect(laborCost.closest("p")?.textContent).toBe("تكلفة العمل (الأجر الأساسي والساعات الإضافية): ₪ 12,500.00");
  });

  it("names the finalized version the figures come from", () => {
    renderWithIntl(<NetPayableHeadline data={financials({ source: "FINALIZED", finalizedVersion: 3 })} />);

    const headline = screen.getByRole("region", { name: "صافي المستحق للدفع في أكتوبر 2026" });
    expect(within(headline).getByText("من الرواتب المعتمدة نهائياً")).toBeTruthy();
    expect(within(headline).getByText("الإصدار 3")).toBeTruthy();
    expect(within(headline).queryByText("تقدير مباشر من الحضور المعتمد حتى الآن")).toBeNull();
  });

  it("compares with the previous month: its amount and source, the signed difference and the change with one decimal", () => {
    renderWithIntl(<NetPayableHeadline data={FINANCIALS} />);

    const comparison = screen.getByRole("region", { name: "مقارنة بشهر سبتمبر 2026" });
    const previous = valueOf("صافي الشهر السابق");
    expect(within(previous).getByText("₪ 10,000.00")).toBeTruthy();
    expect(within(previous).getByText("من الرواتب المعتمدة نهائياً")).toBeTruthy();
    // 12,345.67 - 10,000.00 = +2,345.67, i.e. +23.4567% shown as +23.5%.
    expect(valueOf("الفرق").textContent).toBe("+₪ 2,345.67");
    expect(isLtrIsolated(within(valueOf("الفرق")).getByText("+₪ 2,345.67"))).toBe(true);
    expect(valueOf("نسبة التغيير").textContent).toBe("+23.5%");
    expect(isLtrIsolated(within(valueOf("نسبة التغيير")).getByText("+23.5%"))).toBe(true);
    expect(within(comparison).queryByText("لا توجد أرقام للمقارنة: صافي الشهر السابق صفر.")).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("shows a decrease as a negative difference and change", () => {
    const data = financials({ previousMonth: { ...FINANCIALS.previousMonth, netPayableAgorot: 1500000 } });
    renderWithIntl(<NetPayableHeadline data={data} />);

    expect(within(valueOf("صافي الشهر السابق")).getByText("₪ 15,000.00")).toBeTruthy();
    // 12,345.67 - 15,000.00 = -2,654.33, i.e. -17.6955% shown as -17.7%.
    expect(valueOf("الفرق").textContent).toBe("-₪ 2,654.33");
    expect(valueOf("نسبة التغيير").textContent).toBe("-17.7%");
  });

  it("shows no sign when the month equals the previous one", () => {
    const data = financials({ previousMonth: { ...FINANCIALS.previousMonth, netPayableAgorot: FINANCIALS.netPayableAgorot } });
    renderWithIntl(<NetPayableHeadline data={data} />);

    expect(valueOf("الفرق").textContent).toBe("₪ 0.00");
    expect(valueOf("نسبة التغيير").textContent).toBe("0.0%");
  });

  it("says there is nothing to compare when the previous month is 0, instead of dividing by zero", () => {
    const data = financials({ previousMonth: { yearMonth: "2026-09", source: "LIVE", netPayableAgorot: 0, laborCostAgorot: 0 } });
    renderWithIntl(<NetPayableHeadline data={data} />);

    const comparison = screen.getByRole("region", { name: "مقارنة بشهر سبتمبر 2026" });
    expect(within(valueOf("صافي الشهر السابق")).getByText("₪ 0.00")).toBeTruthy();
    expect(within(comparison).getByText("تقدير مباشر من الحضور المعتمد حتى الآن")).toBeTruthy();
    expect(within(comparison).getByText("لا توجد أرقام للمقارنة: صافي الشهر السابق صفر.")).toBeTruthy();
    expect(within(comparison).queryByText("الفرق")).toBeNull();
    expect(within(comparison).queryByText("نسبة التغيير")).toBeNull();
    expect(comparison.textContent).not.toMatch(/%|Infinity|NaN/);
  });
});
