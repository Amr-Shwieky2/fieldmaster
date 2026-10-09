import { BUSINESS_TIME_ZONE } from "./config";

/**
 * Arabic formatting shared by the admin web and the mobile app.
 *
 * - Western digits (0-9) everywhere.
 * - Every date and time is in the business time zone, Asia/Jerusalem, on the
 *   Gregorian calendar: "15 يناير 2026 في 10:30".
 * - Durations read "9 س 30 د".
 * - Money is integer agorot formatted with integer arithmetic only:
 *   "₪ 1,234.50".
 *
 * The output must be identical in browsers, Node and Hermes (iOS/Android),
 * whose Intl support differs (locale data, numbering systems). So this module
 * never asks Intl for Arabic text: month names come from a fixed table, and
 * Intl is only used, with "en-US", to read the date/time parts in
 * Asia/Jerusalem. That use is self-checked at startup against two known
 * instants; an engine that cannot do it falls back to Israel's DST rules
 * computed here (`israelOffsetMinutes`). Any Arabic-Indic digit that still
 * slips through is converted by `toWesternDigits`.
 *
 * In JSX, the apps wrap these strings in a left-to-right isolate so "₪ 1,234.50"
 * or "+972..." keep their order inside Arabic text.
 */

export const EM_DASH = "—";
export const CURRENCY_SYMBOL = "₪";

/** Gregorian month names in Modern Standard Arabic. */
export const ARABIC_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"] as const;

/** Joins a date and a time: "15 يناير 2026 في 10:30". */
const DATE_TIME_SEPARATOR = " في ";

export type DateInput = string | number | Date | null | undefined;

