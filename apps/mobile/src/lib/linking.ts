import { createNavigationContainerRef } from "@react-navigation/native";
import type { NotificationAction } from "@fieldmaster/api-client";
import type { RootStackParamList } from "../navigation/types";

/**
 * Deep links from notifications: one mapping for a tapped push notification
 * (its data payload) and for a notification tapped in the app's list (its
 * `type` + `dataJson`, and since the mobile manager mode its `action`), so
 * both open the same screen.
 *
 * Push payload: `{ notificationId, type, subjectId?, timeEntryId?, shiftId?, calloutId?, assignmentId?, turanAssignmentId?, issueId?, yearMonth? }`.
 * A push never carries a worker's id (it can show on a locked screen): the
 * notifications that need one (a worker's offline records, an application)
 * open the list, whose row carries the full action.
 */

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export interface NotificationLinkData {
  notificationId: string | null;
  type: string | null;
  /** Mobile manager mode: what a manager's actionable notification is about (shared by every manager's copy). */
  subjectId: string | null;
  timeEntryId: string | null;
  shiftId: string | null;
  calloutId: string | null;
  assignmentId: string | null;
  /** A temporary supervisor's report. */
  issueId: string | null;
  yearMonth: string | null;
}

/**
 * Where a notification leads. ShiftDetails and Emergency are the work-flow
 * screens; the review screens are the manager's (mobile manager mode, opened
 * with the subject they settle); the rest are the platform screens. Unknown
 * or incomplete data opens the notifications list.
 */
export type LinkTarget =
  | { name: "HistoryDetail"; params: { timeEntryId: string } }
  | { name: "ShiftDetails"; params: { shiftId: string } }
  | { name: "Salary"; params: { yearMonth?: string } }
  | { name: "Supervisor"; params: { assignmentId: string } }
  | { name: "Emergency"; params?: undefined }
  | { name: "AttendanceReview"; params: { timeEntryId: string; subjectId?: string } }
  | { name: "OfflineReview"; params: { workerProfileId: string; subjectId?: string; workerName?: string } }
  | { name: "OnboardingReview"; params: { workerProfileId: string; subjectId?: string } }
  | { name: "SupervisorIssue"; params: { issueId: string; subjectId?: string } }
  | { name: "LiveOperations"; params: { focus: "onShift" | "late" | "alerts" } }
  | { name: "Notifications"; params?: undefined };

/**
 * Notifications about other people (sent to Owners and Field Managers). The
 * worker screens are not for them, and the ids in them are not the caller's
 * own: without what their action screen needs they open the list, never a
 * worker's detail screen.
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

/**
 * A manager's notifications that ask for a decision on one entry (a clock-out
 * or an emergency's end awaiting approval, an entry open for too long): with
 * their subject and the entry, a push opens the entry's review.
 */
const ENTRY_REVIEW_TYPES = new Set(["WORKER_CLOCKED_OUT", "SHIFT_AWAITING_APPROVAL", "EMERGENCY_SHIFT_ENDED", "OVERTIME_THRESHOLD_CROSSED"]);

/** A temporary supervisor's report (to managers): with its subject and the report, a push opens it. */
const SUPERVISOR_ISSUE_REPORTED = "TEMPORARY_SUPERVISOR_ISSUE_REPORTED";

/** To the temporary supervisor (a worker) when a manager resolved their report: their supervision screen, or the list. */
const SUPERVISOR_ISSUE_RESOLVED = "TEMPORARY_SUPERVISOR_ISSUE_RESOLVED";

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
    subjectId: text(source, "subjectId"),
    timeEntryId: text(source, "timeEntryId"),
    shiftId: text(source, "shiftId"),
    calloutId: text(source, "calloutId"),
    assignmentId: text(source, "assignmentId"),
    issueId: text(source, "issueId"),
    yearMonth: yearMonth && YEAR_MONTH.test(yearMonth) ? yearMonth : null,
  };
}

const nonEmpty = (value: string | null | undefined): value is string => typeof value === "string" && value.trim() !== "";

/**
 * The screen that settles what a notification asks for (its `action`), with
 * the subject it settles; null when the action lacks the id its screen needs
 * (or is a kind this version does not know).
 */
export function targetForAction(action: NotificationAction, subjectId: string | null | undefined): LinkTarget | null {
  const subject = nonEmpty(subjectId) ? { subjectId } : {};
  switch (action.kind) {
    case "REVIEW_ATTENDANCE":
    case "OPEN_ENTRY":
      return nonEmpty(action.timeEntryId) ? { name: "AttendanceReview", params: { timeEntryId: action.timeEntryId, ...subject } } : null;
    case "REVIEW_OFFLINE":
      return nonEmpty(action.workerProfileId) ? { name: "OfflineReview", params: { workerProfileId: action.workerProfileId, ...subject } } : null;
    case "REVIEW_ONBOARDING":
      return nonEmpty(action.workerProfileId) ? { name: "OnboardingReview", params: { workerProfileId: action.workerProfileId, ...subject } } : null;
    case "RESOLVE_SUPERVISOR_ISSUE":
      return nonEmpty(action.issueId) ? { name: "SupervisorIssue", params: { issueId: action.issueId, ...subject } } : null;
    default:
      return null;
  }
}

