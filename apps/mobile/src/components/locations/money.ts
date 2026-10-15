import { toWesternDigits } from "@fieldmaster/i18n";

/** The largest amount the API stores (a 32-bit integer of agorot): ₪ 21,474,836.47. */
export const MAX_AGOROT = 2_147_483_647;

export type ShekelsInput = { kind: "empty" } | { kind: "invalid" } | { kind: "ok"; agorot: number };

/**
 * An amount in shekels as typed on the phone -> integer agorot, with integer
 * arithmetic only ("12500.5" -> 1250050). Accepts Western or Arabic-Indic
 * digits, "." or the Arabic "٫" for the decimals (at most two), a decimal
 * comma ("12500,5", what some keyboards' decimal key types) and thousands
 * separators in their places ("12,500.50"). Anything else is invalid, never
 * guessed.
 */
export function parseShekels(input: string): ShekelsInput {
  let text = toWesternDigits(input).replace(/[\s٬₪]/g, "").replace(/٫/g, ".");
  if (text === "") return { kind: "empty" };
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) text = text.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { kind: "invalid" };
  const agorot = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(agorot) || agorot > MAX_AGOROT) return { kind: "invalid" };
  return { kind: "ok", agorot };
}
