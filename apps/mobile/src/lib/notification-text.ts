import type { NotificationItem } from "@fieldmaster/api-client";
import { SYSTEM_EMERGENCY_CALLOUT_TITLE, type Formatter } from "@fieldmaster/i18n";
import { isolateAuto } from "../components/LtrText";

/**
 * The Arabic text of a notification, built from its `type` and `dataJson`.
 *
 * The API stores every notification with an English `title` / `body`; the
 * app is Arabic only and never shows them. It renders
 * `notifications.types.<TYPE>.*` from the raw values in `dataJson` (names,
 * ISO instants, business dates, months, minutes, counts, enum values)
 * instead, formatted here: Western digits, Asia/Jerusalem times. Names,
 * shift titles and reasons are user text in any script, so they are wrapped
 * in a first-strong bidi isolate. Money is never shown here: a worker's own
 * pay is on the salary and history screens. When a value the message needs
 * is missing (older notifications), the type's `fallbackBody` is used.
 */

/** The slice of a use-intl translator this module needs (namespace "notifications"). */
export interface NotificationTranslator {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
}

/** The shared enum-label lookup (useEnumLabel). */
export type EnumLabel = (enumName: "TuranType", value: string) => string;

export interface NotificationText {
  title: string;
  body: string;
  source: "data" | "fallback";
}

type Data = Record<string, unknown>;

interface Context {
  t: NotificationTranslator;
  fmt: Formatter;
  enumLabel: EnumLabel;
}

interface MessageRef {
  key: string;
  values?: Record<string, string>;
}

interface Built {
  title: MessageRef;
  body: MessageRef;
}

// ── Readers: undefined means missing or malformed ───────────────────────────

