import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSIONS,
  FINANCIAL_PERMISSION_LIST,
  ORG_WIDE_PERMISSION_LIST,
  OrgRole,
  PERMISSION_GROUPS,
  PERMISSION_REQUIRES,
  Permission,
  SYSTEM_ROLE_PERMISSIONS,
  checkRolePermissions,
  holdsAdminPermissions,
  isFinancialPermission,
  isOrgWidePermission,
  permissionsForScope,
  withRequiredPermissions,
} from "@fieldmaster/shared-types";
import { effectivePermissionsOf, permissionsOfRole } from "../member-access";
import { canViewFinancials, hasPermission, roleHasPermission } from "../permissions";

/** The permission catalog and how a member's effective permissions come out of their role (flexible organization model). */

describe("the catalog", () => {
  it("lists every permission exactly once, in groups, in the order the editor shows", () => {
    const listed = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect([...listed].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(PERMISSION_GROUPS.map((group) => group.group)).toEqual(["ATTENDANCE", "SCHEDULING", "SITES", "WORKERS", "FINANCE", "REPORTS", "SETTINGS", "AUDIT"]);
  });

  it("makes every money permission depend on the one financial permission", () => {
    for (const permission of FINANCIAL_PERMISSION_LIST) {
      if (permission === Permission.VIEW_FINANCIALS) continue;
      expect(PERMISSION_REQUIRES[permission] ?? []).toContain(Permission.VIEW_FINANCIALS);
    }
    // And only the finance group (plus the financial copy of the reports) is money.
    expect(FINANCIAL_PERMISSION_LIST.filter((permission) => !PERMISSION_GROUPS.find((group) => group.group === "FINANCE")!.permissions.includes(permission))).toEqual([
      Permission.GENERATE_FINANCIAL_REPORTS,
    ]);
    expect(isFinancialPermission(Permission.VIEW_PAYROLL)).toBe(true);
    expect(isFinancialPermission(Permission.MANAGE_SHIFTS)).toBe(false);
  });

  it("completes a permission list with what it requires, and reports what is missing or unknown", () => {
    expect(withRequiredPermissions([Permission.MANAGE_PAYROLL])).toEqual([Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL, Permission.MANAGE_PAYROLL]);
    expect(checkRolePermissions([Permission.MANAGE_SHIFTS, Permission.VIEW_SHIFTS])).toEqual([]);
    expect(checkRolePermissions([Permission.MANAGE_SHIFTS])).toEqual([{ permission: Permission.MANAGE_SHIFTS, kind: "MISSING_REQUIRED", missing: [Permission.VIEW_SHIFTS] }]);
    expect(checkRolePermissions(["FLY_THE_PLANE"])).toEqual([{ permission: "FLY_THE_PLANE", kind: "UNKNOWN" }]);
  });
});

describe("the built-in roles keep exactly the permissions they always had (plus the read permissions that gate what they could already do)", () => {
  it("the Owner holds everything; the Field Manager and the Worker no money, nothing organization-wide that is Owner-only", () => {
    expect([...SYSTEM_ROLE_PERMISSIONS.OWNER].sort()).toEqual([...ALL_PERMISSIONS].sort());
    for (const key of ["FIELD_MANAGER", "WORKER"] as const) {
      for (const permission of SYSTEM_ROLE_PERMISSIONS[key]) expect({ key, permission, financial: isFinancialPermission(permission) }).toEqual({ key, permission, financial: false });
    }
    expect([...SYSTEM_ROLE_PERMISSIONS.WORKER].sort()).toEqual([Permission.CLOCK_IN_OUT, Permission.VIEW_OWN_ATTENDANCE].sort());
    for (const manager of [
      Permission.MANAGE_WORKERS,
      Permission.APPROVE_ONBOARDING,
      Permission.MANAGE_SITES,
      Permission.MANAGE_SHIFTS,
      Permission.MANAGE_TURAN,
      Permission.APPROVE_ATTENDANCE,
      Permission.CORRECT_TIME_ENTRIES,
      Permission.APPLY_FULL_DAY_CREDIT,
      Permission.MANAGE_TEMP_SUPERVISORS,
      Permission.CLOCK_IN_OUT,
      Permission.VIEW_OWN_ATTENDANCE,
      Permission.VIEW_OPERATIONS,
      Permission.VIEW_ORG_SETTINGS,
    ]) {
      expect(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER).toContain(manager);
    }
    for (const owner of [Permission.MANAGE_ORG_USERS, Permission.MANAGE_ROLES, Permission.MANAGE_ORG_SETTINGS, Permission.VIEW_AUDIT_LOG]) {
      expect(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER).not.toContain(owner);
    }
    // Each built-in role is a complete set: it holds what its permissions require.
    for (const key of ["OWNER", "FIELD_MANAGER", "WORKER"] as const) expect({ key, problems: checkRolePermissions([...SYSTEM_ROLE_PERMISSIONS[key]]) }).toEqual({ key, problems: [] });
  });

  it("only an administrator role holds the administrator permissions", () => {
    expect(ADMIN_PERMISSIONS).toEqual([Permission.MANAGE_ROLES, Permission.MANAGE_ORG_SETTINGS]);
    expect(holdsAdminPermissions(SYSTEM_ROLE_PERMISSIONS.OWNER)).toBe(true);
    expect(holdsAdminPermissions(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER)).toBe(false);
    expect(holdsAdminPermissions([Permission.MANAGE_ROLES])).toBe(false);
  });
});

describe("a member's effective permissions", () => {
  const custom = { id: "r1", name: "Accountant", systemKey: null, permissions: [Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL, Permission.MANAGE_ORG_USERS, "NOT_A_PERMISSION"] };

  it("comes from the role record for a custom role (unknown names ignored) and from the code for a built-in role", () => {
    expect([...permissionsOfRole(OrgRole.CUSTOM, custom)].sort()).toEqual([Permission.MANAGE_ORG_USERS, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL].sort());
    expect(permissionsOfRole(OrgRole.CUSTOM, null).size).toBe(0);
    expect(permissionsOfRole(OrgRole.WORKER, null)).toEqual(new Set([Permission.CLOCK_IN_OUT, Permission.VIEW_OWN_ATTENDANCE]));
    // A built-in kind ignores whatever its role record says: the code is the source.
    expect(permissionsOfRole(OrgRole.WORKER, { ...custom, permissions: [Permission.MANAGE_ROLES] }).has(Permission.MANAGE_ROLES)).toBe(false);
  });

  it("loses the organization-wide permissions when restricted to some projects, and keeps the money one", () => {
    const unrestricted = effectivePermissionsOf({ role: OrgRole.CUSTOM, roleRecord: custom, restrictedToScope: false });
    const restricted = effectivePermissionsOf({ role: OrgRole.CUSTOM, roleRecord: custom, restrictedToScope: true });
    expect(unrestricted.has(Permission.MANAGE_ORG_USERS)).toBe(true);
    expect(restricted.has(Permission.MANAGE_ORG_USERS)).toBe(false);
    expect(restricted.has(Permission.VIEW_PAYROLL)).toBe(false);
    expect(restricted.has(Permission.VIEW_FINANCIALS)).toBe(true);
    expect(isOrgWidePermission(Permission.VIEW_PAYROLL)).toBe(true);
    expect(ORG_WIDE_PERMISSION_LIST).toContain(Permission.MANAGE_ROLES);
    expect(permissionsForScope([Permission.MANAGE_ROLES, Permission.VIEW_SHIFTS], true)).toEqual([Permission.VIEW_SHIFTS]);
  });

  it("is what the checks read: the resolved set when there is one, else the built-in role's", () => {
    expect(hasPermission({ role: OrgRole.OWNER }, Permission.VIEW_PAYROLL)).toBe(true);
    expect(hasPermission({ role: OrgRole.FIELD_MANAGER }, Permission.VIEW_PAYROLL)).toBe(false);
    expect(hasPermission({ role: OrgRole.CUSTOM }, Permission.VIEW_SHIFTS)).toBe(false);
    expect(hasPermission({ role: OrgRole.CUSTOM, permissions: new Set([Permission.VIEW_SHIFTS]) }, Permission.VIEW_SHIFTS)).toBe(true);
    // A set that does not hold it wins over the role's name: an Owner restricted to a project has no payroll.
    expect(hasPermission({ role: OrgRole.OWNER, permissions: new Set() }, Permission.VIEW_PAYROLL)).toBe(false);
    expect(canViewFinancials({ role: OrgRole.CUSTOM, permissions: new Set([Permission.VIEW_FINANCIALS]) })).toBe(true);
    expect(roleHasPermission(OrgRole.CUSTOM, Permission.VIEW_FINANCIALS)).toBe(false);
  });
});
