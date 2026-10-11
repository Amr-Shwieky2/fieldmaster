/**
 * Locale configuration shared by the admin web and the mobile app.
 *
 * Both apps are Arabic only: no language choice, no locale cookie and no URL
 * prefix; every screen is right-to-left Arabic. English was removed at the
 * product owner's request (2026-10-07). There is intentionally no Hebrew.
 */

/** The only UI language (`<html lang>` on the web). */
export const APP_LOCALE = "ar";

/** Text direction of both apps (`<html dir>` on the web, forced RTL on mobile). */
export const APP_DIRECTION = "rtl";

/**
 * BCP 47 tag passed to Intl and next-intl. `-u-nu-latn` forces Western digits
 * (0-9), which would otherwise default to Arabic-Indic digits in some engines,
 * while keeping the Arabic plural rules and month names.
 */
export const INTL_LOCALE = "ar-u-nu-latn";

/** Business timezone: business days/months and all displayed times use it. */
export const BUSINESS_TIME_ZONE = "Asia/Jerusalem";
