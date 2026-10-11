/**
 * Emergency call-out shifts are created by the API (and the seed, before
 * Step 3) with this fixed English title. It is a placeholder, not something
 * a person typed, so the apps show the Arabic shift type instead.
 */
export const SYSTEM_EMERGENCY_CALLOUT_TITLE = "Emergency Call-out";

const EMERGENCY_CALLOUT = "EMERGENCY_CALLOUT";

/** True for a title the API generated, which must not be shown as-is. A typed title is kept. */
export function isSystemShiftTitle(shift: { title: string; shiftType?: string | null }): boolean {
  const isPlaceholder = shift.title.trim() === SYSTEM_EMERGENCY_CALLOUT_TITLE;
  return isPlaceholder && (shift.shiftType === undefined || shift.shiftType === null || shift.shiftType === EMERGENCY_CALLOUT);
}
