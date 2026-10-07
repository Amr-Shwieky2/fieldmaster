"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FullPageMessage } from "@/components/full-page-message";

/**
 * Translated error boundary for every page under the root layout (login and
 * the app shell), replacing Next's built-in English "Application error" text.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("states");

  useEffect(() => {
    console.error(error);
  }, [error]);

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
