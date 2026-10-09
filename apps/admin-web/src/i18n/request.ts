import { getRequestConfig } from "next-intl/server";
import { BUSINESS_TIME_ZONE, INTL_LOCALE } from "@fieldmaster/i18n";
import messages from "./messages";

/**
 * next-intl request config. Wired up by
 * `createNextIntlPlugin("./src/i18n/request.ts")` in next.config.js.
 *
 * The app is Arabic only, so this always returns the Arabic messages (shared +
 * admin web, see ./messages) and pins the time zone to the business time zone
 * (Asia/Jerusalem), so every server-rendered date agrees with the client.
 *
 * next-intl gets the Intl tag `ar-u-nu-latn` rather than plain `ar`: ICU
 * formats numbers inside messages with this locale, and the `-u-nu-latn`
 * extension keeps them in Western digits (0-9).
 */
export default getRequestConfig(async () => ({
  locale: INTL_LOCALE,
  timeZone: BUSINESS_TIME_ZONE,
  messages,
}));
