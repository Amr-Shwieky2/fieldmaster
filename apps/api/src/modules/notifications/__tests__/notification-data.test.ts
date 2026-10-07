import { hasFinancialData, isFinancialDataKey, withoutFinancialData } from "../notification-data";

describe("notification data financial helpers", () => {
  it("treats every *Agorot key as money", () => {
    expect(isFinancialDataKey("estimatedCostAgorot")).toBe(true);
    expect(isFinancialDataKey("netPayableAgorot")).toBe(true);
    expect(isFinancialDataKey("agorot")).toBe(true);
    expect(isFinancialDataKey("durationMinutes")).toBe(false);
    expect(isFinancialDataKey("workerName")).toBe(false);
  });

  it("detects money in a payload", () => {
    expect(hasFinancialData(undefined)).toBe(false);
    expect(hasFinancialData({ shiftTitle: "A", durationMinutes: 30 })).toBe(false);
    expect(hasFinancialData({ shiftTitle: "A", estimatedCostAgorot: 100 })).toBe(true);
  });

  it("removes only the money keys and leaves the input untouched", () => {
    const ownerData = { shiftTitle: "A", durationMinutes: 30, estimatedCostAgorot: 12345 };
    expect(withoutFinancialData(ownerData)).toEqual({ shiftTitle: "A", durationMinutes: 30 });
    expect(ownerData.estimatedCostAgorot).toBe(12345);
  });

  it("finds and removes money nested in objects and arrays", () => {
    const nested = { shiftTitle: "A", estimate: { totalCompensationAgorot: 12345, hours: 9 }, lines: [{ netAgorot: 1, name: "x" }] };
    expect(hasFinancialData(nested)).toBe(true);
    expect(hasFinancialData({ lines: [{ name: "x" }], estimate: { hours: 9 } })).toBe(false);
    expect(withoutFinancialData(nested)).toEqual({ shiftTitle: "A", estimate: { hours: 9 }, lines: [{ name: "x" }] });
    expect(nested.estimate.totalCompensationAgorot).toBe(12345);
  });
});
