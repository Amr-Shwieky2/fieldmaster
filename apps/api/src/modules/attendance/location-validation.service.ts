import { Injectable } from "@nestjs/common";
import { EventOrigin, LocationValidationStatus } from "@fieldmaster/shared-types";

/** The organization setting's default (`organization_settings.device_time_deviation_seconds`). */
export const DEFAULT_DEVICE_TIME_DEVIATION_SECONDS = 120;

export interface LocationEvidenceInput {
  deviceTimestamp: Date;
  mockLocationSuspected: boolean;
  origin: EventOrigin;
  /** The organization's device-clock deviation limit (settings); the default when omitted. */
  deviationLimitSeconds?: number;
}

export interface TimeValidationResult {
  deviationSeconds: number;
  rejectOnlineDeviation: boolean;
  /** The limit this result was checked against. */
  deviationLimitSeconds: number;
}

/**
 * Shared clock-event validation used by clock-in, clock-out, and emergency
 * call-out endpoints (spec section 19). The server clock is authoritative:
 * online events with a device/server deviation beyond the organization's
 * limit (settings, read by the caller)
 * are rejected outright; offline events are never rejected purely for
 * having synced late, but are flagged for review instead (full signed
 * offline-event verification per section 20 is not implemented in this
 * slice -- see IMPLEMENTATION_STATUS.md).
 */
@Injectable()
export class LocationValidationService {
  validateTime(input: LocationEvidenceInput): TimeValidationResult {
    const deviationLimitSeconds = input.deviationLimitSeconds ?? DEFAULT_DEVICE_TIME_DEVIATION_SECONDS;
    const deviationSeconds = Math.round(Math.abs(Date.now() - input.deviceTimestamp.getTime()) / 1000);
    const rejectOnlineDeviation = input.origin === EventOrigin.ONLINE && deviationSeconds > deviationLimitSeconds;
    return { deviationSeconds, rejectOnlineDeviation, deviationLimitSeconds };
  }

  determineStatus(input: LocationEvidenceInput, timeValidation: TimeValidationResult): LocationValidationStatus {
    if (input.mockLocationSuspected) return LocationValidationStatus.BLOCKED;
    if (input.origin === EventOrigin.OFFLINE && timeValidation.deviationSeconds > timeValidation.deviationLimitSeconds) {
      return LocationValidationStatus.FLAGGED;
    }
    return LocationValidationStatus.PASSED;
  }
}
