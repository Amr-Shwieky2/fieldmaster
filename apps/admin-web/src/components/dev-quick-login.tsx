"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, type AuthSession, type DevLoginUser } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ROLE_GROUPS: { role: OrgRole; title: string }[] = [
  { role: OrgRole.OWNER, title: "Owners" },
  { role: OrgRole.FIELD_MANAGER, title: "Field Managers" },
  { role: OrgRole.WORKER, title: "Workers" },
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
  return (
    <div role="status" className="w-full rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">TEST MODE — login without SMS</p>
      <p className="mt-0.5 text-amber-800">This server is running with dev login enabled. Never use it with real data.</p>
    </div>
  );
}

export function DevQuickLogin({ users, onLoggedIn }: { users: DevLoginUser[]; onLoggedIn: (session: AuthSession) => void }) {
  const { client } = useAuth();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showOrganization = new Set(users.map((u) => u.organizationId)).size > 1;

  async function signIn(user: DevLoginUser) {
    setError(null);
    setPendingId(user.membershipId);
    try {
      const session = await client.devLogin({ membershipId: user.membershipId, deviceId: "admin-web", platform: "WEB" });
      onLoggedIn(session);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Quick login failed. Is the API running?");
      setPendingId(null);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Quick test login</CardTitle>
        <p className="mt-1 text-sm text-slate-500">One click signs you in as a seeded user. No SMS or code needed.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {users.length === 0 && <p className="text-sm text-slate-500">No active users found. Run pnpm db:seed to create the test accounts.</p>}
        {ROLE_GROUPS.map(({ role, title }) => {
          const group = users.filter((u) => u.role === role);
          if (group.length === 0) return null;
          return (
            <section key={role} aria-labelledby={`dev-login-${role}`}>
              <h3 id={`dev-login-${role}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {title} <span className="font-normal normal-case">({group.length})</span>
              </h3>
              {role === OrgRole.WORKER && (
                <p className="mb-2 text-xs text-slate-500">Workers use the mobile app; on the web they only see a notice.</p>
              )}
              <ul className="grid gap-2 sm:grid-cols-2">
                {group.map((user) => (
                  <li key={user.membershipId}>
                    <button
                      type="button"
                      onClick={() => signIn(user)}
                      disabled={pendingId !== null}
                      aria-label={`Sign in as ${user.fullLegalName} (${title.replace(/s$/, "")})`}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="block font-medium text-slate-900">{pendingId === user.membershipId ? "Signing in…" : user.fullLegalName}</span>
                      <span className="block text-xs text-slate-500" dir="ltr">
                        {user.phoneNumber}
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
