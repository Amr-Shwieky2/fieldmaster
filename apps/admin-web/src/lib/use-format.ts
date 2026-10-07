"use client";

import { useMemo } from "react";
import { useAppLocale } from "@/i18n/use-app-locale";
import { createFormatter, type Formatter } from "./format";

/** Formatters bound to the current UI locale. */
export function useFormat(): Formatter {
  const locale = useAppLocale();
  return useMemo(() => createFormatter(locale), [locale]);
}
