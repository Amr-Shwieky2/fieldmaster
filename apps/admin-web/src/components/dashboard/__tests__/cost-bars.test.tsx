import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { CostByProject, CostBySite } from "../cost-bars";
import { FINANCIALS } from "./dashboard-fixtures";

/** The bars of a list, in order, as their inline width. */
function barWidths(list: HTMLElement): string[] {
  return within(list)
    .getAllByTestId("cost-bar-track")
    .map((track) => (track.firstElementChild as HTMLElement).style.width);
}

/** The visible rows of a bar list: label, details and amount. */
function rows(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("CostByProject", () => {
  it("lists the labor cost per project with shifts and overtime, the bucket without a project in Arabic", () => {
    renderWithIntl(<CostByProject items={FINANCIALS.costByProject} />);

    const list = screen.getByRole("list", { name: "التكلفة حسب المشروع" });
    expect(screen.getByRole("heading", { level: 2, name: "التكلفة حسب المشروع" })).toBeTruthy();
    expect(rows(list)).toEqual(["Highway 6 signsالورديات: 40·منها ساعات إضافية: ₪ 600.00₪ 8,000.00", "بدون مشروعالورديات: 2₪ 2,000.00"]);
    expect(within(list).getByText("₪ 8,000.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("never shows a name the API sends for the bucket without a project", () => {
    renderWithIntl(<CostByProject items={[{ id: null, name: "Unassigned", approvedShifts: 1, laborCostAgorot: 5000, overtimeAgorot: 0 }]} />);
    expect(screen.getByText("بدون مشروع")).toBeTruthy();
    expect(screen.queryByText("Unassigned")).toBeNull();
  });

  it("draws the bars from the inline-start edge, relative to the most expensive project, highest first", () => {
    const items = [
      { id: "p2", name: "مشروع صغير", approvedShifts: 5, laborCostAgorot: 200000, overtimeAgorot: 0 },
      { id: "p1", name: "مشروع كبير", approvedShifts: 40, laborCostAgorot: 800000, overtimeAgorot: 0 },
    ];
    renderWithIntl(<CostByProject items={items} />);

    const list = screen.getByRole("list", { name: "التكلفة حسب المشروع" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("p")?.textContent),
    ).toEqual(["مشروع كبير", "مشروع صغير"]);
    expect(barWidths(list)).toEqual(["100%", "25%"]);
    // Bars are blocks inside a full-width track: no physical left/right positioning that would break in RTL.
    for (const track of within(list).getAllByTestId("cost-bar-track")) {
      const bar = track.firstElementChild as HTMLElement;
      expect(bar.style.left).toBe("");
      expect(bar.style.right).toBe("");
      expect(track.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("draws empty bars when every cost is 0", () => {
    renderWithIntl(<CostByProject items={[{ id: "p1", name: "مشروع", approvedShifts: 1, laborCostAgorot: 0, overtimeAgorot: 0 }]} />);
    expect(barWidths(screen.getByRole("list", { name: "التكلفة حسب المشروع" }))).toEqual(["0%"]);
  });

  it("shows an empty state when no project has costs yet", () => {
    renderWithIntl(<CostByProject items={[]} />);
    expect(screen.getByText("لا توجد تكاليف بعد")).toBeTruthy();
    expect(screen.getByText("لا توجد هذا الشهر بعد ورديات تمت الموافقة عليها واحتُسبت تكلفتها.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("CostBySite", () => {
  it("lists the labor cost per site with its project, the bucket without a site in Arabic", () => {
    renderWithIntl(<CostBySite items={FINANCIALS.costBySite} />);

    const list = screen.getByRole("list", { name: "التكلفة حسب الموقع" });
    expect(rows(list)).toEqual([
      "تقاطع الشمالالمشروع: Highway 6 signs·الورديات: 30·منها ساعات إضافية: ₪ 450.00₪ 6,000.00",
      "جسر الواديالمشروع: Highway 6 signs·الورديات: 10·منها ساعات إضافية: ₪ 150.00₪ 2,001.00",
      "بدون موقعالورديات: 2₪ 1,999.00",
    ]);
    expect(barWidths(list)).toEqual(["100%", "33%", "33%"]);
  });

  it("shows a site without a project without a project line", () => {
    renderWithIntl(
      <CostBySite items={[{ id: "s9", name: "ساحة التخزين", projectName: null, approvedShifts: 1234, laborCostAgorot: 10000, overtimeAgorot: 0 }]} />,
    );
    const list = screen.getByRole("list", { name: "التكلفة حسب الموقع" });
    // Large counts are grouped with Western digits.
    expect(rows(list)).toEqual(["ساحة التخزينالورديات: 1,234₪ 100.00"]);
    expect(within(list).queryByText(/المشروع:/)).toBeNull();
  });

  it("shows an empty state when no site has costs yet", () => {
    renderWithIntl(<CostBySite items={[]} />);
    expect(screen.getByRole("heading", { level: 2, name: "التكلفة حسب الموقع" })).toBeTruthy();
    expect(screen.getByText("لا توجد تكاليف بعد")).toBeTruthy();
  });
});
