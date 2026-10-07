import { describe, expect, it } from "vitest";
import { createTranslator, IntlErrorCode, type AbstractIntlMessages } from "next-intl";
import ar from "@/i18n/messages/ar.json";
import { INTL_LOCALE } from "@/i18n/config";

/** Keys that are only read with `t.raw()` (HTML for Leaflet), not formatted as ICU. */
const RAW_ONLY = new Set(["geofenceMap.attribution"]);

function flatKeys(messages: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null ? flatKeys(value as Record<string, unknown>, path) : [path];
  });
}

/** Formats every key and returns the ICU syntax errors (missing values are expected here and ignored). */
function syntaxErrors(messages: AbstractIntlMessages, skip: Set<string> = new Set()): string[] {
  const errors: string[] = [];
  const t = createTranslator({
    locale: INTL_LOCALE,
    messages,
    onError: (error) => {
      if (error.code === IntlErrorCode.INVALID_MESSAGE) errors.push(error.message);
    },
    getMessageFallback: ({ key }) => key,
  });
  for (const key of flatKeys(messages)) {
    if (skip.has(key)) continue;
    try {
      (t as unknown as (key: string) => string)(key);
    } catch {
      // Formatting without values may throw for some messages; only syntax errors are collected above.
    }
  }
  return errors;
}

describe("ar.json messages", () => {
  // With en.json gone there is no second file to compare placeholders against,
  // so this guards every message's ICU syntax, including ones no page test renders.
  it("are all valid ICU messages", () => {
    expect(syntaxErrors(ar, RAW_ONLY)).toEqual([]);
  });

  it("the syntax check catches a broken message", () => {
    expect(syntaxErrors({ broken: { plural: "{count, plural, one {عامل" } })).toHaveLength(1);
  });
});
