import type { NotificationItem } from "@fieldmaster/api-client";
import type { Formatter } from "./format";
import { SYSTEM_EMERGENCY_CALLOUT_TITLE } from "./shift-title";

/**
 * Arabic notification text.
 *
 * The API stores every notification with an English `title` / `body` (the
 * mobile app still shows those as-is) and, since Step 2, a `dataJson` with the
 * raw values the text is built from: names, ISO instants, `YYYY-MM-DD`
 * business dates, `YYYY-MM` months, whole minutes, counts, enum values and --
 * in Owner notifications only -- money in agorot. The admin web is Arabic only
 * and never shows the stored English text; it renders
 * `notifications.types.<TYPE>.title` / `.body` from the data instead.
 *
 * - Values are formatted here (Western digits, Asia/Jerusalem, `₪ 1,234.50`)
 *   and passed to the messages as ready strings.
 * - Names, shift titles and reasons are user text in any script, so they are
 *   wrapped in a first-strong bidi isolate; money is wrapped in a
 *   left-to-right isolate so `₪ 1,234.50` keeps its order inside Arabic.
 * - When a value the message needs is missing (notifications created before
 *   the data existed), the type's `fallbackBody` -- a generic sentence
 *   without values -- is used.
 * - Cost lines are shown only when the data carries the money value, which
 *   the API includes for Owner recipients only. A Field Manager's data never
 *   has it, so a Field Manager never sees a cost.
 */

/** The slice of a next-intl translator this module needs (namespace "notifications"). */
export interface NotificationTranslator {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
}

export type NotificationTextSource = "data" | "fallback";

export interface NotificationText {
  title: string;
  body: string;
  /** Where the text came from: rendered from data, or the generic fallback. */
  source: NotificationTextSource;
}

type NotificationInput = Pick<NotificationItem, "type"> & { dataJson?: Record<string, unknown> | null };

const FSI = "⁨"; // first-strong isolate: user text of unknown direction
const LRI = "⁦"; // left-to-right isolate: money
const PDI = "⁩";

/** Bidi-isolates user text (names, titles, reasons) so it cannot reorder the sentence around it. */
export function isolateText(value: string): string {
  return `${FSI}${value}${PDI}`;
}

/** Keeps a left-to-right value (money) in order inside an Arabic sentence. */
export function isolateLtr(value: string): string {
  return `${LRI}${value}${PDI}`;
}

interface MessageRef {
  key: string;
  values?: Record<string, string>;
}

interface Built {
  title: MessageRef;
  body: MessageRef;
}

type Data = Record<string, unknown>;

interface Context {
  t: NotificationTranslator;
  fmt: Formatter;
}

// ── Readers: undefined means "missing or malformed" ─────────────────────────

