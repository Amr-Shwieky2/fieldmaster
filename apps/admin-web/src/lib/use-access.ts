"use client";

import { useMemo } from "react";
import type { MyAccess } from "@fieldmaster/api-client";
import { OrgRole, type Permission } from "@fieldmaster/shared-types";
import { useEnumLabel } from "@/i18n/enums";
import { useAuth, type AccessStatus, type AuthContextValue } from "./auth-context";
import { isSystemRoleKind, permissionsFor } from "./permissions";

export interface Access {
  /**
   * False while `GET /auth/me`'s first answer is awaited (and, for a custom
   * role, before it was even asked: only /auth/me knows its permissions).
   * Guards wait instead of deciding from a guess.
   */
  ready: boolean;
  status: AccessStatus;
  /** The effective permissions (see lib/permissions.ts). */
  permissions: ReadonlySet<Permission>;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  canAll: (permissions: readonly Permission[]) => boolean;
  /** The kind of role: OWNER / FIELD_MANAGER / WORKER for the built-in roles, CUSTOM for one an Owner created. */
  roleKind: OrgRole | null;
  /** A custom role's own name (the built-in roles are shown with their Arabic labels). */
  roleName: string | null;
  /** Restricted to some projects or sites: such a member never has the organization-wide permissions. */
  restricted: boolean;
  /** The raw `GET /auth/me` answer (null until it answers, or when it cannot be read). */
  access: MyAccess | null;
}

/**
 * What the signed-in member may see and do. Pages decide from `can(...)`,
 * never from a role's name. A context without the access fields (a minimal
 * test double of `useAuth`, like an API without /auth/me) falls back to the
 * session's built-in role.
 */
export function useAccess(): Access {
  const auth: Partial<AuthContextValue> = useAuth();
  const role = auth.session?.role ?? null;
  const access = auth.access ?? null;
  const status = auth.accessStatus ?? "idle";
  const provided = auth.permissions;
  // A built-in role's fixed permissions can stand in until /auth/me is read; a custom role's cannot (when it can be read at all).
  const waitsForAccess = status === "idle" && role !== null && !isSystemRoleKind(role) && typeof auth.loadAccess === "function";
  return useMemo(() => {
    const permissions = provided ?? permissionsFor(access, role);
    const has = (permission: Permission) => permissions.has(permission);
    return {
      ready: status !== "loading" && !waitsForAccess,
      status,
      permissions,
      can: has,
      canAny: (list) => list.some(has),
      canAll: (list) => list.every(has),
      roleKind: (access?.role ?? role) as OrgRole | null,
      roleName: access?.role === OrgRole.CUSTOM ? access.roleName : null,
      restricted: access?.scope?.restricted === true,
      access,
    };
  }, [provided, access, role, status, waitsForAccess]);
}

/** The signed-in member's role as shown: a custom role's own name, else the built-in role's Arabic label. */
export function useRoleLabel(): string | null {
  const { roleKind, roleName } = useAccess();
  const label = useEnumLabel();
  if (!roleKind) return null;
  if (roleKind === OrgRole.CUSTOM) return roleName ?? label("OrgRole", OrgRole.CUSTOM);
  return label("OrgRole", roleKind);
}
