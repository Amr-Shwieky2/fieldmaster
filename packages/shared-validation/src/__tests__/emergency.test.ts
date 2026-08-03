import { computeEmergencyCompensation } from "../emergency";

describe("computeEmergencyCompensation", () => {
  it("applies -60min retroactive start and +15min return buffer (scenario 7)", () => {
    const start = new Date("2026-08-03T02:00:00Z");
    const end = new Date("2026-08-03T03:00:00Z");
    const result = computeEmergencyCompensation(start, end);

    expect(result.compensatedStart.toISOString()).toBe("2026-08-03T01:00:00.000Z");
    expect(result.compensatedEnd.toISOString()).toBe("2026-08-03T03:15:00.000Z");
    expect(result.actualWorkedMinutes).toBe(60);
    expect(result.retroactiveMinutes).toBe(60);
    expect(result.returnBufferMinutes).toBe(15);
    expect(result.compensatedDurationMinutes).toBe(135); // 2h15m
  });

  it("never mutates the original click timestamps", () => {
    const start = new Date("2026-08-03T02:00:00Z");
    const end = new Date("2026-08-03T03:00:00Z");
    const result = computeEmergencyCompensation(start, end);
    expect(result.actualStartClick.toISOString()).toBe(start.toISOString());
    expect(result.actualEndClick.toISOString()).toBe(end.toISOString());
  });

  it("rejects an end timestamp at or before the start timestamp", () => {
    const start = new Date("2026-08-03T02:00:00Z");
    expect(() => computeEmergencyCompensation(start, start)).toThrow();
  });
});
