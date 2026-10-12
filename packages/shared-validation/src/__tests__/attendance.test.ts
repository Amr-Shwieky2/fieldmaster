import { rawDurationMinutes, splitWorkedMinutes } from "../attendance";

describe("rawDurationMinutes", () => {
  const clockIn = new Date("2026-10-05T04:00:00.000Z");

  it("counts whole minutes between clock-in and clock-out", () => {
    expect(rawDurationMinutes(clockIn, new Date("2026-10-05T14:30:00.000Z"))).toBe(630);
  });

  it("rounds to the nearest minute", () => {
    expect(rawDurationMinutes(clockIn, new Date("2026-10-05T04:00:29.000Z"))).toBe(0);
    expect(rawDurationMinutes(clockIn, new Date("2026-10-05T04:00:30.000Z"))).toBe(1);
  });

  it("is never negative", () => {
    expect(rawDurationMinutes(clockIn, new Date("2026-10-05T03:00:00.000Z"))).toBe(0);
  });
});

describe("splitWorkedMinutes (the split approval stores)", () => {
  it("9 hours: 540 regular, 0 overtime", () => {
    expect(splitWorkedMinutes({ rawDurationMinutes: 540, unpaidBreakMinutes: 0, fullDayCredit: false })).toEqual({
      workedMinutes: 540,
      regularMinutes: 540,
      overtimeMinutes: 0,
      fullDayCreditApplied: false,
    });
  });

  it("10 h 30 m: 540 regular, 90 overtime", () => {
    expect(splitWorkedMinutes({ rawDurationMinutes: 630, unpaidBreakMinutes: 0, fullDayCredit: false })).toEqual({
      workedMinutes: 630,
      regularMinutes: 540,
      overtimeMinutes: 90,
      fullDayCreditApplied: false,
    });
  });

  it("subtracts unpaid breaks before splitting", () => {
    expect(splitWorkedMinutes({ rawDurationMinutes: 630, unpaidBreakMinutes: 30, fullDayCredit: false })).toEqual({
      workedMinutes: 600,
      regularMinutes: 540,
      overtimeMinutes: 60,
      fullDayCreditApplied: false,
    });
  });

  it("never goes below zero when breaks exceed the duration", () => {
    expect(splitWorkedMinutes({ rawDurationMinutes: 20, unpaidBreakMinutes: 45, fullDayCredit: false })).toEqual({
      workedMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      fullDayCreditApplied: false,
    });
  });

  it("full-day credit lifts a short day to 540 regular minutes", () => {
    expect(splitWorkedMinutes({ rawDurationMinutes: 300, unpaidBreakMinutes: 0, fullDayCredit: true })).toEqual({
      workedMinutes: 300,
      regularMinutes: 540,
      overtimeMinutes: 0,
      fullDayCreditApplied: true,
    });
  });

  it("full-day credit changes nothing on a day of 540 worked minutes or more", () => {
    expect(splitWorkedMinutes({ rawDurationMinutes: 600, unpaidBreakMinutes: 0, fullDayCredit: true })).toEqual({
      workedMinutes: 600,
      regularMinutes: 540,
      overtimeMinutes: 60,
      fullDayCreditApplied: false,
    });
  });
});
