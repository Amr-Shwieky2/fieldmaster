import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { MyAccess } from "@fieldmaster/api-client";
import { Permission, SYSTEM_ROLE_PERMISSIONS, SystemRoleKey } from "@fieldmaster/shared-types";
import { useAuth } from "./auth-context";

/**
 * What the signed-in member may see and do on the phone, from
 * `GET /auth/me` (mobile manager mode): their permissions, project scope,
 * whether they clock in themselves, and the work rules in force (no money).
 * Screens decide from `can(...)`, never from a role's name.
 *
 * Until `/auth/me` answers -- or when it cannot be reached (offline) -- a
 * built-in role's fixed permissions stand in (they only ever shrink at
 * `/auth/me`, for a member restricted to some projects); a custom role's are
 * only known from `/auth/me`, so the app waits for it.
 */

export type AccessStatus = "idle" | "loading" | "ready" | "error";

/** A worker's own: their clock-in and attendance. Every other permission opens the manager screens. */
const WORKER_OWN_PERMISSIONS: readonly Permission[] = [Permission.CLOCK_IN_OUT, Permission.VIEW_OWN_ATTENDANCE];

export interface AccessValue {
  status: AccessStatus;
  /** The last `/auth/me` answer (null before it or when it could not be read). */
  access: MyAccess | null;
  /** The effective permissions (from `/auth/me`, or a built-in role's stand-in). */
  permissions: ReadonlySet<Permission>;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  /** Holds a permission beyond a worker's own: the manager home and its tabs. */
  isManager: boolean;
  /** Clocks in themselves (a worker profile with time tracking): the «دوامي» screens and «راتبي». */
  hasWorkerHome: boolean;
  /** Restricted to some projects or sites: every list shows only those. */
  restricted: boolean;
  /** The rules in force today that the app shows (minutes only, never money); null until known. */
  workRules: MyAccess["workRules"] | null;
  /** Reads `/auth/me` again (after a role or scope change, or a retry). */
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessValue | null>(null);

function isSystemRoleKey(role: string | null | undefined): role is SystemRoleKey {
  return role === SystemRoleKey.OWNER || role === SystemRoleKey.FIELD_MANAGER || role === SystemRoleKey.WORKER;
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const { session, client } = useAuth();
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [status, setStatus] = useState<AccessStatus>("idle");
  const sessionKey = session ? `${session.organizationId}:${session.refreshToken.split(":")[0] ?? ""}` : null;
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionKey) return;
    const call = ++latest.current;
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const answer = await client.getMyAccess();
      if (call !== latest.current) return;
      setAccess(answer);
      setStatus("ready");
    } catch {
      if (call !== latest.current) return;
      setStatus((current) => (current === "ready" ? "ready" : "error"));
    }
  }, [client, sessionKey]);

  // A new session (sign-in, another account): forget the previous member's access and read it again.
  useEffect(() => {
    latest.current += 1;
    setAccess(null);
    setStatus(sessionKey ? "loading" : "idle");
    if (sessionKey) void refresh();
  }, [sessionKey, refresh]);

  // Back to the foreground: a role or scope may have changed meanwhile.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const role = session?.role ?? null;
  const value = useMemo<AccessValue>(() => {
    const builtIn = isSystemRoleKey(role);
    const permissions: ReadonlySet<Permission> = access ? new Set(access.permissions) : new Set(builtIn ? SYSTEM_ROLE_PERMISSIONS[role] : []);
    const has = (permission: Permission) => permissions.has(permission);
    const hasWorkerProfile = access ? access.workerProfileId !== null && access.isTimeTrackable : (session?.workerProfileId ?? null) !== null;
    return {
      // Ready with an answer, or with a built-in role's stand-in; a custom role waits for /auth/me ("loading", or "error" to retry).
      status: !sessionKey ? "idle" : access || builtIn ? "ready" : status,
      access,
      permissions,
      can: has,
      canAny: (list) => list.some(has),
      isManager: [...permissions].some((permission) => !WORKER_OWN_PERMISSIONS.includes(permission)),
      hasWorkerHome: hasWorkerProfile && has(Permission.CLOCK_IN_OUT),
      restricted: access?.scope.restricted === true,
      workRules: access?.workRules ?? null,
      refresh,
    };
  }, [access, role, session?.workerProfileId, sessionKey, status, refresh]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

const noRefresh = async () => undefined;

/**
 * The member's access. Outside an AccessProvider (a screen rendered on its
 * own, with only the session) it is the session's built-in role's stand-in.
 */
export function useAccess(): AccessValue {
  const value = useContext(AccessContext);
  const { session } = useAuth();
  const role = session?.role ?? null;
  const workerProfileId = session?.workerProfileId ?? null;
  const standIn = useMemo<AccessValue>(() => {
    const permissions: ReadonlySet<Permission> = new Set(isSystemRoleKey(role) ? SYSTEM_ROLE_PERMISSIONS[role] : []);
    const has = (permission: Permission) => permissions.has(permission);
    return {
      status: session ? "ready" : "idle",
      access: null,
      permissions,
      can: has,
      canAny: (list) => list.some(has),
      isManager: [...permissions].some((permission) => !WORKER_OWN_PERMISSIONS.includes(permission)),
      hasWorkerHome: workerProfileId !== null && has(Permission.CLOCK_IN_OUT),
      restricted: false,
      workRules: null,
      refresh: noRefresh,
    };
  }, [role, workerProfileId, session]);
  return value ?? standIn;
}
