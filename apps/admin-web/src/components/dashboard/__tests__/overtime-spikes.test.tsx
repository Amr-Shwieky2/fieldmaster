import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { OvertimeSpikes } from "../overtime-spikes";
import { FINANCIALS } from "./dashboard-fixtures";

const RULE = "يوم ارتفاع حاد: دقائق الساعات الإضافية في اليوم (لكل العمال معًا) لا تقل عن 2 أضعاف المعدل اليومي (1 س 30 د) ولا عن 2 س 0 د.";

describe("OvertimeSpikes", () => {
  it("explains the spike rule from the API's own factor, daily average and minimum", () => {
    renderWithIntl(<OvertimeSpikes overtime={FINANCIALS.overtime} />);
    expect(screen.getByRole("heading", { level: 2, name: "أيام الارتفاع الحاد في الساعات الإضافية" })).toBeTruthy();
    expect(screen.getByText(/^يوم ارتفاع حاد:/).textContent).toBe(RULE);
  });

  it("lists each spike day with its overtime, cost, threshold and the workers who made it", () => {
    renderWithIntl(<OvertimeSpikes overtime={FINANCIALS.overtime} />);

    const [spike] = screen.getAllByTestId("overtime-spike");
    expect(within(spike).getByRole("heading", { level: 3, name: "7 أكتوبر 2026" })).toBeTruthy();
    expect(within(spike).getByText("الساعات الإضافية").nextElementSibling?.textContent).toBe("7 س 0 د");
    expect(within(spike).getByText("تكلفتها").nextElementSibling?.textContent).toBe("₪ 525.00");
    expect(within(spike).getByText("₪ 525.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(within(spike).getByText("حد الارتفاع في هذا اليوم").nextElementSibling?.textContent).toBe("3 س 0 د");
    const workers = within(spike).getByRole("list", { name: "عمال الساعات الإضافية في 7 أكتوبر 2026" });
    expect(
      within(workers)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["خالد ناصر: 4 س 0 د", "سلمى حداد: 3 س 0 د"]);
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("lists several spike days in the API's order", () => {
    const second = { date: "2026-10-12", overtimeMinutes: 200, overtimeAgorot: 30000, thresholdMinutes: 180, workers: [] };
    renderWithIntl(<OvertimeSpikes overtime={{ ...FINANCIALS.overtime, spikes: [...FINANCIALS.overtime.spikes, second] }} />);

    const spikes = screen.getAllByTestId("overtime-spike");
    expect(spikes.map((spike) => within(spike).getByRole("heading", { level: 3 }).textContent)).toEqual(["7 أكتوبر 2026", "12 أكتوبر 2026"]);
    // A day without per-worker detail has no workers list.
    expect(within(spikes[1]).queryByRole("list")).toBeNull();
  });

  it("writes a fractional factor with Western digits", () => {
    renderWithIntl(<OvertimeSpikes overtime={{ ...FINANCIALS.overtime, spikeFactor: 1.5, averageDailyMinutes: 45, spikeMinimumMinutes: 60 }} />);
    expect(screen.getByText(/^يوم ارتفاع حاد:/).textContent).toBe(
      "يوم ارتفاع حاد: دقائق الساعات الإضافية في اليوم (لكل العمال معًا) لا تقل عن 1.5 أضعاف المعدل اليومي (0 س 45 د) ولا عن 1 س 0 د.",
    );
  });

  it("shows an empty state when no day reached the threshold, keeping the rule", () => {
    renderWithIntl(<OvertimeSpikes overtime={{ ...FINANCIALS.overtime, spikes: [] }} />);
    expect(screen.getByText("لا توجد أيام ارتفاع حاد هذا الشهر")).toBeTruthy();
    expect(screen.getByText("لم تبلغ الساعات الإضافية في أي يوم حد الارتفاع.")).toBeTruthy();
    expect(screen.getByText(/^يوم ارتفاع حاد:/).textContent).toBe(RULE);
    expect(screen.queryAllByTestId("overtime-spike")).toHaveLength(0);
  });
});