/** A manager's push with its subject and the record it is about: the screen that settles it. */
function actionTargetOfPush(data: NotificationLinkData): LinkTarget | null {
  if (data.type === null || data.subjectId === null) return null;
  if (ENTRY_REVIEW_TYPES.has(data.type) && data.timeEntryId) {
    return { name: "AttendanceReview", params: { timeEntryId: data.timeEntryId, subjectId: data.subjectId } };
  }
  if (data.type === SUPERVISOR_ISSUE_REPORTED && data.issueId) {
    return { name: "SupervisorIssue", params: { issueId: data.issueId, subjectId: data.subjectId } };
  }
  return null;
}

/** The screen a notification opens (the same rules for a push tap and a tap in the list). */
export function targetForNotification(data: NotificationLinkData): LinkTarget {
  const action = actionTargetOfPush(data);
  if (action) return action;
  if (data.type === SUPERVISOR_ISSUE_RESOLVED) return data.assignmentId ? { name: "Supervisor", params: { assignmentId: data.assignmentId } } : { name: "Notifications" };
  if (data.type !== null && MANAGER_TYPES.has(data.type)) return { name: "Notifications" };
  if (data.calloutId || (data.type !== null && EMERGENCY_TYPES.has(data.type))) return { name: "Emergency" };
  if (data.assignmentId) return { name: "Supervisor", params: { assignmentId: data.assignmentId } };
  if (data.yearMonth || data.type === "PAYROLL_FINALIZED") return { name: "Salary", params: data.yearMonth ? { yearMonth: data.yearMonth } : {} };
  if (data.timeEntryId) return { name: "HistoryDetail", params: { timeEntryId: data.timeEntryId } };
  if (data.shiftId) return { name: "ShiftDetails", params: { shiftId: data.shiftId } };
  return { name: "Notifications" };
}

/**
 * Shortcut for an in-app notification: its action's screen when it asks for
 * one (mobile manager mode), otherwise the same rules as a push. A
 * notification only for information never opens an action screen.
 */
export function targetForInAppNotification(notification: {
  type: string;
  dataJson: Record<string, unknown> | null;
  subjectId?: string | null;
  action?: NotificationAction | null;
}): LinkTarget {
  const action = notification.action ? targetForAction(notification.action, notification.subjectId) : null;
  // The offline review names its worker from the notification (the push has no names).
  const workerName = typeof notification.dataJson?.workerName === "string" ? notification.dataJson.workerName.trim() : "";
  if (action?.name === "OfflineReview" && workerName) return { ...action, params: { ...action.params, workerName } };
  if (action) return action;
  return targetForNotification({ ...parseNotificationData(notification.dataJson, notification.type), subjectId: null });
}

/** A navigator-like object (the container ref, or a screen's `navigation`). */
export interface Navigator {
  navigate: (...args: never[]) => void;
}

/**
 * The target, or the notifications list when its screen is not mounted (e.g. a work-flow screen missing from this
 * build, a manager screen for a worker). A member who manages (the live operations are mounted) is told about other
 * workers' call-outs: those open where the call-out runs, never their own emergency screen.
 */
export function resolveAvailableTarget(target: LinkTarget, routeNames: readonly string[] | null): LinkTarget {
  if (target.name === "Emergency" && routeNames?.includes("LiveOperations")) return { name: "LiveOperations", params: { focus: "onShift" } };
  if (!routeNames || routeNames.includes(target.name)) return target;
  return { name: "Notifications" };
}

/** Navigates any navigator to a link target (route names outside this file's types included). */
export function navigateToTarget(navigator: Navigator, target: LinkTarget): void {
  (navigator.navigate as (name: string, params?: object) => void)(target.name, target.params);
}

// ── Taps that arrive before the screens exist (cold start, or signed out) ──

let pending: LinkTarget | null = null;

/** The root of a member who manages (mobile manager mode): the manager tabs, with the notifications list as a tab. */
const MANAGER_ROOT = "Main";
const MANAGER_NOTIFICATIONS_TAB = "NotificationsTab";

/** Opens the target now if the signed-in screens are mounted, otherwise as soon as they are. */
export function openLinkTarget(target: LinkTarget): void {
  pending = target;
  flushPendingLink();
}

/** Called when the navigator is ready and whenever its screens change (after sign-in). */
export function flushPendingLink(): void {
  if (!pending || !navigationRef.isReady()) return;
  const root = navigationRef.getRootState();
  const routeNames = root?.routeNames ?? [];
  // Only once the signed-in stack is there (not the sign-in or account-state screen).
  if (!routeNames.includes("Notifications")) return;
  const target = resolveAvailableTarget(pending, routeNames);
  pending = null;
  // A member who manages has the list as a tab of the manager home: from the home, open that tab rather
  // than a second copy of the list on top (deeper in the stack, the list opens on top, back returns there).
  const current = root?.routes[root.index]?.name;
  if (target.name === "Notifications" && current === MANAGER_ROOT) {
    (navigationRef.navigate as (name: string, params?: object) => void)(MANAGER_ROOT, { screen: MANAGER_NOTIFICATIONS_TAB });
    return;
  }
  navigateToTarget(navigationRef, target);
}

/** Tests only. */
export function clearPendingLinkForTests(): void {
  pending = null;
}
