import { describe, expect, it } from "vitest";
import { formatAgorot, formatBusinessDate, formatDate, formatDateTime, formatMinutes, formatMonth, formatNumber, formatTime } from "../format";

const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe("formatAgorot", () => {
  it("formats integer agorot as ₪ 1,234.50 in both languages", () => {
    expect(formatAgorot(123_450)).toBe("₪ 1,234.50");
    expect(formatAgorot(400_000)).toBe("₪ 4,000.00");
    expect(formatAgorot(1_000)).toBe("₪ 10.00");
    expect(formatAgorot(0)).toBe("₪ 0.00");
    expect(formatAgorot(5)).toBe("₪ 0.05");
    expect(formatAgorot(123_456_789)).toBe("₪ 1,234,567.89");
  });

  it("puts the minus sign before the symbol", () => {
    expect(formatAgorot(-1_000)).toBe("-₪ 10.00");
  });

  it("renders an em-dash for null/undefined instead of ₪ 0.00 (must not imply zero pay)", () => {
    expect(formatAgorot(null)).toBe("—");
    expect(formatAgorot(undefined)).toBe("—");
  });
});

describe("formatMinutes", () => {
  it("splits minutes into hours and minutes in each language", () => {
    expect(formatMinutes(615, "en")).toBe("10h 15m");
    expect(formatMinutes(540, "ar")).toBe("9 س 0 د");
    expect(formatMinutes(null, "ar")).toBe("—");
  });
});

describe("dates and times", () => {
  const winter = "2026-01-15T08:30:00.000Z"; // Asia/Jerusalem is UTC+2 in January
  const summer = "2026-07-15T08:30:00.000Z"; // and UTC+3 in July

  it("shows times in Asia/Jerusalem, 24-hour, Western digits", () => {
    expect(formatTime(winter, "en")).toBe("10:30");
    expect(formatTime(summer, "en")).toBe("11:30");
    expect(formatTime(winter, "ar")).toBe("10:30");
  });

  it("uses Western digits and Arabic month names in Arabic", () => {
    const text = formatDateTime(winter, "ar");
    expect(text).not.toMatch(ARABIC_INDIC);
    expect(text).toContain("2026");
    expect(text).toContain("10:30");
    expect(formatDate(winter, "ar")).toMatch(/[؀-ۿ]/);
    expect(formatNumber(1234567, "ar")).toBe("1,234,567");
  });

  it("uses English month names in English", () => {
    expect(formatDate(winter, "en")).toBe("Jan 15, 2026");
  });

  it("shows a business date (already a local calendar day) without shifting it", () => {
    expect(formatBusinessDate("2026-03-01", "en")).toBe("Mar 1, 2026");
    expect(formatBusinessDate("2026-03-01", "ar")).not.toMatch(ARABIC_INDIC);
    expect(formatBusinessDate("not-a-date", "en")).toBe("—");
  });

  it("formats a payroll month", () => {
    expect(formatMonth("2026-09", "en")).toBe("September 2026");
    expect(formatMonth("2026-09", "ar")).toContain("2026");
    expect(formatMonth("2026-09", "ar")).not.toMatch(ARABIC_INDIC);
    expect(formatMonth("2026-13", "ar")).toBe("—");
  });

  it("renders an em-dash for a missing timestamp", () => {
    expect(formatDateTime(null, "en")).toBe("—");
    expect(formatTime(undefined, "ar")).toBe("—");
  });
});
