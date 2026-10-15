import type { Prisma } from "@prisma/client";
import { NotificationType, OrgRole } from "@fieldmaster/shared-types";
import { Permission, hasPermission, type PermissionHolder } from "../../common/auth/permissions";
import { CONFIGURABLE_NOTIFICATIONS, type ConfigurableNotificationType } from "../../common/settings/organization-settings.service";
/**
 * The permission a member's role needs to receive each manager-facing
 * notification (flexible organization model). The built-in Owner and Field
 * Manager roles hold all of them, so for them nothing changed; a custom role
 * receives a notification only when it holds the permission.
 */
export const NOTIFICATION_PERMISSION: Record<ConfigurableNotificationType, Permission> = {
  [NotificationType.WORKER_CLOCKED_IN]: Permission.VIEW_OPERATIONS,
  [NotificationType.WORKER_CLOCKED_OUT]: Permission.VIEW_OPERATIONS,
  [NotificationType.OVERTIME_THRESHOLD_CROSSED]: Permission.VIEW_OPERATIONS,
  [NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED]: Permission.VIEW_OPERATIONS,
  [NotificationType.EMERGENCY_SHIFT_STARTED]: Permission.VIEW_ATTENDANCE,
  [NotificationType.EMERGENCY_SHIFT_ENDED]: Permission.VIEW_ATTENDANCE,
  [NotificationType.ONBOARDING_SUBMITTED]: Permission.APPROVE_ONBOARDING,
  [NotificationType.OFFLINE_EVENT_REJECTED]: Permission.VIEW_ATTENDANCE,
  [NotificationType.SUSPICIOUS_LOCATION_DETECTED]: Permission.VIEW_ATTENDANCE,
};



/**
 * A member's own push preferences (Step 9), stored on their membership
 * (`organization_memberships.notification_preferences`) as
 * `{ [NotificationType]: { push: boolean } }`. In-app notifications are
 * always created; only push delivery follows these switches. A type without
 * an entry has push on.
 */

/** What the API sends to a member with a worker profile (time-trackable): about their own attendance and assignments. */
export const WORKER_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NotificationType.SHIFT_APPROVED,
  NotificationType.SHIFT_REJECTED,
  NotificationType.TURAN_ASSIGNMENT_CREATED,
  NotificationType.TURAN_ASSIGNMENT_CHANGED,
  NotificationType.WORKER_APPROVED,
];

/** What the API sends to Owners and Field Managers (the manager-facing types of the organization's notification settings). */
export const MANAGER_NOTIFICATION_TYPES = Object.keys(CONFIGURABLE_NOTIFICATIONS) as NotificationType[];

/**
 * Every type the member can receive today: the manager-facing ones whose
 * permission their role holds (every one for an Owner or Field Manager), and
 * the worker-facing ones for anyone with a worker profile (a Worker, or a
 * time-trackable member of any role). Types the API never sends (e.g.
 * PAYROLL_FINALIZED) are not listed. Pass a plain role, or the member (with
 * their effective permissions).
 */
export function receivableNotificationTypes(member: OrgRole | PermissionHolder, hasWorkerProfile: boolean): NotificationType[] {
  const holder: PermissionHolder = typeof member === "string" ? { role: member } : member;
  const types = new Set<NotificationType>();
  for (const type of MANAGER_NOTIFICATION_TYPES) {
    if (hasPermission(holder, NOTIFICATION_PERMISSION[type as ConfigurableNotificationType])) types.add(type);
  }
  if (holder.role === OrgRole.WORKER || hasWorkerProfile) for (const type of WORKER_NOTIFICATION_TYPES) types.add(type);
  // In the enum's order, so the settings screen lists them in a stable order.
  return (Object.values(NotificationType) as NotificationType[]).filter((type) => types.has(type));
}

/** The stored JSON, read defensively: an entry that is not `{ push: boolean }` counts as unset (push on). */
export function readPushPreferences(value: Prisma.JsonValue | null | undefined): Partial<Record<string, boolean>> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<string, boolean>> = {};
  for (const [type, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).push === "boolean") {
      result[type] = (entry as { push: boolean }).push;
    }
  }
  return result;
}

/** Push for this type, unless the member switched it off. */
export function isPushEnabled(value: Prisma.JsonValue | null | undefined, type: string): boolean {
  return readPushPreferences(value)[type] ?? true;
}

/** The stored JSON with the given switches applied (others kept). */
export function withPushPreferences(value: Prisma.JsonValue | null | undefined, changes: readonly { type: string; push: boolean }[]): Prisma.InputJsonObject {
  const current = readPushPreferences(value);
  for (const change of changes) current[change.type] = change.push;
  return Object.fromEntries(Object.entries(current).map(([type, push]) => [type, { push: push as boolean }]));
}
