"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getErrorMessage } from "@fieldmaster/i18n";

/** `(error) => Arabic message` (see `getErrorMessage`). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations("errors");
  return useCallback((error: unknown) => getErrorMessage(t, error), [t]);
}
