import { BUSINESS_TIMEZONE } from "@fieldmaster/shared-types";

/**
 * All timestamps are stored in UTC (Postgres timestamptz). Business-day and
 * business-month grouping (shift dates, payroll periods, the forgotten-stamp
 * monthly counter) is computed in Asia/Jerusalem using Intl, which correctly
 * tracks Israel's DST transitions without pulling in a date-tz dependency.
 */
export function toBusinessDate(date: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date); // YYYY-MM-DD
}

export function toBusinessYearMonth(date: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  return toBusinessDate(date, timeZone).slice(0, 7); // YYYY-MM
}

export interface BusinessMonthRange {
  /** Inclusive UTC instant marking the start of the business month. */
  startUtc: Date;
  /** Exclusive UTC instant marking the start of the following business month. */
  endUtc: Date;
}

/**
 * Computes the UTC instants bounding a given Asia/Jerusalem calendar month
 * (e.g. "2026-08") by binary-searching the offset transitions, since Intl
 * does not expose a direct local->UTC conversion.
 */
export function getBusinessMonthRange(
  yearMonth: string,
  timeZone: string = BUSINESS_TIMEZONE,
): BusinessMonthRange {
  const [year, month] = yearMonth.split("-").map(Number);
  const startUtc = findUtcForLocalMidnight(year, month, 1, timeZone);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endUtc = findUtcForLocalMidnight(nextYear, nextMonth, 1, timeZone);
  return { startUtc, endUtc };
}

function findUtcForLocalMidnight(year: number, month: number, day: number, timeZone: string): Date {
  // Start from the UTC instant that has the same wall-clock value, then
  // correct for the timezone offset at that instant.
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offsetMinutes * 60_000);
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}
