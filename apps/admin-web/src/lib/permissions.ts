import {
  ALL_PERMISSIONS,
  PERMISSION_REQUIRES,
  Permission,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRoleKey,
  withRequiredPermissions,
} from "@fieldmaster/shared-types";

/**
 * Permission helpers of the admin web (flexible organization model). What a
 * member sees comes from the permissions of their role -- never from the
 * role's name. The effective permissions come from `GET /auth/me`; until it
 * answers (or with an API that cannot tell), a built-in role's fixed
 * permissions stand in for them. A built-in role's permissions only ever
 * shrink at /auth/me (a member restricted to some projects loses the
 * organization-wide ones), so the stand-in never hides something the member
 * may see; a custom role's permissions are only known from /auth/me.
 */

/** The built-in roles: their permissions are fixed and known without asking the API. */
export function isSystemRoleKind(role: string | null | undefined): role is SystemRoleKey {
  return role === SystemRoleKey.OWNER || role === SystemRoleKey.FIELD_MANAGER || role === SystemRoleKey.WORKER;
}

/** A built-in role's permissions; none for a custom role (only `GET /auth/me` knows them). */
export function rolePermissions(role: string | null | undefined): readonly Permission[] {
  return isSystemRoleKind(role) ? SYSTEM_ROLE_PERMISSIONS[role] : [];
}

/** The effective permissions: `GET /auth/me`'s answer when there is one, else the session's built-in role's. */
export function permissionsFor(access: { permissions: readonly string[] } | null | undefined, role: string | null | undefined): ReadonlySet<Permission> {
  if (access) return new Set(access.permissions as readonly Permission[]);
  return new Set(rolePermissions(role));
}

/** What a worker does on the phone (their own clock-in and attendance); every other permission belongs to the admin web. */
const WORKER_OWN_PERMISSIONS: readonly Permission[] = [Permission.CLOCK_IN_OUT, Permission.VIEW_OWN_ATTENDANCE];

/** Any of these opens the admin web's own pages (the dashboard, the notifications). */
export const ADMIN_WEB_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter((permission) => !WORKER_OWN_PERMISSIONS.includes(permission));

/**
 * The role editor's checklist rule: ticking a permission ticks what it
 * requires; unticking one unticks every permission that needs it (directly or
 * through another). The result is in catalog order.
 */
export function togglePermission(selected: Iterable<Permission>, permission: Permission, checked: boolean): Permission[] {
  if (checked) return withRequiredPermissions([...selected, permission]);
  const remaining = new Set([...selected].filter((candidate) => candidate !== permission));
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of [...remaining]) {
      if ((PERMISSION_REQUIRES[candidate] ?? []).some((required) => !remaining.has(required))) {
        remaining.delete(candidate);
        changed = true;
      }
    }
  }
  return ALL_PERMISSIONS.filter((candidate) => remaining.has(candidate));
}
