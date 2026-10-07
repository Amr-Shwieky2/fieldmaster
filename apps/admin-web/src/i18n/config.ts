/**
 * Locale configuration shared by the server (request config, root layout) and
 * the client (language switcher, formatters).
 *
 * The app is cookie-based: there are NO /ar or /en URL prefixes. The active
 * locale is read from the `fm_locale` cookie and falls back to Arabic when the
 * cookie is absent or invalid, regardless of the browser's Accept-Language.
 * There is intentionally no Hebrew.
 */

/** Supported UI locales, Arabic first. */
export const locales = ["ar", "en"] as const;

export type Locale = (typeof locales)[number];

/** Arabic. Used whenever no valid locale cookie is present. */
export const defaultLocale: Locale = "ar";

/** Name of the cookie holding the chosen UI locale (`"ar" | "en"`). */
export const LOCALE_COOKIE = "fm_locale";

/** One year; the cookie is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Business timezone: business days/months and all displayed times use it. */
export const BUSINESS_TIME_ZONE = "Asia/Jerusalem";

/** Narrowing guard: true only for `"ar"` and `"en"`. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Returns the supported base locale for `value`, otherwise the default
 * (Arabic). Accepts full Intl tags too: next-intl runs with `ar-u-nu-latn` /
 * `en-u-nu-latn` (see INTL_LOCALE), which resolve to `ar` / `en`.
 */
export function resolveLocale(value: unknown): Locale {
  if (typeof value !== "string") return defaultLocale;
  const base = value.split("-")[0];
  return isLocale(base) ? base : defaultLocale;
}

/** Text direction for the `<html dir>` attribute and direction-aware helpers. */
export function localeDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * BCP 47 tags passed to Intl. `-u-nu-latn` forces Western digits (0-9) in
 * Arabic, which would otherwise default to Arabic-Indic digits in some engines.
 */
export const INTL_LOCALE: Record<Locale, string> = {
  ar: "ar-u-nu-latn",
  en: "en-u-nu-latn",
};
