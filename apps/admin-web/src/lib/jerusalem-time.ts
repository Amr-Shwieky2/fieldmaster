import { formatTime, israelOffsetMinutes, toBusinessDay } from "@fieldmaster/i18n";

/**
 * Date/time inputs (`<input type="datetime-local">`) hold a wall-clock time
 * with no time zone. Business times are Asia/Jerusalem whatever the browser's
 * own zone, so the values are converted here, not with `new Date(value)`.
 */

const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** An instant as the `YYYY-MM-DDTHH:mm` Asia/Jerusalem wall-clock value of a datetime-local input. */
export function toJerusalemInputValue(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${toBusinessDay(date)}T${formatTime(date)}`;
}

/**
 * The instant of a `YYYY-MM-DDTHH:mm` Asia/Jerusalem wall-clock value, or
 * null when it is malformed. A time skipped by the spring DST change resolves
 * to the standard-time reading.
 */
export function fromJerusalemInputValue(value: string): Date | null {
  const match = INPUT_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(wallClockAsUtc)) return null;
  for (const offset of [180, 120]) {
    const candidate = new Date(wallClockAsUtc - offset * 60_000);
    if (israelOffsetMinutes(candidate) === offset) return candidate;
  }
  return new Date(wallClockAsUtc - 120 * 60_000);
}

/** `2026-10` -> `2026-09` (delta -1) or `2026-11` (delta +1). */
export function shiftYearMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** First and last business date of a month: `2026-02` -> `{ from: "2026-02-01", to: "2026-02-28" }`. */
export function monthDateRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const BUSINESS_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
