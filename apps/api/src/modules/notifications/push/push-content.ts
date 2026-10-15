import { sharedMessages } from "@fieldmaster/i18n/node";
import type { NotificationType } from "@fieldmaster/shared-types";
import { UUID_PATTERN, YEAR_MONTH_PATTERN } from "../../../common/validation/patterns";

/**
 * What a push notification carries (Step 9). The phone's operating system
 * shows the title and body as they are, so they are Arabic, built from the
 * shared labels of `@fieldmaster/i18n` -- never the English text stored with
 * the notification. The data is only what the app needs to open the right
 * screen: the notification and the ids of the worker's own records. Never a
 * name, an amount, a reason or any other text: a push can show on a locked
 * screen, and the in-app notification has the details.
 */
export interface PushData {
  notificationId: string;
  type: NotificationType;
  timeEntryId?: string;
  shiftId?: string;
  calloutId?: string;
  /** A temporary-supervisor assignment (TEMPORARY_SUPERVISOR_ISSUE_REPORTED). */
  assignmentId?: string;
  /** A Turan assignment (TURAN_ASSIGNMENT_CREATED / TURAN_ASSIGNMENT_CHANGED for a Turan). */
  turanAssignmentId?: string;
  /** Mobile manager mode: the subject several managers' notifications share (opens the screen where it is settled). */
  subjectId?: string;
  /** Mobile manager mode: a supervisor's report (TEMPORARY_SUPERVISOR_ISSUE_REPORTED), from its subject. */
  issueId?: string;
  /** YYYY-MM. */
  yearMonth?: string;
}

export interface PushContent {
  title: string;
  body: string;
  data: PushData;
}

/** The record ids a push may carry (copied from the notification's data when they are ids). */
export const PUSH_DATA_ID_KEYS = ["timeEntryId", "shiftId", "calloutId", "assignmentId", "turanAssignmentId"] as const;

const NOTIFICATION_LABELS = sharedMessages.enums.NotificationType as Record<string, string>;

/** The notification type's Arabic label (the same one the apps show), as the title. */
export function pushTitle(type: string): string {
  return NOTIFICATION_LABELS[type] ?? sharedMessages.common.notifications;
}

/** A short, generic Arabic body («عرض التفاصيل»): the details are in the app, never on the lock screen. */
export function pushBody(): string {
  return `${sharedMessages.common.view} ${sharedMessages.common.details}`;
}

/**
 * Only ids (UUIDs) and a month, from an allow list: anything else in the
 * notification's data stays out. Never a worker's id (a push can show on a
 * locked screen): a subject about a worker travels as its own id only.
 */
export function pushData(notification: PushSource): PushData {
  const data: PushData = { notificationId: notification.id, type: notification.type as NotificationType };
  const source = notification.dataJson !== null && typeof notification.dataJson === "object" && !Array.isArray(notification.dataJson) ? (notification.dataJson as Record<string, unknown>) : {};
  for (const key of PUSH_DATA_ID_KEYS) {
    const value = source[key];
    if (typeof value === "string" && UUID_PATTERN.test(value)) data[key] = value;
  }
  if (typeof source.yearMonth === "string" && YEAR_MONTH_PATTERN.test(source.yearMonth)) data.yearMonth = source.yearMonth;
  if (notification.subjectId && UUID_PATTERN.test(notification.subjectId)) data.subjectId = notification.subjectId;
  if (notification.subject?.kind === "SUPERVISOR_ISSUE" && UUID_PATTERN.test(notification.subject.refId)) data.issueId = notification.subject.refId;
  return data;
}

/** A stored notification, with its subject when it has one. */
export interface PushSource {
  id: string;
  type: string;
  dataJson: unknown;
  subjectId?: string | null;
  subject?: { kind: string; refId: string } | null;
}

export function buildPushContent(notification: PushSource): PushContent {
  return { title: pushTitle(notification.type), body: pushBody(), data: pushData(notification) };
}
