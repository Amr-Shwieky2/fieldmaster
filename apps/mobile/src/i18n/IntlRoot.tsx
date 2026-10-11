import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { BUSINESS_TIME_ZONE, INTL_LOCALE } from "@fieldmaster/i18n";
import messages from "./messages";

/**
 * use-intl (next-intl's core, the same ICU messages as the admin web) with the
 * app's Arabic messages. A missing key shows the key path in development and
 * fails tests (see jest.setup.ts), never English text.
 */
export function IntlRoot({ children, onError }: { children: ReactNode; onError?: (error: Error) => void }) {
  return (
    <IntlProvider locale={INTL_LOCALE} messages={messages} timeZone={BUSINESS_TIME_ZONE} onError={onError}>
      {children}
    </IntlProvider>
  );
}