function text(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The shift title from the data. Emergency call-out shifts carry the API's
 * fixed English placeholder title, which is shown as "استدعاء طوارئ" instead.
 */
function readShiftTitle(data: Data, ctx: Context): string | undefined {
  const value = text(data, "shiftTitle");
  return value !== undefined && value.trim() === SYSTEM_EMERGENCY_CALLOUT_TITLE ? ctx.t("emergencyCalloutShiftTitle") : value;
}

function wholeNumber(data: Data, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function agorot(data: Data, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
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

const TURAN_TYPES = ["DAY_TURAN", "NIGHT_TURAN"] as const;

function turanType(data: Data): (typeof TURAN_TYPES)[number] | undefined {
  const value = data.turanType;
  return TURAN_TYPES.find((type) => type === value);
}

/** The worker's name, or a generic "A worker" when the API could not resolve it. */
function workerName(data: Data, { t }: Context): string {
  const name = text(data, "workerName");
  return name !== undefined ? isolateText(name) : t("someWorker");
}

function allDefined<T extends Record<string, unknown>>(values: T): values is { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.values(values).every((value) => value !== undefined);
}

// ── One builder per type: null when the data lacks a value the text needs ──

type Builder = (data: Data, ctx: Context) => Built | null;

const typeKey = (type: string, message: string) => `types.${type}.${message}`;

/** title + body of a type, with the given values. */
function simple(type: string, values: Record<string, string>, body = "body", title = "title"): Built {
  return { title: { key: typeKey(type, title) }, body: { key: typeKey(type, body), values } };
}

function turanRange(data: Data, ctx: Context) {
  const values = { type: turanType(data), start: instant(data, "startAt"), end: instant(data, "endAt") };
  if (!allDefined(values)) return null;
  return {
    turanType: ctx.t(`turanTypes.${values.type}`),
    start: ctx.fmt.dateTime(values.start),
    end: ctx.fmt.dateTime(values.end),
  };
}

/** Offline-sync review notifications (both types share the counts). */
const offlineReview =
  (type: string): Builder =>
  (data, ctx) => {
    const values = { flagged: wholeNumber(data, "flaggedCount"), rejected: wholeNumber(data, "rejectedCount") };
    if (!allDefined(values)) return null;
    return simple(type, { workerName: workerName(data, ctx), flagged: ctx.fmt.number(values.flagged), rejected: ctx.fmt.number(values.rejected) });
  };

const BUILDERS: Record<string, Builder> = {
  WORKER_CLOCKED_IN: (data, ctx) => {
    const values = { shiftTitle: readShiftTitle(data, ctx), at: instant(data, "clockInAt") };
    if (!allDefined(values)) return null;
    return simple("WORKER_CLOCKED_IN", { workerName: workerName(data, ctx), shiftTitle: isolateText(values.shiftTitle), time: ctx.fmt.dateTime(values.at) });
  },

  WORKER_CLOCKED_OUT: (data, ctx) => {
    const values = {
      shiftTitle: readShiftTitle(data, ctx),
      total: wholeNumber(data, "durationMinutes"),
      regular: wholeNumber(data, "regularMinutes"),
      overtime: wholeNumber(data, "overtimeMinutes"),
    };
    if (!allDefined(values)) return null;
    const message = {
      workerName: workerName(data, ctx),
      shiftTitle: isolateText(values.shiftTitle),
      total: ctx.fmt.minutes(values.total),
      regular: ctx.fmt.minutes(values.regular),
      overtime: ctx.fmt.minutes(values.overtime),
    };
    // Owner notifications only: the API never puts money in a Field Manager's data.
    const cost = agorot(data, "estimatedCostAgorot");
    return cost === undefined
      ? simple("WORKER_CLOCKED_OUT", message)
      : simple("WORKER_CLOCKED_OUT", { ...message, cost: isolateLtr(ctx.fmt.money(cost)) }, "bodyWithCost");
  },

  EMERGENCY_SHIFT_STARTED: (data, ctx) => {
    const at = instant(data, "startedAt");
    if (at === undefined) return null;
    return simple("EMERGENCY_SHIFT_STARTED", { workerName: workerName(data, ctx), time: ctx.fmt.dateTime(at) });
  },

  EMERGENCY_SHIFT_ENDED: (data, ctx) => {
    const minutes = wholeNumber(data, "compensatedDurationMinutes");
    if (minutes === undefined) return null;
    const message = { workerName: workerName(data, ctx), duration: ctx.fmt.minutes(minutes) };
    const cost = agorot(data, "estimatedCostAgorot");
    return cost === undefined
      ? simple("EMERGENCY_SHIFT_ENDED", message)
      : simple("EMERGENCY_SHIFT_ENDED", { ...message, cost: isolateLtr(ctx.fmt.money(cost)) }, "bodyWithCost");
  },

  SHIFT_AWAITING_APPROVAL: (data, ctx) => {
    const shiftTitle = readShiftTitle(data, ctx);
    if (shiftTitle === undefined) return null;
    return simple("SHIFT_AWAITING_APPROVAL", { workerName: workerName(data, ctx), shiftTitle: isolateText(shiftTitle) });
  },

  SHIFT_APPROVED: (data, ctx) => {
    const values = {
      shiftTitle: readShiftTitle(data, ctx),
      date: businessDate(data, "businessDate"),
      regular: wholeNumber(data, "approvedRegularMinutes"),
      overtime: wholeNumber(data, "approvedOvertimeMinutes"),
    };
    if (!allDefined(values)) return null;
    return simple("SHIFT_APPROVED", {
      shiftTitle: isolateText(values.shiftTitle),
      date: ctx.fmt.businessDate(values.date),
      regular: ctx.fmt.minutes(values.regular),
      overtime: ctx.fmt.minutes(values.overtime),
    });
  },

  SHIFT_REJECTED: (data, ctx) => {
    const values = { shiftTitle: readShiftTitle(data, ctx), date: businessDate(data, "businessDate"), reason: text(data, "reason") };
    if (!allDefined(values)) return null;
    return simple("SHIFT_REJECTED", { shiftTitle: isolateText(values.shiftTitle), date: ctx.fmt.businessDate(values.date), reason: isolateText(values.reason) });
  },

  ONBOARDING_SUBMITTED: (data) => {
    const name = text(data, "workerName");
    if (name === undefined) return null;
    return simple("ONBOARDING_SUBMITTED", { workerName: isolateText(name) });
  },

  WORKER_APPROVED: () => simple("WORKER_APPROVED", {}),

  TURAN_ASSIGNMENT_CREATED: (data, ctx) => {
    // Also sent for new shift assignments, marked with assignmentKind "SHIFT".
    if (data.assignmentKind === "SHIFT") {
      const values = { shiftTitle: readShiftTitle(data, ctx), start: instant(data, "startAt") };
      if (!allDefined(values)) return null;
      return simple("TURAN_ASSIGNMENT_CREATED", { shiftTitle: isolateText(values.shiftTitle), start: ctx.fmt.dateTime(values.start) }, "shiftAssignedBody", "shiftAssignedTitle");
    }
    const range = turanRange(data, ctx);
    if (!range) return null;
    return {
      title: { key: typeKey("TURAN_ASSIGNMENT_CREATED", "turanTitle"), values: { turanType: range.turanType } },
      body: { key: typeKey("TURAN_ASSIGNMENT_CREATED", "body"), values: range },
    };
  },

  TURAN_ASSIGNMENT_CHANGED: (data, ctx) => {
    const range = turanRange(data, ctx);
    if (!range) return null;
    return data.change === "CANCELLED"
      ? simple("TURAN_ASSIGNMENT_CHANGED", range, "cancelledBody", "cancelledTitle")
      : simple("TURAN_ASSIGNMENT_CHANGED", range);
  },

  TEMPORARY_CHECK_IN_POINT_OPENED: (data, ctx) => {
    const shiftTitle = readShiftTitle(data, ctx);
    if (shiftTitle === undefined) return null;
    return simple("TEMPORARY_CHECK_IN_POINT_OPENED", { shiftTitle: isolateText(shiftTitle) });
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

  OVERTIME_THRESHOLD_CROSSED: (data, ctx) => {
    const shiftTitle = readShiftTitle(data, ctx);
    if (shiftTitle === undefined) return null;
    return simple("OVERTIME_THRESHOLD_CROSSED", { workerName: workerName(data, ctx), shiftTitle: isolateText(shiftTitle) });
  },
};

/** Notification types the renderer knows (every shared-types NotificationType). */
export const RENDERED_NOTIFICATION_TYPES = Object.keys(BUILDERS);

function asData(value: unknown): Data {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Data) : {};
}

/**
 * `{ title, body }` for a notification, in Arabic.
 *
 *   const t = useTranslations("notifications");
 *   const fmt = useFormat();
 *   renderNotificationText(t, fmt, notification);
 */
export function renderNotificationText(
  t: NotificationTranslator,
  fmt: Formatter,
  notification: NotificationInput,
): NotificationText {
  const builder = BUILDERS[notification.type];
  const built = builder ? builder(asData(notification.dataJson), { t, fmt }) : null;
  if (built) {
    return { title: t(built.title.key, built.title.values), body: t(built.body.key, built.body.values), source: "data" };
  }

  const known = builder !== undefined && t.has(typeKey(notification.type, "title"));
  return known
    ? { title: t(typeKey(notification.type, "title")), body: t(typeKey(notification.type, "fallbackBody")), source: "fallback" }
    : { title: t("genericTitle"), body: t("genericBody"), source: "fallback" };
}