/** Converts Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to 0-9. */
export function toWesternDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `₪ 1,234.50` for 123450 agorot; `-₪ 1,234.50` for negatives; `—` for null. */
export function formatAgorot(agorot: number | null | undefined): string {
  if (agorot === null || agorot === undefined || !Number.isFinite(agorot)) return EM_DASH;
  const rounded = Math.round(agorot);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = groupThousands(String(Math.floor(abs / 100)));
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${CURRENCY_SYMBOL} ${whole}.${fraction}`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `1,234,567` / `12.5` with Western digits. `options` are Intl.NumberFormat options (fraction digits). */
export function formatNumber(value: number | null | undefined, options: Intl.NumberFormatOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  try {
    return toWesternDigits(new Intl.NumberFormat("en-US", options).format(value));
  } catch {
    const max = options.maximumFractionDigits ?? 3;
    const [whole, fraction] = (Math.round(value * 10 ** max) / 10 ** max).toString().split(".");
    const sign = whole.startsWith("-") ? "-" : "";
    return `${sign}${groupThousands(whole.replace("-", ""))}${fraction ? `.${fraction}` : ""}`;
  }
}

/** `9 س 0 د` (hours and minutes). */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EM_DASH;
  const total = Math.round(Math.abs(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const text = `${hours} س ${mins} د`;
  return minutes < 0 && total > 0 ? `-${text}` : text;
}

// ── Asia/Jerusalem wall-clock parts ─────────────────────────────────────────

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

/** Last Sunday of a month (UTC date number). */
function lastSunday(year: number, monthIndex: number): number {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/**
 * Israel's offset from UTC in minutes (Israeli law since 2013): +3 from the
 * Friday before the last Sunday of March at 02:00 until the last Sunday of
 * October at 02:00, +2 otherwise. Only used when Intl cannot do time zones.
 */
export function israelOffsetMinutes(date: Date): number {
  const year = date.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSunday(year, 2) - 2, 0); // Friday 02:00 IST = 00:00 UTC
  const dstEnd = Date.UTC(year, 9, lastSunday(year, 9), -1); // Sunday 02:00 IDT = Saturday 23:00 UTC
  const time = date.getTime();
  return time >= dstStart && time < dstEnd ? 180 : 120;
}

function partsFromOffset(date: Date): ZonedParts {
  const shifted = new Date(date.getTime() + israelOffsetMinutes(date) * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

type PartsReader = (date: Date) => ZonedParts;

function intlPartsReader(): PartsReader | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  return (date) => {
    if (typeof formatter.formatToParts === "function") {
      const parts: Record<string, number> = {};
      for (const part of formatter.formatToParts(date)) {
        if (part.type !== "literal") parts[part.type] = Number(toWesternDigits(part.value));
      }
      return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
    }
    // "1/15/2026, 10:30"
    const match = /(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/.exec(toWesternDigits(formatter.format(date)));
    if (!match) throw new Error("unexpected date format");
    return { month: Number(match[1]), day: Number(match[2]), year: Number(match[3]), hour: Number(match[4]) % 24, minute: Number(match[5]) };
  };
}

/** Intl when it handles Asia/Jerusalem correctly on this engine (checked once), otherwise the built-in rules. */
function pickPartsReader(): PartsReader {
  const reader = intlPartsReader();
  if (!reader) return partsFromOffset;
  try {
    const winter = reader(new Date(Date.UTC(2026, 0, 15, 8, 30))); // 10:30 in Jerusalem (UTC+2)
    const summer = reader(new Date(Date.UTC(2026, 6, 15, 21, 30))); // 00:30 next day (UTC+3)
    const ok =
      winter.year === 2026 && winter.month === 1 && winter.day === 15 && winter.hour === 10 && winter.minute === 30 &&
      summer.month === 7 && summer.day === 16 && summer.hour === 0 && summer.minute === 30;
    return ok ? reader : partsFromOffset;
  } catch {
    return partsFromOffset;
  }
}

let partsReader: PartsReader | null = null;

function zonedParts(date: Date): ZonedParts {
  partsReader ??= pickPartsReader();
  return partsReader(date);
}

const dateText = (p: { year: number; month: number; day: number }) => `${p.day} ${ARABIC_MONTHS[p.month - 1]} ${p.year}`;
const timeText = (p: ZonedParts) => `${pad2(p.hour)}:${pad2(p.minute)}`;

/** `15 يناير 2026` in Asia/Jerusalem. */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? dateText(zonedParts(date)) : EM_DASH;
}

/** `10:30` (24-hour) in Asia/Jerusalem. */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  return date ? timeText(zonedParts(date)) : EM_DASH;
}

/** `15 يناير 2026 في 10:30` in Asia/Jerusalem. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EM_DASH;
  const parts = zonedParts(date);
  return `${dateText(parts)}${DATE_TIME_SEPARATOR}${timeText(parts)}`;
}

/**
 * A business date (`YYYY-MM-DD`, already an Asia/Jerusalem calendar day) shown
 * without any time-zone shift.
 */
export function formatBusinessDate(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return EM_DASH;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return EM_DASH;
  return dateText({ year: Number(match[1]), month, day });
}

/** `2026-09` -> `سبتمبر 2026`. */
export function formatMonth(yearMonth: string | null | undefined): string {
  if (!yearMonth) return EM_DASH;
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return EM_DASH;
  return `${ARABIC_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** The Asia/Jerusalem calendar day of an instant, as `YYYY-MM-DD`. */
export function toBusinessDay(value: DateInput): string | null {
  const date = toDate(value);
  if (!date) return null;
  const p = zonedParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** All formatters in one object (each app exposes it through a `useFormat()` hook). */
export function createFormatter() {
  return {
    money: (agorot: number | null | undefined) => formatAgorot(agorot),
    number: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => formatNumber(value, options),
    minutes: (minutes: number | null | undefined) => formatMinutes(minutes),
    date: (value: DateInput) => formatDate(value),
    time: (value: DateInput) => formatTime(value),
    dateTime: (value: DateInput) => formatDateTime(value),
    businessDate: (value: string | null | undefined) => formatBusinessDate(value),
    month: (yearMonth: string | null | undefined) => formatMonth(yearMonth),
  };
}

export type Formatter = ReturnType<typeof createFormatter>;

/** Test hook: forces the built-in Israel rules instead of Intl (to test the fallback). */
export function __useBuiltInTimeZoneRulesForTests(enabled: boolean): void {
  partsReader = enabled ? partsFromOffset : null;
}
