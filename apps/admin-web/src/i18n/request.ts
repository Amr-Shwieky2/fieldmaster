import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { BUSINESS_TIME_ZONE, INTL_LOCALE, LOCALE_COOKIE, resolveLocale } from "./config";

/**
 * next-intl request config (cookie-based, no URL prefixes). Wired up by
 * `createNextIntlPlugin("./src/i18n/request.ts")` in next.config.js.
 *
 * Reads `fm_locale`, falls back to Arabic, loads that locale's messages and
 * pins the time zone to the business time zone (Asia/Jerusalem) so every
 * server-rendered date agrees with the client.
 *
 * next-intl gets the Intl tag `ar-u-nu-latn` / `en-u-nu-latn` rather than the
 * bare locale: ICU formats numbers inside messages with this locale, and the
 * `-u-nu-latn` extension keeps them in Western digits (0-9) while keeping the
 * Arabic plural rules. Code that needs the bare `"ar" | "en"` uses
 * `useAppLocale()`, which strips the extension.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return {
    locale: INTL_LOCALE[locale],
    timeZone: BUSINESS_TIME_ZONE,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
