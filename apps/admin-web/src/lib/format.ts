import { BUSINESS_TIME_ZONE, INTL_LOCALE } from "@/i18n/config";

/**
 * Arabic formatting for the admin web app.
 *
 * - Western digits (0-9): every Intl call uses the `ar-u-nu-latn` tag.
 * - Every date and time is shown in the business time zone, Asia/Jerusalem,
 *   on the Gregorian calendar.
 * - Money is integer agorot and is formatted with integer arithmetic only:
 *   `₪ 1,234.50` (symbol, space, comma grouping, 2 decimals).
 *
 * In JSX, prefer the bidi-safe components in `@/components/formatted`, which
 * wrap these strings in an LTR isolate so "₪ 1,234.50" or "+972..." keep their
 * order inside Arabic text.
 */

export const EM_DASH = "—";
export const CURRENCY_SYMBOL = "₪";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `₪ 1,234.50` for 123450 agorot; `-₪ 1,234.50` for negatives; `—` for null. */
export function formatAgorot(agorot: number | null | undefined): string {
  if (agorot === null || agorot === undefined || !Number.isFinite(agorot)) return EM_DASH;
  const rounded = Math.round(agorot);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${CURRENCY_SYMBOL} ${whole}.${fraction}`;
}

export function formatNumber(value: number | null | undefined, options: Intl.NumberFormatOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return new Intl.NumberFormat(INTL_LOCALE, options).format(value);
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

// Day, month name and year: "15 يناير 2026". The month is spelled out (a
// numeric date with RTL marks reads poorly).
const DATE_PARTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
const TIME_PARTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

function formatInZone(value: DateInput, kind: "date" | "time" | "dateTime"): string {
  const date = toDate(value);
  if (!date) return EM_DASH;
  const parts = kind === "date" ? DATE_PARTS : kind === "time" ? TIME_PARTS : { ...DATE_PARTS, ...TIME_PARTS };
  return new Intl.DateTimeFormat(INTL_LOCALE, { ...parts, timeZone: BUSINESS_TIME_ZONE, calendar: "gregory" }).format(date);
}

/** `15 يناير 2026` in Asia/Jerusalem. */
export function formatDate(value: DateInput): string {
  return formatInZone(value, "date");
}

/** `10:30` (24-hour) in Asia/Jerusalem. */
export function formatTime(value: DateInput): string {
  return formatInZone(value, "time");
}

/** `15 يناير 2026 في 10:30` in Asia/Jerusalem. */
export function formatDateTime(value: DateInput): string {
  return formatInZone(value, "dateTime");
}

/**
 * A business date (`YYYY-MM-DD`, already an Asia/Jerusalem calendar day) shown
 * without any time-zone shift.
 */
export function formatBusinessDate(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return EM_DASH;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat(INTL_LOCALE, { ...DATE_PARTS, timeZone: "UTC", calendar: "gregory" }).format(date);
}

/** `2026-09` -> `سبتمبر 2026`. */
export function formatMonth(yearMonth: string | null | undefined): string {
  if (!yearMonth) return EM_DASH;
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return EM_DASH;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15));
  return new Intl.DateTimeFormat(INTL_LOCALE, { month: "long", year: "numeric", timeZone: "UTC", calendar: "gregory" }).format(date);
}

/** All formatters in one object (see `useFormat`). */
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
