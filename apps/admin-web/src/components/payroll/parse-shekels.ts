import { toWesternDigits } from "@fieldmaster/i18n";

/** The largest single manual adjustment the API accepts (₪1,000,000), in agorot. */
export const MAX_AMOUNT_AGOROT = 100_000_000;

export type ShekelsParseError = "empty" | "invalid" | "negative" | "zero" | "tooManyDecimals" | "tooLarge";

export type ShekelsParseResult = { ok: true; agorot: number } | { ok: false; error: ShekelsParseError };

const NUMBER = /^(\d+)(?:\.(\d+))?$/;

/**
 * A positive amount typed in shekels ("12.5", "0.07", "150") as integer
 * agorot (1250, 7, 15000). The text is split into its whole and decimal
 * digits and combined with integer arithmetic, never through a floating-point
 * number, so "0.07" is exactly 7 and "1.10" exactly 110. Arabic-Indic digits
 * and the Arabic decimal separator (٫) are accepted as typed on an Arabic
 * keyboard. Refused: empty text, anything that is not a plain number
 * (thousands separators, letters, "1e3", ".5", "5."), a minus sign, zero,
 * more than two decimals and amounts above what the API accepts.
 */
export function parseShekelsToAgorot(input: string): ShekelsParseResult {
  const value = toWesternDigits(input.trim()).replace(/٫/g, ".");
  if (value === "") return { ok: false, error: "empty" };
  if (value.startsWith("-") && NUMBER.test(value.slice(1))) return { ok: false, error: "negative" };
  const match = NUMBER.exec(value);
  if (!match) return { ok: false, error: "invalid" };
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const decimals = match[2] ?? "";
  if (decimals.length > 2) return { ok: false, error: "tooManyDecimals" };
  // More whole digits than the largest storable amount has: refuse before building the number.
  if (whole.length > String(Math.floor(MAX_AMOUNT_AGOROT / 100)).length) return { ok: false, error: "tooLarge" };
  const agorot = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (agorot === 0) return { ok: false, error: "zero" };
  if (agorot > MAX_AMOUNT_AGOROT) return { ok: false, error: "tooLarge" };
  return { ok: true, agorot };
}
