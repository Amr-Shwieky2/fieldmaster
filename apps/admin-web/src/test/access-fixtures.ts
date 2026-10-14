import type { MyAccess } from "@fieldmaster/api-client";
import { OrgRole, Permission, SYSTEM_ROLE_PERMISSIONS, SystemRoleKey, permissionsForScope } from "@fieldmaster/shared-types";

/**
 * `GET /auth/me` answers for tests of the flexible organization model: the
 * built-in roles, two custom roles (one without money, one with it) and a
 * member restricted to some projects.
 */

const TODAY_RULES: MyAccess["workRules"] = {
  standardDayMinutes: 540,
  overtimeThresholdMinutes: 540,
  emergencyMinutesBefore: 60,
  emergencyMinutesAfter: 15,
  clockInEarlyWindowMinutes: 60,
};

const ALL_PROJECTS: MyAccess["scope"] = { restricted: false, projectIds: [], siteIds: [], visibleProjectIds: [] };

export function myAccess(overrides: Partial<MyAccess> = {}): MyAccess {
  return {
    userId: "u-1",
    membershipId: "m-1",
    organizationId: "org-1",
    role: OrgRole.CUSTOM,
    roleId: "role-custom",
    roleName: "دور تجريبي",
    permissions: [],
    isTimeTrackable: false,
    workerProfileId: null,
    workRules: TODAY_RULES,
    scope: ALL_PROJECTS,
    ...overrides,
  };
}

/** A built-in role as /auth/me answers it. */
export function builtInAccess(role: SystemRoleKey, overrides: Partial<MyAccess> = {}): MyAccess {
  return myAccess({ role, roleId: `role-${role.toLowerCase()}`, roleName: null, permissions: [...SYSTEM_ROLE_PERMISSIONS[role]], ...overrides });
}

/** «منسق الحضور»: a custom role without any money (attendance, schedule, operational reports, reads the settings). */
export const COORDINATOR = myAccess({
  roleId: "role-coordinator",
  roleName: "منسق الحضور",
  permissions: [
    Permission.VIEW_ATTENDANCE,
    Permission.APPROVE_ATTENDANCE,
    Permission.VIEW_SHIFTS,
    Permission.VIEW_OPERATIONS,
    Permission.GENERATE_OPERATIONAL_REPORTS,
    Permission.VIEW_ORG_SETTINGS,
  ],
});

/** «محاسب»: a custom role with the money (payroll, the financial dashboard and reports). */
export const ACCOUNTANT = myAccess({
  roleId: "role-accountant",
  roleName: "محاسب",
  permissions: [
    Permission.VIEW_FINANCIALS,
    Permission.VIEW_COMPENSATION,
    Permission.VIEW_PAYROLL,
    Permission.MANAGE_PAYROLL,
    Permission.VIEW_FINANCIAL_DASHBOARD,
    Permission.GENERATE_OPERATIONAL_REPORTS,
    Permission.GENERATE_FINANCIAL_REPORTS,
    Permission.VIEW_ATTENDANCE,
  ],
});

/** An Owner restricted to one project: /auth/me leaves out every organization-wide permission. */
export const RESTRICTED_OWNER = builtInAccess(SystemRoleKey.OWNER, {
  permissions: permissionsForScope(SYSTEM_ROLE_PERMISSIONS.OWNER, true),
  scope: { restricted: true, projectIds: ["pr-1"], siteIds: [], visibleProjectIds: ["pr-1"] },
});

/**
 * A `useAuth()` double with the access fields the real provider exposes
 * (for `vi.mock("@/lib/auth-context", ...)` in page and component tests).
 */
export function authWithAccess(access: MyAccess, client: unknown = {}) {
  const permissions = new Set(access.permissions);
  return {
    client,
    session: { accessToken: "test-access", refreshToken: "test-refresh", organizationId: access.organizationId, role: access.role, workerProfileId: access.workerProfileId },
    isAuthenticated: true,
    isReady: true,
    access,
    accessStatus: "ready" as const,
    permissions,
    can: (permission: Permission) => permissions.has(permission),
    canAny: (list: readonly Permission[]) => list.some((permission) => permissions.has(permission)),
    login: () => {},
    logout: () => {},
    loadAccess: async () => {},
    refreshAccess: async () => {},
  };
}
