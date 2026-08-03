import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
  isLoading: boolean;
  login: (session: Omit<StoredSession, "workerProfileId">) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Points at localhost via the platform-appropriate host for the Expo dev
// server's Metro proxy / simulator networking; override with EXPO_PUBLIC_API_URL.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    sessionStore.load().then((loaded) => {
      setSession(loaded);
      setIsLoading(false);
    });
  }, []);

  const logout = useCallback(async () => {
    await sessionStore.clear();
    setSession(null);
  }, []);

  const client = useMemo(
    () =>
      new FieldMasterClient({
        baseUrl: API_URL,
        getAccessToken: () => session?.accessToken ?? null,
        onUnauthorized: () => {
          logout();
        },
      }),
    [session?.accessToken, logout],
  );

  const login = useCallback(async (partial: Omit<StoredSession, "workerProfileId">) => {
    const payload = decodeJwtPayload<AccessTokenPayload>(partial.accessToken);
    const full: StoredSession = { ...partial, workerProfileId: payload?.workerProfileId ?? null };
    await sessionStore.save(full);
    setSession(full);
  }, []);

  const value: AuthContextValue = { session, client, isAuthenticated: session !== null, isLoading, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
