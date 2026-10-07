"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { AuthSession, DevLoginUser } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { useErrorMessage } from "@/lib/use-error-message";
import { Phone } from "@/components/formatted";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ROLE_GROUPS: { role: OrgRole; titleKey: "groupOwners" | "groupFieldManagers" | "groupWorkers" }[] = [
  { role: OrgRole.OWNER, titleKey: "groupOwners" },
  { role: OrgRole.FIELD_MANAGER, titleKey: "groupFieldManagers" },
  { role: OrgRole.WORKER, titleKey: "groupWorkers" },
];

/**
 * Asks the API whether dev login (test) mode is on. The API answers 404 when
 * it is off, which the client maps to null -- in that case the login page
 * shows no test options at all.
 */
export function useDevLoginUsers() {
  const { client } = useAuth();
  return useQuery({
    queryKey: ["dev-login-users"],
    queryFn: () => client.listDevLoginUsers(),
    retry: false,
    staleTime: 60_000,
  });
}

export function TestModeBanner() {
  const t = useTranslations("devLogin");
  return (
    <div role="status" className="w-full rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">{t("bannerTitle")}</p>
      <p className="mt-0.5 text-amber-800">{t("bannerBody")}</p>
    </div>
  );
}

export function DevQuickLogin({ users, onLoggedIn }: { users: DevLoginUser[]; onLoggedIn: (session: AuthSession) => void }) {
  const { client } = useAuth();
  const t = useTranslations("devLogin");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  const error = failure ? errorMessage(failure.cause) : null;
  const showOrganization = new Set(users.map((u) => u.organizationId)).size > 1;

  async function signIn(user: DevLoginUser) {
    setFailure(null);
    setPendingId(user.membershipId);
    try {
      const session = await client.devLogin({ membershipId: user.membershipId, deviceId: "admin-web", platform: "WEB" });
      onLoggedIn(session);
    } catch (err) {
      setFailure({ cause: err });
      setPendingId(null);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("quickLoginTitle")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">{t("quickLoginDescription")}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {users.length === 0 && <p className="text-sm text-slate-500">{t("noUsers")}</p>}
        {ROLE_GROUPS.map(({ role, titleKey }) => {
          const group = users.filter((u) => u.role === role);
          if (group.length === 0) return null;
          return (
            <section key={role} aria-labelledby={`dev-login-${role}`}>
              <h3 id={`dev-login-${role}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t(titleKey)} <span className="font-normal normal-case">{t("groupCount", { count: group.length })}</span>
              </h3>
              {role === OrgRole.WORKER && <p className="mb-2 text-xs text-slate-500">{t("workersNote")}</p>}
              <ul className="grid gap-2 sm:grid-cols-2">
                {group.map((user) => (
                  <li key={user.membershipId}>
                    <button
                      type="button"
                      onClick={() => signIn(user)}
                      disabled={pendingId !== null}
                      aria-label={t("signInAs", { name: user.fullLegalName, role: enumLabel("OrgRole", user.role) })}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-start text-sm transition-colors hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="block font-medium text-slate-900">{pendingId === user.membershipId ? t("signingIn") : user.fullLegalName}</span>
                      <span className="block text-xs text-slate-500">
                        <Phone value={user.phoneNumber} />
                      </span>
                      {showOrganization && <span className="block text-xs text-slate-400">{user.organizationName}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
