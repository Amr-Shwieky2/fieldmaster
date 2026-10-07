import { useLocale } from "next-intl";
import type { Locale } from "./config";
import { resolveLocale } from "./config";

/**
 * The active UI locale as the narrow `"ar" | "en"` type (next-intl's own
 * `useLocale()` returns a plain `string`). Works in server and client
 * components. Falls back to Arabic for anything unexpected.
 */
export function useAppLocale(): Locale {
  return resolveLocale(useLocale());
}
