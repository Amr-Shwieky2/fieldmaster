"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/** Shown when the API answers 403 or the signed-in role may not see a page. */
export function AccessDenied() {
  const t = useTranslations("states");
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-base font-semibold text-slate-900">{t("accessDeniedTitle")}</p>
      <p className="text-sm text-slate-600">{t("accessDeniedDescription")}</p>
      <Link href="/dashboard" className="mt-2 text-sm font-medium text-brand-700 hover:underline">
        {t("goToDashboard")}
      </Link>
    </div>
  );
}
