import { HttpException } from "@nestjs/common";

/**
 * All domain-level errors are thrown as AppException so the response body
 * matches the spec's fixed error shape (statusCode/code/message/details/
 * correlationId), instead of Nest's default HttpException shape.
 */
export class AppException extends HttpException {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super({ code, message, details }, statusCode);
    this.code = code;
    this.details = details;
  }
}

export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  GEOFENCE_OUTSIDE_ALLOWED_RADIUS: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
  GPS_ACCURACY_TOO_LOW: "GPS_ACCURACY_TOO_LOW",
  MOCK_LOCATION_BLOCKED: "MOCK_LOCATION_BLOCKED",
  DEVICE_TIME_DEVIATION_EXCEEDED: "DEVICE_TIME_DEVIATION_EXCEEDED",
  ACTIVE_TIME_ENTRY_EXISTS: "ACTIVE_TIME_ENTRY_EXISTS",
  NO_ACTIVE_TIME_ENTRY: "NO_ACTIVE_TIME_ENTRY",
  SUMMARY_REQUIRED: "SUMMARY_REQUIRED",
  MAX_OWNERS_REACHED: "MAX_OWNERS_REACHED",
  OVERLAPPING_COMPENSATION_PROFILE: "OVERLAPPING_COMPENSATION_PROFILE",
  PAYROLL_PERIOD_FINALIZED: "PAYROLL_PERIOD_FINALIZED",
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  EMERGENCY_NOT_ELIGIBLE: "EMERGENCY_NOT_ELIGIBLE",
  FULL_DAY_CREDIT_NOT_ALLOWED: "FULL_DAY_CREDIT_NOT_ALLOWED",
  INVITATION_INVALID_OR_EXPIRED: "INVITATION_INVALID_OR_EXPIRED",
  DEVICE_KEY_NOT_REGISTERED: "DEVICE_KEY_NOT_REGISTERED",
  INVALID_OFFLINE_SIGNATURE: "INVALID_OFFLINE_SIGNATURE",
} as const;
