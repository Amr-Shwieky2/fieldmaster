import type { ShiftType } from "@fieldmaster/shared-types";
import { isSystemShiftTitle } from "@fieldmaster/i18n";
import { useEnumLabel } from "@/i18n/enums";

type ShiftLike = { title: string; shiftType: ShiftType | string };

/** Returns a function that gives the title to show for a shift: the Arabic shift type instead of the API's English placeholder title. */
export function useShiftTitle(): (shift: ShiftLike) => string {
  const enumLabel = useEnumLabel();
  return (shift) => (isSystemShiftTitle(shift) ? enumLabel("ShiftType", shift.shiftType) : shift.title);
}
