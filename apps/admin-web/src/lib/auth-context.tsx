"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FieldMasterClient, type MyAccess } from "@fieldmaster/api-client";
import type { OrgRole, Permission } from "@fieldmaster/shared-types";
import { sessionStore, type StoredSession } from "./session-store";
import { decodeJwtPayload } from "./jwt";
import { API_URL } from "./api-url";
import { permissionsFor } from "./permissions";

interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  role: OrgRole;
  workerProfileId: string | null;
}

/**
 * Where the signed-in member's `GET /auth/me` stands: "idle" until the
 * signed-in shell asks for it, "loading" until its first answer, then
 * "ready" (the effective permissions and the project scope are known) or
 * "failed" (an API without it, or unreachable: the built-in role's fixed
 * permissions stand in, see lib/permissions.ts).
 */
export type AccessStatus = "idle" | "loading" | "ready" | "failed";

export interface AuthContextValue {
  session: StoredSession | null;
  client: FieldMasterClient;
  isAuthenticated: boolean;
  /** False until the stored session has been read on the client; guards must wait for it before redirecting. */
  isReady: boolean;
  login: (session: Omit<StoredSession, "workerProfileId">) => void;
  logout: () => void;
  /** The member's role, effective permissions and project scope from `GET /auth/me` (null until it answers, or when it cannot be read). */
  access: MyAccess | null;
  accessStatus: AccessStatus;
  /** The effective permissions (/auth/me's, else the session's built-in role's). What a page shows is decided from these, never from a role's name. */
  permissions: ReadonlySet<Permission>;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  /** Reads `GET /auth/me` for the session unless it is already read (or being read): the signed-in shell calls it after sign-in and on every page load. */
  loadAccess: () => Promise<void>;
  /** Reads it again once it was loaded (a change of role or scope applies at the next request): on window focus and after such a change. */
  refreshAccess: () => Promise<void>;
}

interface AccessState {
  /** The access token the answer belongs to (a new sign-in starts over). */
  token: string;
  status: "loading" | "ready" | "failed";
  access: MyAccess | null;
}

/** Focus and visibility events come in pairs; one read per burst is enough. */
const FOCUS_REFRESH_INTERVAL_MS = 2_000;

const AuthContext = createContext<AuthContextValue | null>(null);

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
  // The access is component state, not a React Query entry: it belongs to the
  // session (like the tokens), and the query cache only ever holds page data.
  const [accessState, setAccessState] = useState<AccessState | null>(null);
  const accessRef = useRef<AccessState | null>(null);
  const latestRequest = useRef(0);
  const lastRequestAt = useRef(0);

  useEffect(() => {
    setSession(sessionStore.load());
    setIsReady(true);
  }, []);

  const updateAccess = useCallback((next: AccessState | null | ((previous: AccessState | null) => AccessState | null)) => {
    const value = typeof next === "function" ? next(accessRef.current) : next;
    accessRef.current = value;
    setAccessState(value);
  }, []);

  const logout = useCallback(() => {
    sessionStore.clear();
    queryClient.clear();
    latestRequest.current += 1;
    updateAccess(null);
    setSession(null);
    router.replace("/login");
  }, [router, queryClient, updateAccess]);

  // The client never changes identity (the access callbacks below depend on it); a 401 always signs out with the latest `logout`.
  const logoutRef = useRef(logout);
  useLayoutEffect(() => {
    logoutRef.current = logout;
  }, [logout]);
  const client = useMemo(
    () =>
      new FieldMasterClient({
        baseUrl: API_URL,
        getAccessToken: () => sessionStore.load()?.accessToken ?? null,
        onUnauthorized: () => logoutRef.current(),
      }),
    [],
  );

  const login = useCallback(
    (partial: Omit<StoredSession, "workerProfileId">) => {
      const payload = decodeJwtPayload<AccessTokenPayload>(partial.accessToken);
      const full: StoredSession = { ...partial, workerProfileId: payload?.workerProfileId ?? null };
      sessionStore.save(full);
      queryClient.clear();
      latestRequest.current += 1;
      updateAccess(null);
      setSession(full);
    },
    [queryClient, updateAccess],
  );

  /**
   * One read of `GET /auth/me`. Only the latest request of the current
   * session counts. A failed first read falls back to the built-in role's
   * permissions; a failed later read keeps what was already known.
   */
  const fetchAccess = useCallback(
    async (mode: "load" | "refresh") => {
      const token = sessionStore.load()?.accessToken ?? null;
      if (!token) return;
      const known = accessRef.current?.token === token;
      // Loading is once per session (later reads are refreshes); a refresh needs a first load (the signed-in shell's).
      if (mode === "load" ? known : !known) return;
      if (!known) updateAccess({ token, status: "loading", access: null });
      const request = ++latestRequest.current;
      lastRequestAt.current = Date.now();
      const stillCurrent = () => request === latestRequest.current && sessionStore.load()?.accessToken === token;
      try {
        const access = await client.getMyAccess();
        if (stillCurrent()) updateAccess({ token, status: "ready", access });
      } catch {
        if (stillCurrent()) updateAccess((previous) => (previous?.token === token && previous.access ? previous : { token, status: "failed", access: null }));
      }
    },
    [client, updateAccess],
  );
  const loadAccess = useCallback(() => fetchAccess("load"), [fetchAccess]);
  const refreshAccess = useCallback(() => fetchAccess("refresh"), [fetchAccess]);

  const token = session?.accessToken ?? null;
  const current = token !== null && accessState?.token === token ? accessState : null;
  const accessStatus: AccessStatus = current?.status ?? "idle";
  const access = current?.access ?? null;
  const role = session?.role ?? null;
  const permissions = useMemo(() => permissionsFor(access, role), [access, role]);
  const can = useCallback((permission: Permission) => permissions.has(permission), [permissions]);
  const canAny = useCallback((list: readonly Permission[]) => list.some((permission) => permissions.has(permission)), [permissions]);

  // A role or scope change applies at the member's next request: read it again when the window comes back.
  const accessRequested = accessStatus !== "idle";
  useEffect(() => {
    if (!accessRequested) return;
    const onFocus = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastRequestAt.current < FOCUS_REFRESH_INTERVAL_MS) return;
      void refreshAccess();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [accessRequested, refreshAccess]);

  const value: AuthContextValue = {
    session,
    client,
    isAuthenticated: session !== null,
    isReady,
    login,
    logout,
    access,
    accessStatus,
    permissions,
    can,
    canAny,
    loadAccess,
    refreshAccess,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
