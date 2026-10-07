"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "./config";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, resolveLocale } from "./config";
import { useAppLocale } from "./use-app-locale";

/**
 * Client-side locale switching for the cookie-based setup.
 *
 * `setLocaleCookie` writes `fm_locale`; `useChangeLocale` writes it and asks
 * Next to re-render the server tree (`router.refresh()`) so `<html lang dir>`,
 * messages and server-rendered text all switch without a full reload.
 *
 * The cookie is the only place the preference is stored.
 *
 *   const { locale, changeLocale, isPending } = useChangeLocale();
 *   changeLocale("en");
 */

/** Writes the locale cookie (path=/, one year, SameSite=Lax). No-op outside the browser. */
export function setLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

/** Reads the locale cookie in the browser; Arabic when absent or invalid. */
export function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return resolveLocale(undefined);
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`));
  return resolveLocale(match?.slice(LOCALE_COOKIE.length + 1));
}

export function useChangeLocale() {
  const router = useRouter();
  const locale = useAppLocale();
  const [isPending, startTransition] = useTransition();

  const changeLocale = useCallback(
    (next: Locale) => {
      setLocaleCookie(next);
      startTransition(() => router.refresh());
    },
    [router],
  );

  return { locale, changeLocale, isPending };
}