function text(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function shiftTitle(data: Data, ctx: Context): string | undefined {
  const value = text(data, "shiftTitle");
  if (value === undefined) return undefined;
  return value === SYSTEM_EMERGENCY_CALLOUT_TITLE ? ctx.t("emergencyCalloutShiftTitle") : isolateAuto(value);
}

function wholeNumber(data: Data, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function instant(data: Data, key: string): string | undefined {
  const value = text(data, key);
  return value !== undefined && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function businessDate(data: Data, key: string): string | undefined {
  const value = text(data, key);
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function yearMonth(data: Data, key: string): string | undefined {
  const value = text(data, key);
  return value !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

function workerName(data: Data, ctx: Context): string {
  const name = text(data, "workerName");
  return name !== undefined ? isolateAuto(name) : ctx.t("someWorker");
}

function allDefined<T extends Record<string, unknown>>(values: T): values is { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.values(values).every((value) => value !== undefined);
}

const typeKey = (type: string, message: string) => `types.${type}.${message}`;

function simple(type: string, values: Record<string, string>, body = "body", title = "title"): Built {
  return { title: { key: typeKey(type, title) }, body: { key: typeKey(type, body), values } };
}

function turanRange(data: Data, ctx: Context): Record<string, string> | null {
  const type = data.turanType === "DAY_TURAN" || data.turanType === "NIGHT_TURAN" ? data.turanType : undefined;
  const values = { type, start: instant(data, "startAt"), end: instant(data, "endAt") };
  if (!allDefined(values)) return null;
  return { turanType: ctx.enumLabel("TuranType", values.type), start: ctx.fmt.dateTime(values.start), end: ctx.fmt.dateTime(values.end) };
}

const offlineReview =
  (type: string) =>
  (data: Data, ctx: Context): Built | null => {
    const values = { flagged: wholeNumber(data, "flaggedCount"), rejected: wholeNumber(data, "rejectedCount") };
    if (!allDefined(values)) return null;
    return simple(type, { workerName: workerName(data, ctx), flagged: ctx.fmt.number(values.flagged), rejected: ctx.fmt.number(values.rejected) });
  };

type Builder = (data: Data, ctx: Context) => Built | null;

const BUILDERS: Record<string, Builder> = {
  WORKER_CLOCKED_IN: (data, ctx) => {
    const values = { shiftTitle: shiftTitle(data, ctx), at: instant(data, "clockInAt") };
    if (!allDefined(values)) return null;
    return simple("WORKER_CLOCKED_IN", { workerName: workerName(data, ctx), shiftTitle: values.shiftTitle, time: ctx.fmt.dateTime(values.at) });
  },
  WORKER_CLOCKED_OUT: (data, ctx) => {
    const values = { shiftTitle: shiftTitle(data, ctx), total: wholeNumber(data, "durationMinutes") };
    if (!allDefined(values)) return null;
    return simple("WORKER_CLOCKED_OUT", { workerName: workerName(data, ctx), shiftTitle: values.shiftTitle, total: ctx.fmt.minutes(values.total) });
  },
  OVERTIME_THRESHOLD_CROSSED: (data, ctx) => {
    const title = shiftTitle(data, ctx);
    if (title === undefined) return null;
    return simple("OVERTIME_THRESHOLD_CROSSED", { workerName: workerName(data, ctx), shiftTitle: title });
  },
  EMERGENCY_SHIFT_STARTED: (data, ctx) => {
    const at = instant(data, "startedAt");
    if (at === undefined) return null;
    return simple("EMERGENCY_SHIFT_STARTED", { workerName: workerName(data, ctx), time: ctx.fmt.dateTime(at) });
  },
  EMERGENCY_SHIFT_ENDED: (data, ctx) => {
    const minutes = wholeNumber(data, "compensatedDurationMinutes");
    if (minutes === undefined) return null;
    return simple("EMERGENCY_SHIFT_ENDED", { workerName: workerName(data, ctx), duration: ctx.fmt.minutes(minutes) });
  },
  SHIFT_AWAITING_APPROVAL: (data, ctx) => {
    const title = shiftTitle(data, ctx);
    if (title === undefined) return null;
    return simple("SHIFT_AWAITING_APPROVAL", { workerName: workerName(data, ctx), shiftTitle: title });
  },
  SHIFT_APPROVED: (data, ctx) => {
    const values = {
      shiftTitle: shiftTitle(data, ctx),
      date: businessDate(data, "businessDate"),
      regular: wholeNumber(data, "approvedRegularMinutes"),
      overtime: wholeNumber(data, "approvedOvertimeMinutes"),
    };
    if (!allDefined(values)) return null;
    return simple("SHIFT_APPROVED", {
      shiftTitle: values.shiftTitle,
      date: ctx.fmt.businessDate(values.date),
      regular: ctx.fmt.minutes(values.regular),
      overtime: ctx.fmt.minutes(values.overtime),
    });
  },
  SHIFT_REJECTED: (data, ctx) => {
    const values = { shiftTitle: shiftTitle(data, ctx), date: businessDate(data, "businessDate"), reason: text(data, "reason") };
    if (!allDefined(values)) return null;
    return simple("SHIFT_REJECTED", { shiftTitle: values.shiftTitle, date: ctx.fmt.businessDate(values.date), reason: isolateAuto(values.reason) });
  },
  ONBOARDING_SUBMITTED: (data, ctx) => {
    if (text(data, "workerName") === undefined) return null;
    return simple("ONBOARDING_SUBMITTED", { workerName: workerName(data, ctx) });
  },
  WORKER_APPROVED: () => simple("WORKER_APPROVED", {}),
  TURAN_ASSIGNMENT_CREATED: (data, ctx) => {
    // Also sent for a new shift assignment, marked with assignmentKind "SHIFT".
    if (data.assignmentKind === "SHIFT") {
      const values = { shiftTitle: shiftTitle(data, ctx), start: instant(data, "startAt") };
      if (!allDefined(values)) return null;
      return simple("TURAN_ASSIGNMENT_CREATED", { shiftTitle: values.shiftTitle, start: ctx.fmt.dateTime(values.start) }, "shiftBody", "shiftTitle");
    }
    const range = turanRange(data, ctx);
    if (!range) return null;
    return { title: { key: typeKey("TURAN_ASSIGNMENT_CREATED", "turanTitle"), values: { turanType: range.turanType } }, body: { key: typeKey("TURAN_ASSIGNMENT_CREATED", "body"), values: range } };
  },
  TURAN_ASSIGNMENT_CHANGED: (data, ctx) => {
    const range = turanRange(data, ctx);
    if (!range) return null;
    return data.change === "CANCELLED" ? simple("TURAN_ASSIGNMENT_CHANGED", range, "cancelledBody", "cancelledTitle") : simple("TURAN_ASSIGNMENT_CHANGED", range);
  },
  TEMPORARY_CHECK_IN_POINT_OPENED: (data, ctx) => {
    const title = shiftTitle(data, ctx);
    if (title === undefined) return null;
    return simple("TEMPORARY_CHECK_IN_POINT_OPENED", { shiftTitle: title });
  },
  PAYROLL_FINALIZED: (data, ctx) => {
    const month = yearMonth(data, "yearMonth");
    if (month === undefined) return null;
    return simple("PAYROLL_FINALIZED", { month: ctx.fmt.month(month) });
  },
  OFFLINE_EVENT_SYNCED: (data, ctx) => {
    const count = wholeNumber(data, "syncedCount");
    if (count === undefined) return null;
    return simple("OFFLINE_EVENT_SYNCED", { workerName: workerName(data, ctx), count: ctx.fmt.number(count) });
  },
  OFFLINE_EVENT_REJECTED: offlineReview("OFFLINE_EVENT_REJECTED"),
  SUSPICIOUS_LOCATION_DETECTED: offlineReview("SUSPICIOUS_LOCATION_DETECTED"),
  TEMPORARY_SUPERVISOR_ISSUE_REPORTED: (data, ctx) => {
    const values = { shiftTitle: shiftTitle(data, ctx), issueText: text(data, "issueText") };
    if (!allDefined(values)) return null;
    return simple("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", { workerName: workerName(data, ctx), shiftTitle: values.shiftTitle, issueText: isolateAuto(values.issueText) });
  },
};

/** Every notification type this module renders (each has `title`, `body` and `fallbackBody` messages). */
export const RENDERED_NOTIFICATION_TYPES = Object.keys(BUILDERS);

function asData(value: unknown): Data {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Data) : {};
}

/** `{ title, body }` in Arabic for a notification (never the stored English text). */
export function renderNotificationText(
  t: NotificationTranslator,
  fmt: Formatter,
  enumLabel: EnumLabel,
  notification: Pick<NotificationItem, "type" | "dataJson">,
): NotificationText {
  const builder: Builder | undefined = Object.prototype.hasOwnProperty.call(BUILDERS, notification.type) ? BUILDERS[notification.type] : undefined;
  const built = builder ? builder(asData(notification.dataJson), { t, fmt, enumLabel }) : null;
  if (built) return { title: t(built.title.key, built.title.values), body: t(built.body.key, built.body.values), source: "data" };
  return builder !== undefined && t.has(typeKey(notification.type, "fallbackBody"))
    ? { title: t(typeKey(notification.type, "title")), body: t(typeKey(notification.type, "fallbackBody")), source: "fallback" }
    : { title: t("genericTitle"), body: t("genericBody"), source: "fallback" };
}
