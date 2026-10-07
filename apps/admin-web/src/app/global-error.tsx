"use client";

import { useEffect } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { APP_DIRECTION, APP_LOCALE, BUSINESS_TIME_ZONE, INTL_LOCALE } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";
import { Button } from "@/components/ui/button";
import { FullPageMessage } from "@/components/full-page-message";
import "./globals.css";

/**
 * Last-resort error page, used only when the root layout itself fails. It
 * replaces the root layout (and so its next-intl provider), so it renders its
 * own Arabic `<html>` and provider. Only the `states` messages are passed.
 * Without it, Next shows its built-in English "Application error" page.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={APP_LOCALE} dir={APP_DIRECTION}>
      <body className="font-sans">
        <NextIntlClientProvider locale={INTL_LOCALE} timeZone={BUSINESS_TIME_ZONE} messages={{ states: ar.states }}>
          <GlobalErrorMessage reset={reset} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

function GlobalErrorMessage({ reset }: { reset: () => void }) {
  const t = useTranslations("states");
  return (
    <FullPageMessage
      title={t("errorTitle")}
      description={t("pageErrorDescription")}
      linkLabel={t("goToDashboard")}
      actions={
        <Button variant="secondary" size="sm" onClick={reset}>
          {t("retry")}
        </Button>
      }
    />
  );
}
