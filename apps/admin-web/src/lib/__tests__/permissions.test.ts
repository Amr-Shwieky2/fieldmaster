import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, OrgRole, Permission, SYSTEM_ROLE_PERMISSIONS, checkRolePermissions } from "@fieldmaster/shared-types";
import { ADMIN_WEB_PERMISSIONS, isSystemRoleKind, permissionsFor, rolePermissions, togglePermission } from "../permissions";

describe("permission helpers", () => {
  it("knows the built-in roles' fixed permissions, and none of a custom role's", () => {
    expect(isSystemRoleKind(OrgRole.OWNER)).toBe(true);
    expect(isSystemRoleKind(OrgRole.CUSTOM)).toBe(false);
    expect(rolePermissions(OrgRole.OWNER)).toEqual(ALL_PERMISSIONS);
    expect(rolePermissions(OrgRole.FIELD_MANAGER)).toEqual(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER);
    expect(rolePermissions(OrgRole.CUSTOM)).toEqual([]);
    expect(rolePermissions(undefined)).toEqual([]);
  });

  it("takes /auth/me's permissions when there are some, else the session's built-in role's", () => {
    expect([...permissionsFor({ permissions: [Permission.VIEW_ATTENDANCE] }, OrgRole.OWNER)]).toEqual([Permission.VIEW_ATTENDANCE]);
    expect(permissionsFor(null, OrgRole.FIELD_MANAGER).has(Permission.VIEW_PAYROLL)).toBe(false);
    expect(permissionsFor(null, OrgRole.OWNER).has(Permission.VIEW_PAYROLL)).toBe(true);
    expect(permissionsFor(null, OrgRole.CUSTOM).size).toBe(0);
  });

  it("opens the admin web with any permission beyond a worker's own clock-in and attendance", () => {
    expect(ADMIN_WEB_PERMISSIONS).not.toContain(Permission.CLOCK_IN_OUT);
    expect(ADMIN_WEB_PERMISSIONS).not.toContain(Permission.VIEW_OWN_ATTENDANCE);
    expect(ADMIN_WEB_PERMISSIONS).toHaveLength(ALL_PERMISSIONS.length - 2);
    expect(SYSTEM_ROLE_PERMISSIONS.WORKER.some((permission) => ADMIN_WEB_PERMISSIONS.includes(permission))).toBe(false);
  });

  describe("togglePermission (the role editor's checklist rule)", () => {
    it("ticks what a permission requires, transitively, in catalog order", () => {
      expect(togglePermission([], Permission.MANAGE_PAYROLL, true)).toEqual([Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL, Permission.MANAGE_PAYROLL]);
      expect(togglePermission([Permission.VIEW_SHIFTS], Permission.APPROVE_ATTENDANCE, true)).toEqual([
        Permission.VIEW_ATTENDANCE,
        Permission.APPROVE_ATTENDANCE,
        Permission.VIEW_SHIFTS,
      ]);
      expect(togglePermission([], Permission.GENERATE_FINANCIAL_REPORTS, true)).toEqual([
        Permission.VIEW_FINANCIALS,
        Permission.GENERATE_OPERATIONAL_REPORTS,
        Permission.GENERATE_FINANCIAL_REPORTS,
      ]);
    });

    it("unticks what depends on a permission (directly or through another), and nothing else", () => {
      const money = togglePermission(
        [Permission.VIEW_ATTENDANCE, Permission.FINALIZE_PAYROLL, Permission.MANAGE_COMPENSATION, Permission.GENERATE_FINANCIAL_REPORTS],
        Permission.VIEW_ATTENDANCE,
        true,
      );
      expect(togglePermission(money, Permission.VIEW_FINANCIALS, false)).toEqual([Permission.VIEW_ATTENDANCE, Permission.GENERATE_OPERATIONAL_REPORTS]);
      expect(togglePermission(money, Permission.VIEW_PAYROLL, false)).toEqual([
        Permission.VIEW_ATTENDANCE,
        Permission.VIEW_FINANCIALS,
        Permission.VIEW_COMPENSATION,
        Permission.MANAGE_COMPENSATION,
        Permission.GENERATE_OPERATIONAL_REPORTS,
        Permission.GENERATE_FINANCIAL_REPORTS,
      ]);
      expect(togglePermission([Permission.VIEW_ORG_SETTINGS, Permission.MANAGE_ROLES], Permission.MANAGE_ROLES, false)).toEqual([Permission.VIEW_ORG_SETTINGS]);
    });

    it("always gives a list the API accepts", () => {
      let selected: Permission[] = [];
      for (const permission of ALL_PERMISSIONS) {
        selected = togglePermission(selected, permission, true);
        expect(checkRolePermissions(selected)).toEqual([]);
      }
      expect(selected).toEqual(ALL_PERMISSIONS);
      for (const permission of ALL_PERMISSIONS) {
        selected = togglePermission(selected, permission, false);
        expect(checkRolePermissions(selected)).toEqual([]);
      }
      expect(selected).toEqual([]);
    });
  });
});
