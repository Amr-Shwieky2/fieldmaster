import { formatTime, toBusinessDay } from "@fieldmaster/i18n";

/**
 * Shift times as a manager picks them on the phone: a business day
 * ("YYYY-MM-DD") and wall-clock times ("HH:mm") in Asia/Jerusalem, whatever
 * the phone's own time zone. The API takes ISO instants. The conversion reads
 * the zone through the shared formatter (Intl when the engine handles
 * Asia/Jerusalem, Israel's DST rules otherwise), never the phone's zone.
 */

const MINUTE_MS = 60_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

const pad2 = (value: number) => String(value).padStart(2, "0");

/** A real calendar day written "YYYY-MM-DD". */
export function isBusinessDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A 24-hour wall-clock time written "HH:mm". */
export function isWallTime(value: string): boolean {
  const match = TIME_PATTERN.exec(value);
  return match !== null && Number(match[1]) < 24 && Number(match[2]) < 60;
}

/** The wall-clock reading as if it were UTC (milliseconds): the arithmetic below compares two such readings. */
function wallClockMs(day: string, time: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, date, hours, minutes);
}

/** How many minutes Asia/Jerusalem is ahead of UTC at an instant (120 in winter, 180 in summer). */
function offsetMinutesAt(instantMs: number): number {
  const minute = Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
  const day = toBusinessDay(minute);
  if (!day) return 0;
  return Math.round((wallClockMs(day, formatTime(minute)) - minute) / MINUTE_MS);
}

/** The instant of a wall-clock time on a business day in Asia/Jerusalem. */
export function businessInstant(day: string, time: string): Date {
  const wall = wallClockMs(day, time);
  // The offset at the wall reading itself can be one DST change away from the one at the instant: correct once.
  const guess = wall - offsetMinutesAt(wall) * MINUTE_MS;
  return new Date(wall - offsetMinutesAt(guess) * MINUTE_MS);
}

/** The Asia/Jerusalem calendar day of an instant. */
export function businessDayOf(instant: Date): string {
  return toBusinessDay(instant) ?? instant.toISOString().slice(0, 10);
}

/** The Asia/Jerusalem wall-clock time ("HH:mm") of an instant. */
export function wallTimeOf(instant: Date): string {
  return formatTime(instant);
}

/** `day` plus `days` calendar days. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export interface ShiftWindow {
  start: Date;
  end: Date;
  /** The business day the shift ends on: the next day for a night shift. */
  endDay: string;
  /** The end time is not after the start time, so the shift ends the next day. */
  overnight: boolean;
}

/**
 * A shift's instants from its day and times. An end time before the start
 * time ends on the next day (a night shift); the same time for both is not a
 * shift (null), and neither is an incomplete value.
 */
export function shiftWindow(day: string, start: string, end: string): ShiftWindow | null {
  if (!isBusinessDay(day) || !isWallTime(start) || !isWallTime(end)) return null;
  const startMinutes = minutesOf(start);
  const endMinutes = minutesOf(end);
  if (startMinutes === endMinutes) return null;
  const overnight = endMinutes < startMinutes;
  const endDay = overnight ? addDays(day, 1) : day;
  return { start: businessInstant(day, start), end: businessInstant(endDay, end), endDay, overnight };
}

/** A new shift's first values: the next full hour (today, or tomorrow from 23:00) for `hours` hours. */
export function defaultShiftTimes(now: Date = new Date(), hours = 8): { day: string; start: string; end: string } {
  const today = businessDayOf(now);
  const startHour = Number(wallTimeOf(now).slice(0, 2)) + 1;
  return {
    day: startHour >= 24 ? addDays(today, 1) : today,
    start: `${pad2(startHour % 24)}:00`,
    end: `${pad2((startHour + hours) % 24)}:00`,
  };
}
