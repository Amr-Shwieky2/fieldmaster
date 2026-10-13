import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { FinancialStatCards } from "../financial-stat-cards";
import { FINANCIALS, financials } from "./dashboard-fixtures";

/** A stat card's value and hint, found from its label. */
function card(label: string): { value: HTMLElement; hint: HTMLElement | null } {
  const value = screen.getByText(label).nextElementSibling as HTMLElement;
  return { value, hint: value.nextElementSibling as HTMLElement | null };
}

describe("FinancialStatCards", () => {
  it("shows the overtime cost with its duration", () => {
    renderWithIntl(<FinancialStatCards data={FINANCIALS} />);
    const { value, hint } = card("تكلفة الساعات الإضافية");
    expect(value.textContent).toBe("₪ 980.50");
    expect(value.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(hint?.textContent).toBe("المدة: 17 س 0 د");
  });

  it("shows the net forgotten-stamp deductions with the number of penalties and of reversals", () => {
    renderWithIntl(<FinancialStatCards data={FINANCIALS} />);
    const { value, hint } = card("خصومات نسيان تسجيل");
    expect(value.textContent).toBe("₪ 150.00");
    expect(hint?.textContent).toBe("عدد الخصومات: 3 · خصومات أُلغيت: 1");
  });

  it("shows the emergency call-out cost with the number of call-outs and the compensated time", () => {
    renderWithIntl(<FinancialStatCards data={FINANCIALS} />);
    const { value, hint } = card("تكلفة استدعاءات الطوارئ");
    expect(value.textContent).toBe("₪ 640.00");
    expect(hint?.textContent).toBe("عدد الاستدعاءات: 2 · المدة المحتسبة: 5 س 30 د");
  });

  it("shows what the attendance waiting for approval would cost, and the entries left out for having no rate", () => {
    renderWithIntl(<FinancialStatCards data={FINANCIALS} />);
    const { value, hint } = card("تقدير تكلفة الحضور بانتظار الموافقة");
    expect(value.textContent).toBe("₪ 4,321.00");
    expect(hint?.textContent).toBe("عدد السجلات: 3منها سجل واحد بلا أجر مسجّل، فلا يدخل في التقدير.");
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("uses the Arabic plural for the entries without a rate, and leaves the note out when there are none", () => {
    const pending = FINANCIALS.pendingApproval;
    const { rerender } = renderWithIntl(<FinancialStatCards data={financials({ pendingApproval: { ...pending, entriesWithoutCompensation: 2 } })} />);
    expect(screen.getByText("منها سجلان بلا أجر مسجّل، فلا يدخلان في التقدير.")).toBeTruthy();

    rerender(<FinancialStatCards data={financials({ pendingApproval: { ...pending, entriesWithoutCompensation: 5 } })} />);
    expect(screen.getByText("منها 5 سجلات بلا أجر مسجّل، فلا تدخل في التقدير.")).toBeTruthy();

    rerender(<FinancialStatCards data={financials({ pendingApproval: { ...pending, entriesWithoutCompensation: 0 } })} />);
    expect(card("تقدير تكلفة الحضور بانتظار الموافقة").hint?.textContent).toBe("عدد السجلات: 3");
    expect(screen.queryByText(/بلا أجر مسجّل/)).toBeNull();
  });

  it("shows zero amounts as ₪ 0.00 rather than leaving a card empty", () => {
    const data = financials({
      overtime: { ...FINANCIALS.overtime, totalAgorot: 0, totalMinutes: 0 },
      forgottenStamps: { penalties: 0, penaltiesAgorot: 0, reversals: 0, reversalsAgorot: 0, netDeductionsAgorot: 0 },
      emergencies: { callouts: 0, compensatedMinutes: 0, costAgorot: 0 },
      pendingApproval: { entries: 0, exposureAgorot: 0, entriesWithoutCompensation: 0 },
    });
    renderWithIntl(<FinancialStatCards data={data} />);
    expect(screen.getAllByText("₪ 0.00")).toHaveLength(4);
    expect(card("تكلفة الساعات الإضافية").hint?.textContent).toBe("المدة: 0 س 0 د");
    expect(card("خصومات نسيان تسجيل").hint?.textContent).toBe("عدد الخصومات: 0 · خصومات أُلغيت: 0");
  });
});
