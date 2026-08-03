import { describe, expect, it } from "vitest";
import { formatAgorot, formatMinutes, formatDateTime } from "../format";

describe("formatAgorot", () => {
  it("converts integer agorot to a shekel string with two decimals", () => {
    expect(formatAgorot(400000)).toBe("₪4,000.00");
    expect(formatAgorot(1000)).toBe("₪10.00");
    expect(formatAgorot(0)).toBe("₪0.00");
  });

  it("renders an em-dash for null/undefined instead of ₪0.00 (must not imply zero pay)", () => {
    expect(formatAgorot(null)).toBe("—");
    expect(formatAgorot(undefined)).toBe("—");
  });
});

describe("formatMinutes", () => {
  it("splits minutes into hours and minutes", () => {
    expect(formatMinutes(540)).toBe("9h 0m");
    expect(formatMinutes(615)).toBe("10h 15m");
    expect(formatMinutes(0)).toBe("0h 0m");
  });

  it("renders an em-dash for null/undefined", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(undefined)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("renders an em-dash for a missing timestamp", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("formats a real ISO timestamp into a non-empty display string", () => {
    const result = formatDateTime("2026-01-15T08:30:00.000Z");
    expect(result).not.toBe("—");
    expect(result.length).toBeGreaterThan(0);
  });
});
