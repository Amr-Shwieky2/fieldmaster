import { EMERGENCY_RETROACTIVE_MINUTES, EMERGENCY_RETURN_BUFFER_MINUTES } from "@fieldmaster/shared-types";

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
): EmergencyCompensationResult {
  if (actualEndClick.getTime() <= actualStartClick.getTime()) {
    throw new Error("actualEndClick must be after actualStartClick");
  }

  const compensatedStart = new Date(actualStartClick.getTime() - EMERGENCY_RETROACTIVE_MINUTES * 60_000);
  const compensatedEnd = new Date(actualEndClick.getTime() + EMERGENCY_RETURN_BUFFER_MINUTES * 60_000);

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
    retroactiveMinutes: EMERGENCY_RETROACTIVE_MINUTES,
    returnBufferMinutes: EMERGENCY_RETURN_BUFFER_MINUTES,
    compensatedDurationMinutes,
  };
}
