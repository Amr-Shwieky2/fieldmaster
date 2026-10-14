import { act, renderHook } from "@testing-library/react-native";
import { formatClock, formatElapsed, useNow } from "../elapsed";

describe("timers", () => {
  it("formats a running call-out as hours:minutes:seconds with Western digits", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(59_999)).toBe("00:00:59");
    expect(formatElapsed(3_909_000)).toBe("01:05:09");
    expect(formatElapsed(26 * 3_600_000)).toBe("26:00:00");
    // A phone clock slightly behind the server's start time never shows a negative timer.
    expect(formatElapsed(-5_000)).toBe("00:00:00");
  });

  it("formats a recording as minutes:seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(42_400)).toBe("00:42");
    expect(formatClock(180_000)).toBe("03:00");
    expect(formatClock(-1)).toBe("00:00");
  });

  it("useNow ticks while active and stops when inactive", async () => {
    jest.useFakeTimers({ now: new Date("2026-01-15T00:00:00.000Z") });
    try {
      const { result, rerender } = await renderHook(({ active }: { active: boolean }) => useNow(1000, active), { initialProps: { active: true } });
      const start = result.current;
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      expect(result.current - start).toBe(3000);

      await rerender({ active: false });
      const stopped = result.current;
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(result.current).toBe(stopped);
    } finally {
      jest.useRealTimers();
    }
  });
});
