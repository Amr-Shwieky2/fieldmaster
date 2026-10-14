import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";

/**
 * Deep links from notifications: one mapping for a tapped push notification
 * (its data payload) and for a notification tapped in the app's list (its
 * `type` + `dataJson`), so both open the same screen.
 *
 * Push payload: `{ notificationId, type, timeEntryId?, shiftId?, calloutId?, assignmentId?, yearMonth? }`.
 */

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export interface NotificationLinkData {
  notificationId: string | null;
  type: string | null;
  timeEntryId: string | null;
  shiftId: string | null;
  calloutId: string | null;
  assignmentId: string | null;
  yearMonth: string | null;
}

/**
 * Where a notification leads. ShiftDetails and Emergency are the work-flow
 * screens; the rest are the platform screens. Unknown or incomplete data
 * opens the notifications list.
 */
export type LinkTarget =
  | { name: "HistoryDetail"; params: { timeEntryId: string } }
  | { name: "ShiftDetails"; params: { shiftId: string } }
  | { name: "Salary"; params: { yearMonth?: string } }
  | { name: "Supervisor"; params: { assignmentId: string } }
  | { name: "Emergency"; params?: undefined }
  | { name: "Notifications"; params?: undefined };

/**
 * Notifications about other people (sent to Owners and Field Managers). The
 * worker app has no screen for them, and the ids in them are not the
 * caller's own: they open the list, never a detail screen.
 */
const MANAGER_TYPES = new Set([
  "WORKER_CLOCKED_IN",
  "WORKER_CLOCKED_OUT",
  "OVERTIME_THRESHOLD_CROSSED",
  "SHIFT_AWAITING_APPROVAL",
  "ONBOARDING_SUBMITTED",
  "OFFLINE_EVENT_SYNCED",
  "OFFLINE_EVENT_REJECTED",
  "SUSPICIOUS_LOCATION_DETECTED",
  "TEMPORARY_SUPERVISOR_ISSUE_REPORTED",
]);

const EMERGENCY_TYPES = new Set(["EMERGENCY_SHIFT_STARTED", "EMERGENCY_SHIFT_ENDED"]);

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function text(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Reads the link fields from a push payload or an in-app notification's `dataJson` (anything else is ignored). */
export function parseNotificationData(raw: unknown, type?: string | null): NotificationLinkData {
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const yearMonth = text(source, "yearMonth");
  return {
    notificationId: text(source, "notificationId"),
    type: type ?? text(source, "type"),
    timeEntryId: text(source, "timeEntryId"),
    shiftId: text(source, "shiftId"),
    calloutId: text(source, "calloutId"),
    assignmentId: text(source, "assignmentId"),
    yearMonth: yearMonth && YEAR_MONTH.test(yearMonth) ? yearMonth : null,
  };
}

/** The screen a notification opens (the same rules for a push tap and a tap in the list). */
export function targetForNotification(data: NotificationLinkData): LinkTarget {
  if (data.type !== null && MANAGER_TYPES.has(data.type)) return { name: "Notifications" };
  if (data.calloutId || (data.type !== null && EMERGENCY_TYPES.has(data.type))) return { name: "Emergency" };
  if (data.assignmentId) return { name: "Supervisor", params: { assignmentId: data.assignmentId } };
  if (data.yearMonth || data.type === "PAYROLL_FINALIZED") return { name: "Salary", params: data.yearMonth ? { yearMonth: data.yearMonth } : {} };
  if (data.timeEntryId) return { name: "HistoryDetail", params: { timeEntryId: data.timeEntryId } };
  if (data.shiftId) return { name: "ShiftDetails", params: { shiftId: data.shiftId } };
  return { name: "Notifications" };
}

/** Shortcut for an in-app notification. */
export function targetForInAppNotification(notification: { type: string; dataJson: Record<string, unknown> | null }): LinkTarget {
  return targetForNotification(parseNotificationData(notification.dataJson, notification.type));
}

/** A navigator-like object (the container ref, or a screen's `navigation`). */
export interface Navigator {
  navigate: (...args: never[]) => void;
}

/** The target, or the notifications list when its screen is not mounted (e.g. a work-flow screen missing from this build). */
export function resolveAvailableTarget(target: LinkTarget, routeNames: readonly string[] | null): LinkTarget {
  if (!routeNames || routeNames.includes(target.name)) return target;
  return { name: "Notifications" };
}

/** Navigates any navigator to a link target (route names outside this file's types included). */
export function navigateToTarget(navigator: Navigator, target: LinkTarget): void {
  (navigator.navigate as (name: string, params?: object) => void)(target.name, target.params);
}

// ── Taps that arrive before the screens exist (cold start, or signed out) ──

let pending: LinkTarget | null = null;

/** Opens the target now if the signed-in screens are mounted, otherwise as soon as they are. */
export function openLinkTarget(target: LinkTarget): void {
  pending = target;
  flushPendingLink();
}

/** Called when the navigator is ready and whenever its screens change (after sign-in). */
export function flushPendingLink(): void {
  if (!pending || !navigationRef.isReady()) return;
  const routeNames = navigationRef.getRootState()?.routeNames ?? [];
  // Only once the signed-in stack is there (not the sign-in or account-state screen).
  if (!routeNames.includes("Notifications")) return;
  const target = resolveAvailableTarget(pending, routeNames);
  pending = null;
  navigateToTarget(navigationRef, target);
}

/** Tests only. */
export function clearPendingLinkForTests(): void {
  pending = null;
}
