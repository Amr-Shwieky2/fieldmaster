/**
 * Arabic labels for every enum exported by `@fieldmaster/shared-types`.
 *
 * Labels live in the shared `enums` namespace (src/messages/ar.json) under
 * `enums.<EnumName>.<VALUE>`. A unit test iterates every enum exported by
 * shared-types and fails if any value lacks a label, so adding an enum value
 * forces a translation. Each app wraps `getEnumLabel` in a small hook bound to
 * its own translator (next-intl on the web, use-intl on mobile).
 */

/**
 * Names of the shared-types enums that have labels. Kept as an explicit union
 * so `label("OrgRol", ...)` is a compile error; a unit test asserts this list
 * equals the enums exported by shared-types.
 */
export const ENUM_NAMES = [
  "OrgRole",
  "AccountStatus",
  "CompensationType",
  "ShiftType",
  "ShiftStatus",
  "CheckInMethod",
  "ClockEventType",
  "EventOrigin",
  "TimeEntryStatus",
  "LocationValidationStatus",
  "CorrectionReason",
  "TuranType",
  "TuranStatus",
  "EmergencyAuthorizationSource",
  "TemporaryPointStatus",
  "PayrollPeriodStatus",
  "PayrollAdjustmentType",
  "PayrollAdjustmentSource",
  "ApprovalAction",
  "TaskCategory",
  "NotificationType",
  "OfflineSyncEventStatus",
] as const;

export type EnumName = (typeof ENUM_NAMES)[number];

/** The slice of a next-intl / use-intl translator this module needs (namespace "enums"). */
export interface EnumTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/** Em dash shown when an enum value is missing (null/undefined/empty). */
export const MISSING_LABEL = "—";

/**
 * Pure label lookup. `t` is the translator for the `"enums"` namespace.
 * A value without an Arabic label (for example one the API added before the
 * apps shipped its label) is shown as the raw code, and null/undefined/empty
 * as an em dash.
 */
export function getEnumLabel(t: EnumTranslator, enumName: EnumName, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return MISSING_LABEL;
  const key = `${enumName}.${value}`;
  return t.has(key) ? t(key) : value;
}
