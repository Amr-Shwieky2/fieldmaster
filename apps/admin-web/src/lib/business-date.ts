import { BUSINESS_TIME_ZONE } from "@/i18n/config";

export function currentYearMonth(): string {
  // "en-CA" only builds the machine string YYYY-MM from ISO-ordered parts; it is never shown.
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit" });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}
