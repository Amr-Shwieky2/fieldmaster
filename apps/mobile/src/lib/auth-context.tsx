import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiRequestError, FieldMasterClient } from "@fieldmaster/api-client";
import { getErrorCode, isNetworkError } from "@fieldmaster/i18n";
import type { OrgRole } from "@fieldmaster/shared-types";
import type { AccountState, AccountStateKind } from "./account-state";
import { API_URL } from "./api-url";
import { clearDeviceKeyUnlocked, withDeviceKeyLock } from "./device-key";
import { decodeJwtPayload } from "./jwt";
import { clearQueueAfterKeyRevocation } from "./offline-queue";
import { requestTokenRefresh, withSessionRecovery, type RecoveryDecision } from "./session-recovery";
import { sessionStore, type StoredSession } from "./session-store";

interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  role: OrgRole;
  workerProfileId: string | null;
}

export type { AccountState, AccountStateKind } from "./account-state";

interface AuthContextValue {
  session: StoredSession | null;
  client: FieldMasterClient;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (session: Omit<StoredSession, "workerProfileId">) => Promise<void>;
  logout: () => Promise<void>;
  /** Set while the account-state screen is shown (no other screen is mounted then). */
  accountState: AccountState | null;
  /** The sign-in answered with an account state (pending approval, rejected, suspended). */
  showAccountState: (kind: AccountStateKind) => void;
  /** Leaves the account-state screen for the sign-in screen. */
  dismissAccountState: () => void;
  /**
   * An Owner revoked this device's key (from PUT /devices/me or a sync): clears
   * the queue, the key and the session, and asks the worker to sign in again.
   * After that sign-in a new key is generated and registered.
   */
  reportDeviceKeyRevoked: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** The session with what the access token says (a refreshed token carries the role and worker profile as they are now). */
function withWorkerProfile(partial: Omit<StoredSession, "workerProfileId">): StoredSession {
  const payload = decodeJwtPayload<Partial<AccessTokenPayload>>(partial.accessToken);
  return {
    ...partial,
    role: payload?.role ?? partial.role,
    organizationId: payload?.organizationId ?? partial.organizationId,
    workerProfileId: payload?.workerProfileId ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accountState, setAccountState] = useState<AccountState | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const refreshing = useRef<Promise<RecoveryDecision> | null>(null);
  const revoking = useRef<Promise<void> | null>(null);

  const applySession = useCallback((next: StoredSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    let active = true;
    sessionStore
      .load()
      .catch(() => null) // the Keychain / Keystore could not be read: start signed out (nothing is deleted)
      .then((loaded) => {
        if (!active) return;
        // A sign-in that finished while the stored session was loading wins.
        if (sessionRef.current === null) applySession(loaded);
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applySession]);

  /** Ends the session on this phone (and shows `next` when it is an account state). */
  const endSession = useCallback(
    async (next: AccountState | null) => {
      applySession(null);
      if (next) setAccountState(next);
      await sessionStore.clear().catch(() => undefined);
    },
    [applySession],
  );

  // The raw client reads the token from the ref when each call starts, so it never has to be re-created.
  const rawClient = useMemo(() => new FieldMasterClient({ baseUrl: API_URL, getAccessToken: () => sessionRef.current?.accessToken ?? null }), []);

  /** One refresh at a time: every call that failed with the same expired token waits for it. */
  const refreshSession = useCallback(
    (expired: StoredSession): Promise<RecoveryDecision> => {
      refreshing.current ??= (async (): Promise<RecoveryDecision> => {
        try {
          const tokens = await requestTokenRefresh(API_URL, expired.refreshToken);
          if (sessionRef.current?.refreshToken !== expired.refreshToken) return "throw"; // signed out meanwhile
          const next = withWorkerProfile({ ...expired, ...tokens });
          applySession(next);
          await sessionStore.save(next).catch(() => undefined);
          return "retry";
        } catch (error) {
          if (isNetworkError(error)) return "throw"; // offline: keep the session, the call's own error is shown
          const code = getErrorCode(error);
          if (code === "NO_ACTIVE_MEMBERSHIP" || code === "ACCOUNT_SUSPENDED") await endSession({ kind: "SUSPENDED" });
          else if (error instanceof ApiRequestError && (error.status === 401 || error.status === 400)) await endSession(null);
          return "throw";
        }
      })().finally(() => {
        refreshing.current = null;
      });
      return refreshing.current;
    },
    [applySession, endSession],
  );

  const onApiError = useCallback(
    async (error: unknown, tokenAtCall: string | null): Promise<RecoveryDecision> => {
      const current = sessionRef.current;
      if (!current || tokenAtCall === null) return "throw";
      if (getErrorCode(error) === "ACCOUNT_SUSPENDED") {
        await endSession({ kind: "SUSPENDED" });
        return "throw";
      }
      if (!(error instanceof ApiRequestError) || error.status !== 401) return "throw";
      // Another call refreshed the session after this one started: just try again with the new token.
      if (current.accessToken !== tokenAtCall) return "retry";
      return refreshSession(current);
    },
    [endSession, refreshSession],
  );

  const client = useMemo(() => withSessionRecovery(rawClient, onApiError, () => sessionRef.current?.accessToken ?? null), [rawClient, onApiError]);

  const login = useCallback(
    async (partial: Omit<StoredSession, "workerProfileId">) => {
      const full = withWorkerProfile(partial);
      await sessionStore.save(full);
      setAccountState(null);
      applySession(full);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const current = sessionRef.current;
    // Ends the session on the server too, which also stops push notifications to this phone (best effort,
    // never blocking the sign-out: offline, the session simply expires on the server).
    if (current) rawClient.logout(current.refreshToken).catch(() => undefined);
    await endSession(null);
  }, [endSession, rawClient]);

  const showAccountState = useCallback((kind: AccountStateKind) => setAccountState({ kind }), []);
  const dismissAccountState = useCallback(() => setAccountState(null), []);

  const reportDeviceKeyRevoked = useCallback((): Promise<void> => {
    revoking.current ??= (async () => {
      const droppedEvents = await clearQueueAfterKeyRevocation().catch(() => 0);
      await withDeviceKeyLock(clearDeviceKeyUnlocked).catch(() => undefined);
      const current = sessionRef.current;
      if (current) rawClient.logout(current.refreshToken).catch(() => undefined);
      await endSession({ kind: "DEVICE_KEY_REVOKED", droppedEvents });
    })().finally(() => {
      revoking.current = null;
    });
    return revoking.current;
  }, [endSession, rawClient]);

  const value: AuthContextValue = {
    session,
    client,
    isAuthenticated: session !== null,
    isLoading,
    login,
    logout,
    accountState,
    showAccountState,
    dismissAccountState,
    reportDeviceKeyRevoked,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
