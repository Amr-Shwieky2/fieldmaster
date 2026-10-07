import { ShiftType } from "@fieldmaster/shared-types";
import { useEnumLabel } from "@/i18n/enums";

/**
 * Emergency call-out shifts are created by the API (and the seed) with this
 * fixed English title. It is a placeholder, not something a person typed, so
 * the web shows the translated shift type instead.
 */
export const SYSTEM_EMERGENCY_CALLOUT_TITLE = "Emergency Call-out";

type ShiftLike = { title: string; shiftType: ShiftType | string };

export function isSystemShiftTitle(shift: ShiftLike): boolean {
  return shift.shiftType === ShiftType.EMERGENCY_CALLOUT && shift.title.trim() === SYSTEM_EMERGENCY_CALLOUT_TITLE;
}

/** Returns a function that gives the title to display for a shift in the current language. */
export function useShiftTitle(): (shift: ShiftLike) => string {
  const enumLabel = useEnumLabel();
  return (shift) => (isSystemShiftTitle(shift) ? enumLabel("ShiftType", shift.shiftType) : shift.title);
}
