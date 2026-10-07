"use client";

import { useTranslations } from "next-intl";
import { locales, type Locale } from "@/i18n/config";
import { useChangeLocale } from "@/i18n/locale-client";
import { cn } from "@/lib/cn";

const LABEL_KEY: Record<Locale, "arabic" | "english"> = { ar: "arabic", en: "english" };

/**
 * Two-option language switch. Writes the `fm_locale` cookie and refreshes the
 * server tree, so `<html lang dir>` and every message switch together without
 * a full reload.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("language");
  const { locale, changeLocale, isPending } = useChangeLocale();

  return (
    <div role="group" aria-label={t("label")} className={cn("inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm", className)}>
      {locales.map((option) => {
        const active = option === locale;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={active}
            disabled={isPending}
            onClick={() => {
              if (!active) changeLocale(option);
            }}
            className={cn(
              "rounded px-2.5 py-1 font-medium transition-colors disabled:opacity-60",
              active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {t(LABEL_KEY[option])}
          </button>
        );
      })}
    </div>
  );
}
