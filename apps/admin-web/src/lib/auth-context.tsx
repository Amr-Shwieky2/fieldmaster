"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
  /** False until the stored session has been read on the client; guards must wait for it before redirecting. */
  isReady: boolean;
  login: (session: Omit<StoredSession, "workerProfileId">) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Query keys are not scoped per user, so every change of signed-in user
  // must drop the cache -- otherwise, after quick-switching from an Owner to
  // a Field Manager, the Field Manager briefly sees the Owner's cached
  // responses (e.g. worker compensation the API never sends to them).
  const queryClient = useQueryClient();
  // localStorage only exists in the browser, so reading it during the first
  // render made the server HTML (no session -> loading state) differ from the
  // client's first render (session -> full shell): a hydration mismatch on
  // every authenticated page load. Read it after mount instead.
  const [session, setSession] = useState<StoredSession | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setSession(sessionStore.load());
    setIsReady(true);
  }, []);

  const logout = useCallback(() => {
    sessionStore.clear();
    queryClient.clear();
    setSession(null);
    router.replace("/login");
  }, [router, queryClient]);

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
    queryClient.clear();
    setSession(full);
  }, [queryClient]);

  const value: AuthContextValue = { session, client, isAuthenticated: session !== null, isReady, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
