import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import type { DashboardDay } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";
import { hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { DailyTrend } from "../daily-trend";
import { DAILY_TREND } from "./dashboard-fixtures";

// Recharts stays out of this test (the chart has its own, daily-trend-chart.test.tsx): the dynamically
// loaded chart is a stub that keeps the props it was given. The legend and the table are real.
type ChartProps = { days: DashboardDay[]; label: string };
const chart = vi.hoisted(() => ({ props: null as ChartProps | null }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DailyTrendChartStub(props: ChartProps) {
      chart.props = props;
      return <div data-testid="chart-stub" />;
    },
}));

/** The data table's body rows as arrays of cell texts. */
function bodyRows(table: HTMLElement): string[][] {
  const [, ...rows] = within(table).getAllByRole("row");
  return rows.map((row) => Array.from(row.children).map((cell) => cell.textContent ?? ""));
}

const NO_SPIKES = DAILY_TREND.map((day) => ({ ...day, isOvertimeSpike: false }));

describe("DailyTrend", () => {
  beforeEach(() => {
    chart.props = null;
  });

  it("renders the chart region with an accessible name, the chart in a left-to-right box and its legend", () => {
    renderWithIntl(<DailyTrend days={DAILY_TREND} yearMonth="2026-10" />);

    const figure = screen.getByRole("figure", { name: "تكلفة العمل اليومية" });
    expect(screen.getByText("تكلفة العمل في كل يوم من أكتوبر 2026 حتى اليوم، بالأجر الأساسي والساعات الإضافية.")).toBeTruthy();
    // The chart gets every day and its own accessible name, inside a box that is laid out left to right.
    const box = within(figure).getByTestId("daily-trend-chart");
    expect(box.getAttribute("dir")).toBe("ltr");
    expect(within(box).getByTestId("chart-stub")).toBeTruthy();
    expect(chart.props?.days).toEqual(DAILY_TREND);
    expect(chart.props?.label).toBe("مخطط أعمدة لتكلفة العمل اليومية في أكتوبر 2026، أول أيام الشهر على اليمين");
    // The legend describes the figure; spike days are marked by color and by a triangle.
    const legend = within(figure).getByRole("list", { name: "مفتاح المخطط" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["الأجر الأساسي", "الساعات الإضافية", "▲يوم ارتفاع حاد في الساعات الإضافية"]);
    const description = document.getElementById(figure.getAttribute("aria-describedby") ?? "");
    expect(description?.contains(legend)).toBe(true);
    expect(within(figure).getByText("الأعمدة الحمراء المعلَّمة بمثلث هي أيام الارتفاع الحاد، وتفاصيلها في أسفل الصفحة.")).toBeTruthy();
  });

  it("gives the same figures as a table, with the spike day marked", () => {
    renderWithIntl(<DailyTrend days={DAILY_TREND} yearMonth="2026-10" />);

    expect(screen.getByText("عرض البيانات كجدول").tagName).toBe("SUMMARY");
    const table = screen.getByRole("table", { name: "تكلفة العمل اليومية في أكتوبر 2026" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["اليوم", "تكلفة العمل", "منها الساعات الإضافية", "مدة الساعات الإضافية", "ملاحظة"]);
    const rows = bodyRows(table);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual(["1 أكتوبر 2026", "₪ 1,501.00", "₪ 0.00", "0 س 0 د", ""]);
    expect(rows[1]).toEqual(["2 أكتوبر 2026", "₪ 1,802.00", "₪ 150.00", "1 س 0 د", ""]);
    expect(rows[6]).toEqual(["7 أكتوبر 2026", "₪ 2,406.00", "₪ 525.00", "7 س 0 د", "ارتفاع حاد"]);
    // Only the spike day is marked.
    expect(rows.filter((row) => row[4] === "ارتفاع حاد")).toHaveLength(1);
    expect(within(table).getByRole("rowheader", { name: "7 أكتوبر 2026" })).toBeTruthy();
    expect(within(table).getByText("₪ 2,406.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(hasArabicIndicDigits(table.textContent)).toBe(false);
  });

  it("has no spike note or marks when no day is a spike", () => {
    renderWithIntl(<DailyTrend days={NO_SPIKES} yearMonth="2026-10" />);

    expect(screen.queryByText(/الأعمدة الحمراء/)).toBeNull();
    expect(screen.queryByText("ارتفاع حاد")).toBeNull();
    // The legend still explains the colors.
    expect(screen.getByRole("list", { name: "مفتاح المخطط" })).toBeTruthy();
  });

  it("shows an empty state and no chart when the month has no days yet", () => {
    renderWithIntl(<DailyTrend days={[]} yearMonth="2026-10" />);

    expect(screen.getByRole("heading", { level: 2, name: "تكلفة العمل اليومية" })).toBeTruthy();
    expect(screen.getByText("لا توجد أيام عمل بعد هذا الشهر")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(chart.props).toBeNull();
  });
});
