import { describe, expect, it } from "vitest";
import { fromJerusalemInputValue, monthDateRange, shiftYearMonth, toJerusalemInputValue } from "../jerusalem-time";

describe("Asia/Jerusalem date/time input values", () => {
  it("shows an instant as Jerusalem wall-clock time, summer (UTC+3) and winter (UTC+2)", () => {
    expect(toJerusalemInputValue("2026-07-15T04:30:00.000Z")).toBe("2026-07-15T07:30");
    expect(toJerusalemInputValue("2026-12-15T05:30:00.000Z")).toBe("2026-12-15T07:30");
    // Past midnight in Jerusalem while still the previous day in UTC.
    expect(toJerusalemInputValue("2026-12-31T22:30:00.000Z")).toBe("2027-01-01T00:30");
  });

  it("reads a Jerusalem wall-clock value back as the right instant, whatever the browser's zone", () => {
    expect(fromJerusalemInputValue("2026-07-15T07:30")?.toISOString()).toBe("2026-07-15T04:30:00.000Z");
    expect(fromJerusalemInputValue("2026-12-15T07:30")?.toISOString()).toBe("2026-12-15T05:30:00.000Z");
    // The day DST ends (2026-10-25): before and after 02:00.
    expect(fromJerusalemInputValue("2026-10-24T23:00")?.toISOString()).toBe("2026-10-24T20:00:00.000Z");
    expect(fromJerusalemInputValue("2026-10-25T09:00")?.toISOString()).toBe("2026-10-25T07:00:00.000Z");
    for (const iso of ["2026-03-01T10:15:00.000Z", "2026-06-30T21:45:00.000Z", "2026-11-02T06:00:00.000Z"]) {
      expect(fromJerusalemInputValue(toJerusalemInputValue(iso))?.toISOString()).toBe(iso);
    }
  });

  it("rejects malformed values", () => {
    expect(fromJerusalemInputValue("")).toBeNull();
    expect(fromJerusalemInputValue("2026-07-15 07:30")).toBeNull();
  });

  it("moves between months and gives a month's first and last business date", () => {
    expect(shiftYearMonth("2026-10", -1)).toBe("2026-09");
    expect(shiftYearMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
    expect(monthDateRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthDateRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthDateRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});
