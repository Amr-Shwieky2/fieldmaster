import { calculateDailyCompensation, calculateHourlyCompensation } from "../payroll";

describe("calculateDailyCompensation", () => {
  const base = {
    dailyBaseRateAgorot: 40_000, // 400 ILS/day
    overtimeHourlyRateAgorot: 6_000, // 60 ILS/hr
  };

  it("credits exactly one standard day at 9 approved hours with no overtime", () => {
    const result = calculateDailyCompensation({ ...base, approvedMinutes: 540, fullDayCredit: false });
    expect(result.standardDaysCredited).toBe(1);
    expect(result.baseCompensationAgorot).toBe(40_000);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.totalCompensationAgorot).toBe(40_000);
  });

  it("prorates a short day with no full-day credit (6h of 9h)", () => {
    // 360 approved minutes of 540 => 40000 * 360/540 = 26666.67 -> 26667
    const result = calculateDailyCompensation({ ...base, approvedMinutes: 360, fullDayCredit: false });
    expect(result.standardDaysCredited).toBe(0);
    expect(result.baseCompensationAgorot).toBe(26_667);
    expect(result.totalCompensationAgorot).toBe(26_667);
  });

  it("credits a full day when manual full-day credit is applied to a short day", () => {
    const result = calculateDailyCompensation({ ...base, approvedMinutes: 360, fullDayCredit: true });
    expect(result.standardDaysCredited).toBe(1);
    expect(result.baseCompensationAgorot).toBe(40_000);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.totalCompensationAgorot).toBe(40_000);
  });

  it("computes overtime for a shift of 10h30m (1h30m overtime)", () => {
    const result = calculateDailyCompensation({ ...base, approvedMinutes: 630, fullDayCredit: false });
    expect(result.standardDaysCredited).toBe(1);
    expect(result.overtimeMinutes).toBe(90);
    // 90 min * 6000 agorot/hr / 60 = 9000
    expect(result.overtimeCompensationAgorot).toBe(9_000);
    expect(result.totalCompensationAgorot).toBe(49_000);
  });

  it("never credits more than one standard day for a single shift", () => {
    const result = calculateDailyCompensation({ ...base, approvedMinutes: 1080, fullDayCredit: false });
    expect(result.standardDaysCredited).toBe(1);
  });
});

describe("calculateHourlyCompensation", () => {
  const base = {
    baseHourlyRateAgorot: 5_000, // 50 ILS/hr
    overtimeHourlyRateAgorot: 7_500, // 75 ILS/hr
  };

  it("pays base rate for a 6-hour day with no full-day credit", () => {
    const result = calculateHourlyCompensation({ ...base, approvedMinutes: 360, fullDayCredit: false });
    expect(result.regularMinutes).toBe(360);
    expect(result.overtimeMinutes).toBe(0);
    // 360/60 * 5000 = 30000
    expect(result.regularCompensationAgorot).toBe(30_000);
    expect(result.totalCompensationAgorot).toBe(30_000);
  });

  it("credits 9 regular hours when full-day credit applied to a short day, no overtime", () => {
    const result = calculateHourlyCompensation({ ...base, approvedMinutes: 300, fullDayCredit: true });
    expect(result.regularMinutes).toBe(540);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.regularCompensationAgorot).toBe(45_000); // 9 * 5000
    expect(result.totalCompensationAgorot).toBe(45_000);
  });

  it("splits regular and overtime minutes at the 9-hour boundary", () => {
    const result = calculateHourlyCompensation({ ...base, approvedMinutes: 630, fullDayCredit: false });
    expect(result.regularMinutes).toBe(540);
    expect(result.overtimeMinutes).toBe(90);
    expect(result.regularCompensationAgorot).toBe(45_000);
    expect(result.overtimeCompensationAgorot).toBe(11_250); // 1.5 * 7500
    expect(result.totalCompensationAgorot).toBe(56_250);
  });
});
