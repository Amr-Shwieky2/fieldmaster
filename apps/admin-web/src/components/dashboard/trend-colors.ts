/**
 * Colors of the daily labor cost chart, shared with its HTML legend. Kept out
 * of the chart module so the legend does not pull Recharts into the page's
 * bundle (the chart itself is loaded with next/dynamic).
 *
 * A spike day is drawn with its own pair of colors (both parts of the bar),
 * so the highlight does not depend on the size of its overtime part.
 */
export const TREND_COLORS = {
  base: "#2563eb",
  overtime: "#d97706",
  spikeBase: "#f87171",
  spikeOvertime: "#b91c1c",
} as const;

/** Drawn above a spike day's bar and in the legend, so the highlight does not rely on color alone. */
export const SPIKE_MARKER = "▲";
