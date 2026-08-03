import { OrgRole } from "@fieldmaster/shared-types";

export enum Permission {
  MANAGE_ORG_USERS = "MANAGE_ORG_USERS",
  MANAGE_WORKERS = "MANAGE_WORKERS",
  APPROVE_ONBOARDING = "APPROVE_ONBOARDING",
  VIEW_COMPENSATION = "VIEW_COMPENSATION",
  MANAGE_COMPENSATION = "MANAGE_COMPENSATION",
  VIEW_BANK_INFO = "VIEW_BANK_INFO",
  MANAGE_SITES = "MANAGE_SITES",
  MANAGE_SHIFTS = "MANAGE_SHIFTS",
  MANAGE_TURAN = "MANAGE_TURAN",
  APPROVE_ATTENDANCE = "APPROVE_ATTENDANCE",
  CORRECT_TIME_ENTRIES = "CORRECT_TIME_ENTRIES",
  APPLY_FULL_DAY_CREDIT = "APPLY_FULL_DAY_CREDIT",
  MANAGE_TEMP_SUPERVISORS = "MANAGE_TEMP_SUPERVISORS",
  VIEW_PAYROLL = "VIEW_PAYROLL",
  MANAGE_PAYROLL = "MANAGE_PAYROLL",
  FINALIZE_PAYROLL = "FINALIZE_PAYROLL",
  VIEW_AUDIT_LOG = "VIEW_AUDIT_LOG",
  VIEW_FINANCIAL_DASHBOARD = "VIEW_FINANCIAL_DASHBOARD",
  CLOCK_IN_OUT = "CLOCK_IN_OUT",
  VIEW_OWN_ATTENDANCE = "VIEW_OWN_ATTENDANCE",
}

const OWNER_PERMISSIONS: Permission[] = Object.values(Permission);

const FIELD_MANAGER_PERMISSIONS: Permission[] = [
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
];

const WORKER_PERMISSIONS: Permission[] = [Permission.CLOCK_IN_OUT, Permission.VIEW_OWN_ATTENDANCE];

export const ROLE_PERMISSIONS: Record<OrgRole, Set<Permission>> = {
  [OrgRole.OWNER]: new Set(OWNER_PERMISSIONS),
  [OrgRole.FIELD_MANAGER]: new Set(FIELD_MANAGER_PERMISSIONS),
  [OrgRole.WORKER]: new Set(WORKER_PERMISSIONS),
};

/**
 * Financial permissions Field Managers and Temporary Supervisors must never
 * hold, enforced redundantly at the guard, service, and DTO layers (spec
 * section 6.2 / 23.5).
 */
export const FINANCIAL_PERMISSIONS = new Set<Permission>([
  Permission.VIEW_COMPENSATION,
  Permission.MANAGE_COMPENSATION,
  Permission.VIEW_BANK_INFO,
  Permission.VIEW_PAYROLL,
  Permission.MANAGE_PAYROLL,
  Permission.FINALIZE_PAYROLL,
  Permission.VIEW_FINANCIAL_DASHBOARD,
]);

export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
