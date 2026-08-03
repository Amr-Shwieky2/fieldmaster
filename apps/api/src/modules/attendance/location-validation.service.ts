import { Injectable } from "@nestjs/common";
import { EventOrigin, LocationValidationStatus } from "@fieldmaster/shared-types";

const DEVIATION_LIMIT_SECONDS = Number(process.env.DEVICE_TIME_DEVIATION_SECONDS ?? 120);

export interface LocationEvidenceInput {
  deviceTimestamp: Date;
  mockLocationSuspected: boolean;
  origin: EventOrigin;
}

export interface TimeValidationResult {
  deviationSeconds: number;
  rejectOnlineDeviation: boolean;
}

/**
 * Shared clock-event validation used by clock-in, clock-out, and emergency
 * call-out endpoints (spec section 19). The server clock is authoritative:
 * online events with a device/server deviation beyond the configured limit
 * are rejected outright; offline events are never rejected purely for
 * having synced late, but are flagged for review instead (full signed
 * offline-event verification per section 20 is not implemented in this
 * slice -- see IMPLEMENTATION_STATUS.md).
 */
@Injectable()
export class LocationValidationService {
  validateTime(input: LocationEvidenceInput): TimeValidationResult {
    const deviationSeconds = Math.round(Math.abs(Date.now() - input.deviceTimestamp.getTime()) / 1000);
    const rejectOnlineDeviation = input.origin === EventOrigin.ONLINE && deviationSeconds > DEVIATION_LIMIT_SECONDS;
    return { deviationSeconds, rejectOnlineDeviation };
  }

  determineStatus(input: LocationEvidenceInput, timeValidation: TimeValidationResult): LocationValidationStatus {
    if (input.mockLocationSuspected) return LocationValidationStatus.BLOCKED;
    if (input.origin === EventOrigin.OFFLINE && timeValidation.deviationSeconds > DEVIATION_LIMIT_SECONDS) {
      return LocationValidationStatus.FLAGGED;
    }
    return LocationValidationStatus.PASSED;
  }
}
