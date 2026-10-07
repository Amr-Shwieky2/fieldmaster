import { useMemo } from "react";
import { useTranslations } from "next-intl";

/**
 * Localised labels for every enum exported by `@fieldmaster/shared-types`.
 *
 * Labels live in the `enums` namespace of ar.json / en.json under
 * `enums.<EnumName>.<VALUE>`. A unit test iterates every enum exported by
 * shared-types and fails if any value lacks a label in either language, so
 * adding an enum value forces a translation.
 *
 *   const label = useEnumLabel();
 *   label("OrgRole", session.role);          // "المالك" / "Owner"
 *   label("ShiftType", shift.shiftType);
 *
 * Page code must use this instead of printing raw API enum values.
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

/** The slice of a next-intl translator this module needs (namespace "enums"). */
export interface EnumTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/** Em dash shown when an enum value is missing (null/undefined/empty). */
export const MISSING_LABEL = "—";

/**
 * `"FORGOTTEN_CLOCK_IN"` -> `"Forgotten clock in"`. Last-resort display for a
 * value that has no translation (for example an enum value added by the API
 * before the web app shipped its label). Never shown for known values.
 */
export function humanizeEnumValue(value: string): string {
  const words = value.replace(/[_\-\s]+/g, " ").trim().toLowerCase();
  return words.length === 0 ? MISSING_LABEL : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pure label lookup. `t` is the translator for the `"enums"` namespace.
 * Falls back to a humanised value when the label is missing, and to an em dash
 * for null/undefined/empty input.
 */
export function getEnumLabel(t: EnumTranslator, enumName: EnumName, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return MISSING_LABEL;
  const key = `${enumName}.${value}`;
  return t.has(key) ? t(key) : humanizeEnumValue(value);
}

/**
 * Hook returning `(enumName, value) => string`. The returned function is
 * stable for a given locale, so it is safe in dependency arrays.
 */
export function useEnumLabel(): (enumName: EnumName, value: string | null | undefined) => string {
  const t = useTranslations("enums");
  return useMemo(() => (enumName, value) => getEnumLabel(t, enumName, value), [t]);
}
