"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FieldMasterClient } from "@fieldmaster/api-client";
import type { OrgRole } from "@fieldmaster/shared-types";
import { sessionStore, type StoredSession } from "./session-store";
import { decodeJwtPayload } from "./jwt";

interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  role: OrgRole;
  workerProfileId: string | null;
}

interface AuthContextValue {
  session: StoredSession | null;
  client: FieldMasterClient;
  isAuthenticated: boolean;
  login: (session: Omit<StoredSession, "workerProfileId">) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<StoredSession | null>(() => sessionStore.load());

  const logout = useCallback(() => {
    sessionStore.clear();
    setSession(null);
    router.replace("/login");
  }, [router]);

  const client = useMemo(
    () =>
      new FieldMasterClient({
        baseUrl: API_URL,
        getAccessToken: () => sessionStore.load()?.accessToken ?? null,
        onUnauthorized: () => logout(),
      }),
    [logout],
  );

  const login = useCallback((partial: Omit<StoredSession, "workerProfileId">) => {
    const payload = decodeJwtPayload<AccessTokenPayload>(partial.accessToken);
    const full: StoredSession = { ...partial, workerProfileId: payload?.workerProfileId ?? null };
    sessionStore.save(full);
    setSession(full);
  }, []);

  const value: AuthContextValue = { session, client, isAuthenticated: session !== null, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
