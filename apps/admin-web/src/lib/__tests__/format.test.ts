import { describe, expect, it } from "vitest";
import { createFormatter, formatAgorot, formatBusinessDate, formatDate, formatDateTime, formatMinutes, formatMonth, formatNumber, formatTime } from "../format";

const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe("formatAgorot", () => {
  it("formats integer agorot as ₪ 1,234.50", () => {
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
  it("splits minutes into hours and minutes in Arabic", () => {
    expect(formatMinutes(615)).toBe("10 س 15 د");
    expect(formatMinutes(540)).toBe("9 س 0 د");
    expect(formatMinutes(0)).toBe("0 س 0 د");
    expect(formatMinutes(-90)).toBe("-1 س 30 د");
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(undefined)).toBe("—");
  });
});

describe("formatNumber", () => {
  it("uses Western digits with comma grouping", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(12.5, { maximumFractionDigits: 1 })).toBe("12.5");
    expect(formatNumber(null)).toBe("—");
  });
});

describe("dates and times", () => {
  const winter = "2026-01-15T08:30:00.000Z"; // Asia/Jerusalem is UTC+2 in January
  const summer = "2026-07-15T08:30:00.000Z"; // and UTC+3 in July

  it("shows times in Asia/Jerusalem, 24-hour, Western digits", () => {
    expect(formatTime(winter)).toBe("10:30");
    expect(formatTime(summer)).toBe("11:30");
  });

  it("spells out the Arabic month with Western digits", () => {
    expect(formatDate(winter)).toBe("15 يناير 2026");
    expect(formatDateTime(winter)).toBe("15 يناير 2026 في 10:30");
    expect(formatDateTime(summer)).not.toMatch(ARABIC_INDIC);
  });

  it("shows a business date (already a local calendar day) without shifting it", () => {
    expect(formatBusinessDate("2026-03-01")).toBe("1 مارس 2026");
    expect(formatBusinessDate("not-a-date")).toBe("—");
  });

  it("formats a payroll month", () => {
    expect(formatMonth("2026-09")).toBe("سبتمبر 2026");
    expect(formatMonth("2026-13")).toBe("—");
  });

  it("renders an em-dash for a missing timestamp", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatTime(undefined)).toBe("—");
  });
});

describe("createFormatter", () => {
  it("bundles the same Arabic formatters", () => {
    const fmt = createFormatter();
    expect(fmt.money(123_450)).toBe("₪ 1,234.50");
    expect(fmt.minutes(615)).toBe("10 س 15 د");
    expect(fmt.month("2026-09")).toBe("سبتمبر 2026");
    expect(fmt.dateTime("2026-01-15T08:30:00.000Z")).toBe("15 يناير 2026 في 10:30");
  });
});
