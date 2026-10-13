import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { DashboardDay } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";
import { hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { DailyTrendChart, TrendTooltip, dayOfMonth, moneyTick, toTrendRows, type TrendRow } from "../daily-trend-chart";
import { SPIKE_MARKER, TREND_COLORS } from "../trend-colors";
import { DAILY_TREND } from "./dashboard-fixtures";

const LABEL = "مخطط أعمدة لتكلفة العمل اليومية في أكتوبر 2026، أول أيام الشهر على اليمين";
const ORDINARY_DAY = DAILY_TREND[1];
const SPIKE_DAY = DAILY_TREND[6];

/**
 * jsdom has no layout and no ResizeObserver, so Recharts' ResponsiveContainer measures nothing and
 * draws nothing. This stand-in reports a fixed 720 x 288 box as soon as it observes the container.
 */
class FixedSizeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 720, height: 288 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

/** `prefers-reduced-motion: reduce`: Recharts then draws the bars at once instead of animating them. */
function reducedMotionMatchMedia(query: string) {
  return {
    matches: query.includes("prefers-reduced-motion: reduce"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
}

function renderChart(days: DashboardDay[] = DAILY_TREND) {
  return renderWithIntl(
    <div dir="ltr">
      <DailyTrendChart days={days} label={LABEL} />
    </div>,
  );
}

/** The SVG paths Recharts drew in a color. */
function barsIn(container: HTMLElement, color: string): Element[] {
  return Array.from(container.querySelectorAll(`.recharts-bar path[fill="${color}"]`));
}

function tickTexts(container: HTMLElement, axis: "xAxis" | "yAxis"): SVGTextElement[] {
  return Array.from(container.querySelectorAll<SVGTextElement>(`.recharts-${axis}-tick-labels text`));
}

describe("toTrendRows", () => {
  it("splits an ordinary day into base pay and overtime", () => {
    expect(toTrendRows([ORDINARY_DAY])).toEqual([
      { date: "2026-10-02", base: 165200, overtime: 15000, spikeBase: 0, spikeOvertime: 0, overtimeMarker: null, baseMarker: null, day: ORDINARY_DAY },
    ]);
  });

  it("puts a spike day in the spike series, marked on the top of its bar", () => {
    expect(toTrendRows([SPIKE_DAY])).toEqual([
      { date: "2026-10-07", base: 0, overtime: 0, spikeBase: 188100, spikeOvertime: 52500, overtimeMarker: SPIKE_MARKER, baseMarker: null, day: SPIKE_DAY },
    ]);
    // Without overtime cost the base part is the top of the bar, so it carries the mark.
    const noOvertimeCost = { ...SPIKE_DAY, overtimeAgorot: 0 };
    expect(toTrendRows([noOvertimeCost])[0]).toMatchObject({ spikeBase: 240600, spikeOvertime: 0, overtimeMarker: null, baseMarker: SPIKE_MARKER });
  });
});

describe("axis labels", () => {
  it("labels days with the day of the month and amounts in shekels without a trailing .00", () => {
    expect(dayOfMonth("2026-10-07")).toBe(7);
    expect(dayOfMonth("2026-10-31")).toBe(31);
    expect(moneyTick("₪ 3,000.00")).toBe("₪\u00a03,000");
    expect(moneyTick("₪ 1,234.50")).toBe("₪\u00a01,234.50");
    expect(moneyTick("₪ 0.00")).toBe("₪\u00a00");
  });
});

describe("TrendTooltip", () => {
  const payload = (row: TrendRow) => [{ payload: row }] as unknown as Parameters<typeof TrendTooltip>[0]["payload"];

  it("shows the day, its amounts and the spike in Arabic, right to left", () => {
    renderWithIntl(<TrendTooltip active payload={payload(toTrendRows([SPIKE_DAY])[0])} />);

    const tooltip = screen.getByTestId("trend-tooltip");
    expect(tooltip.getAttribute("dir")).toBe("rtl");
    expect(screen.getByText("7 أكتوبر 2026")).toBeTruthy();
    expect(screen.getByText("تكلفة العمل").nextElementSibling?.textContent).toBe("₪ 2,406.00");
    expect(screen.getByText("منها الساعات الإضافية").nextElementSibling?.textContent).toBe("₪ 525.00");
    expect(screen.getByText("مدة الساعات الإضافية").nextElementSibling?.textContent).toBe("7 س 0 د");
    expect(screen.getByText("₪ 2,406.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("يوم ارتفاع حاد في الساعات الإضافية")).toBeTruthy();
    expect(hasArabicIndicDigits(tooltip.textContent)).toBe(false);
  });

  it("does not mention a spike on an ordinary day", () => {
    renderWithIntl(<TrendTooltip active payload={payload(toTrendRows([ORDINARY_DAY])[0])} />);
    expect(screen.getByText("2 أكتوبر 2026")).toBeTruthy();
    expect(screen.queryByText("يوم ارتفاع حاد في الساعات الإضافية")).toBeNull();
  });

  it("renders nothing while inactive", () => {
    const { container } = renderWithIntl(<TrendTooltip active={false} payload={payload(toTrendRows([SPIKE_DAY])[0])} />);
    expect(container.textContent).toBe("");
  });
});

describe("DailyTrendChart", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error");
    consoleWarn = vi.spyOn(console, "warn");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("with a measured size", () => {
    beforeEach(() => {
      vi.stubGlobal("ResizeObserver", FixedSizeResizeObserver);
      vi.stubGlobal("matchMedia", reducedMotionMatchMedia);
    });

    it("draws an SVG chart with its accessible name", () => {
      renderChart();
      const svg = screen.getByRole("img", { name: LABEL });
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    });

    it("draws base pay and overtime as stacked bars, and the spike day in its own colors with a mark", () => {
      const { container } = renderChart();
      // Days 1, 2, 4, 5 and 6 have base pay; 2, 4 and 6 have overtime; the 3rd has no cost at all.
      expect(barsIn(container, TREND_COLORS.base)).toHaveLength(5);
      expect(barsIn(container, TREND_COLORS.overtime)).toHaveLength(3);
      // The 7th (the spike) is drawn in the spike colors only, with one mark above it.
      expect(barsIn(container, TREND_COLORS.spikeBase)).toHaveLength(1);
      expect(barsIn(container, TREND_COLORS.spikeOvertime)).toHaveLength(1);
      expect(Array.from(container.querySelectorAll(".recharts-label")).map((label) => label.textContent)).toEqual([SPIKE_MARKER]);
    });

    it("marks a spike day that has no overtime cost on its base part", () => {
      const { container } = renderChart([DAILY_TREND[0], { ...SPIKE_DAY, overtimeAgorot: 0 }]);
      expect(barsIn(container, TREND_COLORS.spikeBase)).toHaveLength(1);
      expect(barsIn(container, TREND_COLORS.spikeOvertime)).toHaveLength(0);
      expect(Array.from(container.querySelectorAll(".recharts-label")).map((label) => label.textContent)).toEqual([SPIKE_MARKER]);
    });

    it("labels the axes with Western digits: the day of the month, and shekel amounts on the right", () => {
      const { container } = renderChart();
      expect(tickTexts(container, "xAxis").map((text) => text.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
      const amounts = tickTexts(container, "yAxis");
      expect(amounts.length).toBeGreaterThan(1);
      for (const amount of amounts) {
        expect(amount.textContent).toMatch(/^₪\u00a0[\d,]+$/);
        expect(amount.getAttribute("orientation")).toBe("right");
      }
      expect(hasArabicIndicDigits(container.textContent)).toBe(false);
    });

    it("runs right to left: the first day of the month is drawn to the right of the last", () => {
      const { container } = renderChart();
      const days = tickTexts(container, "xAxis");
      // Relative order only (no exact coordinates): the reversed axis puts day 1 at the right end.
      expect(Number(days[0].getAttribute("x"))).toBeGreaterThan(Number(days[days.length - 1].getAttribute("x")));
    });
  });

  it("draws nothing (and does not fail) until its container has been measured", () => {
    // Plain jsdom: no ResizeObserver, so there is no size to draw at.
    const { container } = renderChart();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
