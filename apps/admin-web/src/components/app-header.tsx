"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { Button } from "@/components/ui/button";

/** Top bar of the signed-in app: who is signed in and sign out. */
export function AppHeader() {
  const t = useTranslations("shell");
  const enumLabel = useEnumLabel();
  const { session, logout } = useAuth();

  return (
    <header className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-8 py-3">
      {session ? <p className="me-auto text-sm text-slate-500">{t("signedInAs", { role: enumLabel("OrgRole", session.role) })}</p> : null}
      <Button variant="ghost" size="sm" onClick={logout}>
        {t("signOut")}
      </Button>
    </header>
  );
}
