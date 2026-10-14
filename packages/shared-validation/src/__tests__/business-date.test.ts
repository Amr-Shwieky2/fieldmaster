import { businessMonthDates, getBusinessMonthRange, toBusinessDate, toBusinessYearMonth } from "../business-date";

describe("toBusinessDate / toBusinessYearMonth (Asia/Jerusalem)", () => {
  it("rolls a late-night UTC timestamp to the next local calendar day (IDT, UTC+3)", () => {
    // 22:30 UTC on Aug 3 -> 01:30 local on Aug 4 (summer DST, UTC+3)
    const date = new Date("2026-08-03T22:30:00Z");
    expect(toBusinessDate(date)).toBe("2026-08-04");
    expect(toBusinessYearMonth(date)).toBe("2026-08");
  });

  it("keeps a daytime UTC timestamp on the same local calendar day", () => {
    const date = new Date("2026-08-03T10:00:00Z");
    expect(toBusinessDate(date)).toBe("2026-08-03");
  });

  it("rolls a winter UTC timestamp across midnight (IST, UTC+2)", () => {
    // 22:00 UTC Dec 31 -> 00:00 local Jan 1 (winter, UTC+2)
    const date = new Date("2026-12-31T22:00:00Z");
    expect(toBusinessDate(date)).toBe("2027-01-01");
  });
});

describe("getBusinessMonthRange", () => {
  it("computes UTC bounds for a summer (DST) Asia/Jerusalem month", () => {
    const range = getBusinessMonthRange("2026-08");
    expect(range.startUtc.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(range.endUtc.toISOString()).toBe("2026-08-31T21:00:00.000Z");
  });

  it("produces a range whose local business dates fall entirely within the target month", () => {
    const range = getBusinessMonthRange("2026-08");
    expect(toBusinessDate(range.startUtc)).toBe("2026-08-01");
    const justBeforeEnd = new Date(range.endUtc.getTime() - 60_000);
    expect(toBusinessDate(justBeforeEnd)).toBe("2026-08-31");
    expect(toBusinessDate(range.endUtc)).toBe("2026-09-01");
  });
});

describe("businessMonthDates", () => {
  it("is the month's first date up to the next month's first date, across a year end", () => {
    expect(businessMonthDates("2026-10")).toEqual({ gte: "2026-10-01", lt: "2026-11-01" });
    expect(businessMonthDates("2026-12")).toEqual({ gte: "2026-12-01", lt: "2027-01-01" });
    expect(businessMonthDates("2027-01")).toEqual({ gte: "2027-01-01", lt: "2027-02-01" });
  });

  it("holds exactly the month's business dates", () => {
    const { gte, lt } = businessMonthDates("2026-02");
    const inside = (date: string) => date >= gte && date < lt;
    expect(["2026-02-01", "2026-02-28"].every(inside)).toBe(true);
    expect(["2026-01-31", "2026-03-01"].some(inside)).toBe(false);
  });
});
