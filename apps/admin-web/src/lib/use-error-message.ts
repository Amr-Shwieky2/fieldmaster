"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getErrorMessage } from "./errors";

/** `(error) => localized message`, bound to the current locale. */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations("errors");
  return useCallback((error: unknown) => getErrorMessage(t, error), [t]);
}
