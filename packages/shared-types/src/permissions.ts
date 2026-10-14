/**
 * The permission catalog (flexible organization model).
 *
 * What a member sees and can do comes from the permissions of their role,
 * never from a role's name. The built-in roles (the Owner, the Field Manager
 * and the Worker) are SYSTEM roles whose permissions are fixed here; an
 * Owner can create custom roles from the same catalog.
 *
 * The API (guards and services), the admin web (the role editor and the
 * navigation) and the mobile app all read this one file.
 */

export const Permission = {
  // الحضور
  CLOCK_IN_OUT: "CLOCK_IN_OUT",
  VIEW_OWN_ATTENDANCE: "VIEW_OWN_ATTENDANCE",
  /** Read every worker's attendance (the attendance list, entries, evidence, infractions, call-outs): read only, no approving. */
  VIEW_ATTENDANCE: "VIEW_ATTENDANCE",
  /** The live operations page: operational only, no money. */
  VIEW_OPERATIONS: "VIEW_OPERATIONS",
  APPROVE_ATTENDANCE: "APPROVE_ATTENDANCE",
  CORRECT_TIME_ENTRIES: "CORRECT_TIME_ENTRIES",
  APPLY_FULL_DAY_CREDIT: "APPLY_FULL_DAY_CREDIT",
  // الجدولة
  /** Read every shift (read-only schedule); without it a member sees their own shifts only. */
  VIEW_SHIFTS: "VIEW_SHIFTS",
  MANAGE_SHIFTS: "MANAGE_SHIFTS",
  MANAGE_TURAN: "MANAGE_TURAN",
  MANAGE_TEMP_SUPERVISORS: "MANAGE_TEMP_SUPERVISORS",
  // المواقع
  MANAGE_SITES: "MANAGE_SITES",
  // العمال
  MANAGE_WORKERS: "MANAGE_WORKERS",
  APPROVE_ONBOARDING: "APPROVE_ONBOARDING",
  // الرواتب والمالية
  /** "رؤية المبالغ المالية": the one permission that opens every amount of money (budgets, rates, costs, penalties). The others in this group need it. */
  VIEW_FINANCIALS: "VIEW_FINANCIALS",
  VIEW_COMPENSATION: "VIEW_COMPENSATION",
  MANAGE_COMPENSATION: "MANAGE_COMPENSATION",
  VIEW_BANK_INFO: "VIEW_BANK_INFO",
  VIEW_PAYROLL: "VIEW_PAYROLL",
  MANAGE_PAYROLL: "MANAGE_PAYROLL",
  FINALIZE_PAYROLL: "FINALIZE_PAYROLL",
  VIEW_FINANCIAL_DASHBOARD: "VIEW_FINANCIAL_DASHBOARD",
  // التقارير
  GENERATE_OPERATIONAL_REPORTS: "GENERATE_OPERATIONAL_REPORTS",
  /** The financial copy of the reports that have one (needs VIEW_FINANCIALS). */
  GENERATE_FINANCIAL_REPORTS: "GENERATE_FINANCIAL_REPORTS",
  // الإعدادات
  VIEW_ORG_SETTINGS: "VIEW_ORG_SETTINGS",
  MANAGE_ORG_SETTINGS: "MANAGE_ORG_SETTINGS",
  MANAGE_ORG_USERS: "MANAGE_ORG_USERS",
  /** Create, edit and archive custom roles. */
  MANAGE_ROLES: "MANAGE_ROLES",
  // سجل التدقيق
  VIEW_AUDIT_LOG: "VIEW_AUDIT_LOG",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

export const PermissionGroup = {
  ATTENDANCE: "ATTENDANCE",
  SCHEDULING: "SCHEDULING",
  SITES: "SITES",
  WORKERS: "WORKERS",
  FINANCE: "FINANCE",
  REPORTS: "REPORTS",
  SETTINGS: "SETTINGS",
  AUDIT: "AUDIT",
} as const;
export type PermissionGroup = (typeof PermissionGroup)[keyof typeof PermissionGroup];

/** The groups in the order the role editor shows them (الحضور، الجدولة، المواقع، العمال، الرواتب والمالية، التقارير، الإعدادات، سجل التدقيق). */
export const PERMISSION_GROUPS: readonly { group: PermissionGroup; permissions: readonly Permission[] }[] = [
  {
    group: PermissionGroup.ATTENDANCE,
    permissions: [
      Permission.CLOCK_IN_OUT,
      Permission.VIEW_OWN_ATTENDANCE,
      Permission.VIEW_ATTENDANCE,
      Permission.VIEW_OPERATIONS,
      Permission.APPROVE_ATTENDANCE,
      Permission.CORRECT_TIME_ENTRIES,
      Permission.APPLY_FULL_DAY_CREDIT,
    ],
  },
  {
    group: PermissionGroup.SCHEDULING,
    permissions: [Permission.VIEW_SHIFTS, Permission.MANAGE_SHIFTS, Permission.MANAGE_TURAN, Permission.MANAGE_TEMP_SUPERVISORS],
  },
  { group: PermissionGroup.SITES, permissions: [Permission.MANAGE_SITES] },
  { group: PermissionGroup.WORKERS, permissions: [Permission.MANAGE_WORKERS, Permission.APPROVE_ONBOARDING] },
  {
    group: PermissionGroup.FINANCE,
    permissions: [
      Permission.VIEW_FINANCIALS,
      Permission.VIEW_COMPENSATION,
      Permission.MANAGE_COMPENSATION,
      Permission.VIEW_BANK_INFO,
      Permission.VIEW_PAYROLL,
      Permission.MANAGE_PAYROLL,
      Permission.FINALIZE_PAYROLL,
      Permission.VIEW_FINANCIAL_DASHBOARD,
    ],
  },
  { group: PermissionGroup.REPORTS, permissions: [Permission.GENERATE_OPERATIONAL_REPORTS, Permission.GENERATE_FINANCIAL_REPORTS] },
  {
    group: PermissionGroup.SETTINGS,
    permissions: [Permission.VIEW_ORG_SETTINGS, Permission.MANAGE_ORG_SETTINGS, Permission.MANAGE_ORG_USERS, Permission.MANAGE_ROLES],
  },
  { group: PermissionGroup.AUDIT, permissions: [Permission.VIEW_AUDIT_LOG] },
];

/**
 * Everything that opens an amount of money. Field Managers, Workers and
 * Temporary Supervisors never hold one of these by default; a custom role
 * gets them only by an Owner ticking the financial group.
 */
export const FINANCIAL_PERMISSION_LIST: readonly Permission[] = [
  Permission.VIEW_FINANCIALS,
  Permission.VIEW_COMPENSATION,
  Permission.MANAGE_COMPENSATION,
  Permission.VIEW_BANK_INFO,
  Permission.VIEW_PAYROLL,
  Permission.MANAGE_PAYROLL,
  Permission.FINALIZE_PAYROLL,
  Permission.VIEW_FINANCIAL_DASHBOARD,
  Permission.GENERATE_FINANCIAL_REPORTS,
];

export function isFinancialPermission(permission: string): boolean {
  return (FINANCIAL_PERMISSION_LIST as readonly string[]).includes(permission);
}

/** A permission that needs other permissions in the same role (ticking it ticks them; removing them removes it). */
export const PERMISSION_REQUIRES: Readonly<Partial<Record<Permission, readonly Permission[]>>> = {
  [Permission.APPROVE_ATTENDANCE]: [Permission.VIEW_ATTENDANCE],
  [Permission.CORRECT_TIME_ENTRIES]: [Permission.VIEW_ATTENDANCE],
  [Permission.APPLY_FULL_DAY_CREDIT]: [Permission.VIEW_ATTENDANCE],
  [Permission.MANAGE_SHIFTS]: [Permission.VIEW_SHIFTS],
  [Permission.VIEW_COMPENSATION]: [Permission.VIEW_FINANCIALS],
  [Permission.MANAGE_COMPENSATION]: [Permission.VIEW_FINANCIALS, Permission.VIEW_COMPENSATION],
  [Permission.VIEW_BANK_INFO]: [Permission.VIEW_FINANCIALS],
  [Permission.VIEW_PAYROLL]: [Permission.VIEW_FINANCIALS],
  [Permission.MANAGE_PAYROLL]: [Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL],
  [Permission.FINALIZE_PAYROLL]: [Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL],
  [Permission.VIEW_FINANCIAL_DASHBOARD]: [Permission.VIEW_FINANCIALS],
  [Permission.GENERATE_FINANCIAL_REPORTS]: [Permission.VIEW_FINANCIALS, Permission.GENERATE_OPERATIONAL_REPORTS],
  [Permission.MANAGE_ORG_SETTINGS]: [Permission.VIEW_ORG_SETTINGS],
  [Permission.MANAGE_ROLES]: [Permission.VIEW_ORG_SETTINGS],
};

/**
 * Permissions about the whole organization, not about a place: payroll
 * months, the audit log, users, roles, settings, onboarding applicants,
 * pay rates, the Turan rota. A member restricted to some projects never
 * has them (their effective permissions leave them out), whatever their
 * role says.
 */
export const ORG_WIDE_PERMISSION_LIST: readonly Permission[] = [
  Permission.MANAGE_ORG_USERS,
  Permission.MANAGE_ROLES,
  Permission.MANAGE_ORG_SETTINGS,
  Permission.VIEW_AUDIT_LOG,
  Permission.VIEW_PAYROLL,
  Permission.MANAGE_PAYROLL,
  Permission.FINALIZE_PAYROLL,
  Permission.VIEW_FINANCIAL_DASHBOARD,
  Permission.MANAGE_COMPENSATION,
  Permission.APPROVE_ONBOARDING,
  Permission.VIEW_BANK_INFO,
  Permission.MANAGE_TURAN,
];

export function isOrgWidePermission(permission: string): boolean {
  return (ORG_WIDE_PERMISSION_LIST as readonly string[]).includes(permission);
}

/** Whoever manages roles and settings: an organization always keeps at least one active member holding all of these. */
export const ADMIN_PERMISSIONS: readonly Permission[] = [Permission.MANAGE_ROLES, Permission.MANAGE_ORG_SETTINGS];

/** The built-in roles. Their permissions are fixed (never edited, never archived) and are the ones the system had before roles became configurable. */
export const SystemRoleKey = {
  OWNER: "OWNER",
  FIELD_MANAGER: "FIELD_MANAGER",
  WORKER: "WORKER",
} as const;
export type SystemRoleKey = (typeof SystemRoleKey)[keyof typeof SystemRoleKey];

export const SYSTEM_ROLE_PERMISSIONS: Readonly<Record<SystemRoleKey, readonly Permission[]>> = {
  [SystemRoleKey.OWNER]: ALL_PERMISSIONS,
  [SystemRoleKey.FIELD_MANAGER]: [
    Permission.MANAGE_WORKERS,
    Permission.APPROVE_ONBOARDING,
    Permission.MANAGE_SITES,
    Permission.VIEW_SHIFTS,
    Permission.MANAGE_SHIFTS,
    Permission.MANAGE_TURAN,
    Permission.VIEW_ATTENDANCE,
    Permission.APPROVE_ATTENDANCE,
    Permission.CORRECT_TIME_ENTRIES,
    Permission.APPLY_FULL_DAY_CREDIT,
    Permission.MANAGE_TEMP_SUPERVISORS,
    Permission.CLOCK_IN_OUT,
    Permission.VIEW_OWN_ATTENDANCE,
    Permission.VIEW_OPERATIONS,
    Permission.VIEW_ORG_SETTINGS,
    Permission.GENERATE_OPERATIONAL_REPORTS,
  ],
  [SystemRoleKey.WORKER]: [Permission.CLOCK_IN_OUT, Permission.VIEW_OWN_ATTENDANCE],
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/** A role's permissions with the ones they require added (ticking one in the editor does the same). */
export function withRequiredPermissions(permissions: Iterable<Permission>): Permission[] {
  const result = new Set<Permission>(permissions);
  let grew = true;
  while (grew) {
    grew = false;
    for (const permission of [...result]) {
      for (const required of PERMISSION_REQUIRES[permission] ?? []) {
        if (!result.has(required)) {
          result.add(required);
          grew = true;
        }
      }
    }
  }
  return ALL_PERMISSIONS.filter((permission) => result.has(permission));
}

export interface PermissionProblem {
  permission: string;
  /** UNKNOWN: not in the catalog. MISSING_REQUIRED: a permission it needs is not in the role. */
  kind: "UNKNOWN" | "MISSING_REQUIRED";
  /** The permissions it needs that are missing. */
  missing?: Permission[];
}

/** What is wrong with a custom role's permission list (empty: it can be saved). */
export function checkRolePermissions(permissions: readonly string[]): PermissionProblem[] {
  const problems: PermissionProblem[] = [];
  const known = new Set<string>(permissions.filter(isPermission));
  for (const permission of permissions) {
    if (!isPermission(permission)) {
      problems.push({ permission, kind: "UNKNOWN" });
      continue;
    }
    const missing = (PERMISSION_REQUIRES[permission] ?? []).filter((required) => !known.has(required));
    if (missing.length > 0) problems.push({ permission, kind: "MISSING_REQUIRED", missing: [...missing] });
  }
  return problems;
}

export function holdsAdminPermissions(permissions: ReadonlySet<string> | readonly string[]): boolean {
  const set = permissions instanceof Set ? permissions : new Set(permissions as readonly string[]);
  return ADMIN_PERMISSIONS.every((permission) => set.has(permission));
}

/** What a member restricted to some projects keeps of their role's permissions. */
export function permissionsForScope(permissions: Iterable<Permission>, restricted: boolean): Permission[] {
  const all = [...permissions];
  return restricted ? all.filter((permission) => !isOrgWidePermission(permission)) : all;
}
