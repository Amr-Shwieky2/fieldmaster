import type { NotificationAction, NotificationHandled, NotificationItem } from "@fieldmaster/api-client";

/**
 * The rows of the notifications list (mobile manager mode): every
 * notification about the same subject (one entry to review, one worker's
 * offline records, one application, one supervisor's report) is one row --
 * the newest one's text and time, and how many there are; a notification
 * without a subject is a row of its own.
 */
export interface NotificationRow {
  /** Stable list key: the subject, or the notification. */
  key: string;
  subjectId: string | null;
  /** Newest first; never empty. */
  items: NotificationItem[];
  /** The newest notification: its text and time are shown. */
  latest: NotificationItem;
  /** How many notifications the row stands for (×N when more than one). */
  count: number;
  /** At least one of them is unread. */
  unread: boolean;
  /** What the row asks for (the newest notification that asks for something); null: information only. */
  action: NotificationAction | null;
  /** Who settled the subject, as the newest notification says (a newer notification about a settled subject opens it again). */
  handled: NotificationHandled | null;
}

/** `items` newest first; the rows keep that order (by their newest notification). */
export function groupNotifications(items: readonly NotificationItem[]): NotificationRow[] {
  const rows: NotificationRow[] = [];
  const bySubject = new Map<string, NotificationRow>();
  for (const item of items) {
    const subjectId = item.subjectId ?? null;
    const existing = subjectId !== null ? bySubject.get(subjectId) : undefined;
    if (existing) {
      existing.items.push(item);
      existing.count += 1;
      existing.unread ||= item.readAt === null;
      existing.action ??= item.action ?? null;
      continue;
    }
    const row: NotificationRow = {
      key: subjectId !== null ? `subject:${subjectId}` : `notification:${item.id}`,
      subjectId,
      items: [item],
      latest: item,
      count: 1,
      unread: item.readAt === null,
      action: item.action ?? null,
      handled: item.handled ?? null,
    };
    rows.push(row);
    if (subjectId !== null) bySubject.set(subjectId, row);
  }
  return rows;
}

/**
 * A manager's two tabs: «تحتاج إجراء» (the rows that ask for something, the
 * open ones first and the settled ones below them) and «للعلم» (the rest).
 * Each keeps the newest first.
 */
export function splitByAction(rows: readonly NotificationRow[]): { action: NotificationRow[]; info: NotificationRow[] } {
  const actionable = rows.filter((row) => row.action !== null);
  return {
    action: [...actionable.filter((row) => row.handled === null), ...actionable.filter((row) => row.handled !== null)],
    info: rows.filter((row) => row.action === null),
  };
}
