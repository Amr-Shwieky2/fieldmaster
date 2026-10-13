import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { CostByWorker, TopEarners } from "../cost-by-worker";
import { FINANCIALS, WORKER_COSTS } from "./dashboard-fixtures";

/** The table's body rows as arrays of cell texts. */
function bodyRows(table: HTMLElement): string[][] {
  const [, ...rows] = within(table).getAllByRole("row");
  return rows.map((row) => Array.from(row.children).map((cell) => cell.textContent ?? ""));
}

describe("CostByWorker", () => {
  it("lists the 10 workers with the highest net payable: shifts, overtime, labor cost and net", () => {
    renderWithIntl(<CostByWorker workers={WORKER_COSTS} yearMonth="2026-10" />);

    const table = screen.getByRole("table", { name: "تكلفة العمل وصافي المستحق للعمال الأعلى أجراً في أكتوبر 2026" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual(["العامل", "الورديات", "الساعات الإضافية", "تكلفة العمل", "صافي المستحق"]);
    const rows = bodyRows(table);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual(["خالد ناصر", "22", "9 س 0 د", "₪ 9,800.00", "₪ 9,650.00"]);
    expect(rows[9]).toEqual(["هالة زيدان", "6", "0 س 0 د", "₪ 1,505.00", "₪ 1,500.00"]);
    // The 11th and 12th workers are left to the payroll page.
    expect(within(table).queryByText("نبيل جبران")).toBeNull();
    expect(within(table).queryByText("دينا سابا")).toBeNull();
    expect(screen.getByText("الأعلى حسب صافي المستحق: 10 من 12.")).toBeTruthy();
    // Worker names are row headers; money is isolated left-to-right.
    expect(within(table).getByRole("rowheader", { name: "خالد ناصر" })).toBeTruthy();
    expect(within(table).getByText("₪ 9,650.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(hasArabicIndicDigits(table.textContent)).toBe(false);
  });

  it("links to the month's payroll for every worker", () => {
    renderWithIntl(<CostByWorker workers={WORKER_COSTS} yearMonth="2026-10" />);
    expect(screen.getByRole("link", { name: "عرض كل العمال" }).getAttribute("href")).toBe("/payroll/2026-10");
  });

  it("orders by net payable even when the API order differs", () => {
    const shuffled = [WORKER_COSTS[4], WORKER_COSTS[0], WORKER_COSTS[2]];
    renderWithIntl(<CostByWorker workers={shuffled} yearMonth="2026-10" />);

    const table = screen.getByRole("table");
    expect(bodyRows(table).map((row) => row[0])).toEqual(["خالد ناصر", "يوسف عيسى", "أحمد سليمان"]);
    expect(screen.getByText("الأعلى حسب صافي المستحق: 3 من 3.")).toBeTruthy();
  });

  it("shows an empty state when nobody has pay this month", () => {
    renderWithIntl(<CostByWorker workers={[]} yearMonth="2026-10" />);
    expect(screen.getByText("لا توجد أجور هذا الشهر بعد")).toBeTruthy();
    expect(screen.getByText("تظهر هنا الأجور بعد الموافقة على الحضور.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/الأعلى حسب صافي المستحق/)).toBeNull();
  });
});

describe("TopEarners", () => {
  it("ranks the top earners by net payable", () => {
    renderWithIntl(<TopEarners workers={FINANCIALS.topEarners} />);

    const list = screen.getByRole("list", { name: "الأعلى أجراً" });
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "1خالد ناصر₪ 9,650.00",
      "2سلمى حداد₪ 8,700.00",
      "3يوسف عيسى₪ 7,550.00",
      "4مريم خوري₪ 6,400.00",
      "5أحمد سليمان₪ 5,300.00",
    ]);
    expect(within(items[0]).getByText("₪ 9,650.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("shows an empty state when nobody has pay this month", () => {
    renderWithIntl(<TopEarners workers={[]} />);
    expect(screen.getByRole("heading", { level: 2, name: "الأعلى أجراً" })).toBeTruthy();
    expect(screen.getByText("لا توجد أجور هذا الشهر بعد")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
