import type { WorkRules } from "@fieldmaster/shared-types";

/** The rules an emergency call-out needs: the minutes paid before the start click and after the end click. */
export type EmergencyRules = Pick<WorkRules, "emergencyMinutesBefore" | "emergencyMinutesAfter">;

export interface EmergencyCompensationResult {
  actualStartClick: Date;
  actualEndClick: Date;
  compensatedStart: Date;
  compensatedEnd: Date;
  actualWorkedMinutes: number;
  retroactiveMinutes: number;
  returnBufferMinutes: number;
  compensatedDurationMinutes: number;
}

/**
 * Night Turan emergency call-out timing per spec section 16. Never mutates
 * or replaces the raw device/server click timestamps -- it only derives the
 * separate "compensated" window that payroll uses.
 */
export function computeEmergencyCompensation(
  actualStartClick: Date,
  actualEndClick: Date,
  rules: EmergencyRules,
): EmergencyCompensationResult {
  if (actualEndClick.getTime() <= actualStartClick.getTime()) {
    throw new Error("actualEndClick must be after actualStartClick");
  }

  const compensatedStart = new Date(actualStartClick.getTime() - rules.emergencyMinutesBefore * 60_000);
  const compensatedEnd = new Date(actualEndClick.getTime() + rules.emergencyMinutesAfter * 60_000);

  const actualWorkedMinutes = Math.round((actualEndClick.getTime() - actualStartClick.getTime()) / 60_000);
  const compensatedDurationMinutes = Math.round(
    (compensatedEnd.getTime() - compensatedStart.getTime()) / 60_000,
  );

  return {
    actualStartClick,
    actualEndClick,
    compensatedStart,
    compensatedEnd,
    actualWorkedMinutes,
    retroactiveMinutes: rules.emergencyMinutesBefore,
    returnBufferMinutes: rules.emergencyMinutesAfter,
    compensatedDurationMinutes,
  };
}
