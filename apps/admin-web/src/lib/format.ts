import { BUSINESS_TIME_ZONE, INTL_LOCALE, type Locale } from "@/i18n/config";

/**
 * Locale-aware formatting for the admin web app.
 *
 * - Western digits (0-9) in both languages: every Intl call uses the
 *   `ar-u-nu-latn` / `en-u-nu-latn` tag.
 * - Every date and time is shown in the business time zone, Asia/Jerusalem,
 *   on the Gregorian calendar.
 * - Money is integer agorot and is formatted with integer arithmetic only:
 *   `₪ 1,234.50` in both languages (symbol, space, comma grouping, 2 decimals).
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

export function formatNumber(value: number | null | undefined, locale: Locale, options: Intl.NumberFormatOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return new Intl.NumberFormat(INTL_LOCALE[locale], options).format(value);
}

/** `9h 0m` / `9 س 0 د`. */
export function formatMinutes(minutes: number | null | undefined, locale: Locale): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EM_DASH;
  const total = Math.round(Math.abs(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const text = locale === "ar" ? `${hours} س ${mins} د` : `${hours}h ${mins}m`;
  return minutes < 0 && total > 0 ? `-${text}` : text;
}

// Day, month name and year: "15 يناير 2026" / "Jan 15, 2026". Arabic spells
// the month out (a numeric date with RTL marks reads poorly); English keeps
// the short month.
function dateParts(locale: Locale): Intl.DateTimeFormatOptions {
  return { day: "numeric", month: locale === "ar" ? "long" : "short", year: "numeric" };
}
const timeParts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

function formatInZone(value: DateInput, locale: Locale, kind: "date" | "time" | "dateTime"): string {
  const date = toDate(value);
  if (!date) return EM_DASH;
  const parts = kind === "date" ? dateParts(locale) : kind === "time" ? timeParts : { ...dateParts(locale), ...timeParts };
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...parts, timeZone: BUSINESS_TIME_ZONE, calendar: "gregory" }).format(date);
}

/** `Jan 15, 2026` / `15 يناير 2026` in Asia/Jerusalem. */
export function formatDate(value: DateInput, locale: Locale): string {
  return formatInZone(value, locale, "date");
}

/** `10:30` (24-hour) in Asia/Jerusalem. */
export function formatTime(value: DateInput, locale: Locale): string {
  return formatInZone(value, locale, "time");
}

/** `Jan 15, 2026, 10:30` / `15 يناير 2026 في 10:30` in Asia/Jerusalem. */
export function formatDateTime(value: DateInput, locale: Locale): string {
  return formatInZone(value, locale, "dateTime");
}

/**
 * A business date (`YYYY-MM-DD`, already an Asia/Jerusalem calendar day) shown
 * without any time-zone shift.
 */
export function formatBusinessDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return EM_DASH;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return EM_DASH;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...dateParts(locale), timeZone: "UTC", calendar: "gregory" }).format(date);
}

/** `2026-09` -> `September 2026` / `سبتمبر 2026`. */
export function formatMonth(yearMonth: string | null | undefined, locale: Locale): string {
  if (!yearMonth) return EM_DASH;
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return EM_DASH;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15));
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", year: "numeric", timeZone: "UTC", calendar: "gregory" }).format(date);
}

/** All formatters bound to one locale (see `useFormat`). */
export function createFormatter(locale: Locale) {
  return {
    money: (agorot: number | null | undefined) => formatAgorot(agorot),
    number: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => formatNumber(value, locale, options),
    minutes: (minutes: number | null | undefined) => formatMinutes(minutes, locale),
    date: (value: DateInput) => formatDate(value, locale),
    time: (value: DateInput) => formatTime(value, locale),
    dateTime: (value: DateInput) => formatDateTime(value, locale),
    businessDate: (value: string | null | undefined) => formatBusinessDate(value, locale),
    month: (yearMonth: string | null | undefined) => formatMonth(yearMonth, locale),
  };
}

export type Formatter = ReturnType<typeof createFormatter>;
