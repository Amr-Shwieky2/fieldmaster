"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth-context";
import { useAccess, useRoleLabel } from "@/lib/use-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Top bar of the signed-in app: who is signed in (their role's name), whether their view is limited to some projects, and sign out. */
export function AppHeader() {
  const t = useTranslations("shell");
  const { session, logout } = useAuth();
  const { restricted } = useAccess();
  const roleLabel = useRoleLabel();

  return (
    <header className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-8 py-3">
      {session ? (
        <div className="me-auto flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-500">{t("signedInAs", { role: roleLabel ?? "" })}</p>
          {restricted ? (
            <Badge tone="warning" title={t("restrictedScopeHint")}>
              {t("restrictedScope")}
            </Badge>
          ) : null}
        </div>
      ) : null}
      <Button variant="ghost" size="sm" onClick={logout}>
        {t("signOut")}
      </Button>
    </header>
  );
}
