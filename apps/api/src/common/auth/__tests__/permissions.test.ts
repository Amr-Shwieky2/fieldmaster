import { OrgRole } from "@fieldmaster/shared-types";
import { FINANCIAL_PERMISSIONS, Permission, roleHasPermission } from "../permissions";

describe("permissions", () => {
  it("grants Owners every permission, including all financial ones", () => {
    for (const permission of Object.values(Permission)) {
      expect(roleHasPermission(OrgRole.OWNER, permission)).toBe(true);
    }
  });

  it("never grants a Field Manager any financial permission (spec section 6.2 / 31.3)", () => {
    for (const permission of FINANCIAL_PERMISSIONS) {
      expect(roleHasPermission(OrgRole.FIELD_MANAGER, permission)).toBe(false);
    }
  });

  it("grants Field Managers operational permissions", () => {
    expect(roleHasPermission(OrgRole.FIELD_MANAGER, Permission.APPROVE_ATTENDANCE)).toBe(true);
    expect(roleHasPermission(OrgRole.FIELD_MANAGER, Permission.APPLY_FULL_DAY_CREDIT)).toBe(true);
    expect(roleHasPermission(OrgRole.FIELD_MANAGER, Permission.MANAGE_SHIFTS)).toBe(true);
  });

  it("never grants a Worker any financial or management permission", () => {
    for (const permission of FINANCIAL_PERMISSIONS) {
      expect(roleHasPermission(OrgRole.WORKER, permission)).toBe(false);
    }
    expect(roleHasPermission(OrgRole.WORKER, Permission.MANAGE_SHIFTS)).toBe(false);
    expect(roleHasPermission(OrgRole.WORKER, Permission.APPROVE_ATTENDANCE)).toBe(false);
  });

  it("grants Workers only their own clock-in/out and attendance-history permissions", () => {
    expect(roleHasPermission(OrgRole.WORKER, Permission.CLOCK_IN_OUT)).toBe(true);
    expect(roleHasPermission(OrgRole.WORKER, Permission.VIEW_OWN_ATTENDANCE)).toBe(true);
  });
});
