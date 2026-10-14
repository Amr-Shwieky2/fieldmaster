import { FINANCIAL_PERMISSION_LIST, ORG_WIDE_PERMISSION_LIST, OrgRole, Permission, SYSTEM_ROLE_PERMISSIONS, type SystemRoleKey } from "@fieldmaster/shared-types";

/**
 * The permission catalog lives in `@fieldmaster/shared-types` (the admin web's
 * role editor and the mobile app read the same file). What a member can do
 * comes from the permissions of their role -- the built-in roles' fixed sets
 * below, or a custom role's own list -- never from the role's name.
 */
export {
  ADMIN_PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_REQUIRES,
  Permission,
  SYSTEM_ROLE_PERMISSIONS,
} from "@fieldmaster/shared-types";

/** Everything that opens an amount of money (see the catalog). */
export const FINANCIAL_PERMISSIONS: ReadonlySet<Permission> = new Set(FINANCIAL_PERMISSION_LIST);

/** The permissions a member restricted to some projects never has. */
export const ORG_WIDE_PERMISSIONS: ReadonlySet<Permission> = new Set(ORG_WIDE_PERMISSION_LIST);

/** The built-in roles' permissions. A CUSTOM member has none here: theirs come from the role record. */
export const ROLE_PERMISSIONS: Record<OrgRole, Set<Permission>> = {
  [OrgRole.OWNER]: new Set(SYSTEM_ROLE_PERMISSIONS.OWNER),
  [OrgRole.FIELD_MANAGER]: new Set(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER),
  [OrgRole.WORKER]: new Set(SYSTEM_ROLE_PERMISSIONS.WORKER),
  [OrgRole.CUSTOM]: new Set(),
};

/** Whether a built-in role (by kind) holds a permission. Members are checked with `hasPermission`, which also covers custom roles. */
export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** The kind's system role key, or null for a custom role. */
export function systemRoleKey(role: OrgRole): SystemRoleKey | null {
  return role === OrgRole.CUSTOM ? null : (role as SystemRoleKey);
}

/** The slice of the authenticated user the permission checks read. */
export interface PermissionHolder {
  role: OrgRole;
  /** The member's effective permissions (role, minus the organization-wide ones when restricted to projects). Absent: derived from the built-in role. */
  permissions?: ReadonlySet<Permission>;
}

/** Does the member hold the permission? Uses the effective set the guard resolved; a holder without one (a plain `{ role }`) gets its built-in role's. */
export function hasPermission(holder: PermissionHolder, permission: Permission): boolean {
  return holder.permissions ? holder.permissions.has(permission) : roleHasPermission(holder.role, permission);
}

export function hasAnyPermission(holder: PermissionHolder, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(holder, permission));
}

export function hasAllPermissions(holder: PermissionHolder, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => hasPermission(holder, permission));
}

/** May see any amount of money (budgets, rates, penalties, costs): the one financial gate. */
export function canViewFinancials(holder: PermissionHolder): boolean {
  return hasPermission(holder, Permission.VIEW_FINANCIALS);
}
