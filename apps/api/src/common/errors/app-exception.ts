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
  // Step 7: payroll versions and the background calculation.
  PAYROLL_PERIOD_NOT_READY: "PAYROLL_PERIOD_NOT_READY",
  PAYROLL_PERIOD_NOT_FINALIZED: "PAYROLL_PERIOD_NOT_FINALIZED",
  PAYROLL_CALCULATION_IN_PROGRESS: "PAYROLL_CALCULATION_IN_PROGRESS",
  /** Stored on a failed calculation run (not an HTTP error): the job hit an unexpected error. */
  PAYROLL_CALCULATION_FAILED: "PAYROLL_CALCULATION_FAILED",
  /** Stored on a calculation run that stopped without finishing and was replaced by a new one. */
  PAYROLL_CALCULATION_STALE: "PAYROLL_CALCULATION_STALE",
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  EMERGENCY_NOT_ELIGIBLE: "EMERGENCY_NOT_ELIGIBLE",
  FULL_DAY_CREDIT_NOT_ALLOWED: "FULL_DAY_CREDIT_NOT_ALLOWED",
  INVITATION_INVALID_OR_EXPIRED: "INVITATION_INVALID_OR_EXPIRED",
  DEVICE_KEY_NOT_REGISTERED: "DEVICE_KEY_NOT_REGISTERED",
  INVALID_OFFLINE_SIGNATURE: "INVALID_OFFLINE_SIGNATURE",
  // Test-mode rewind (POST /dev/time-entries/:id/rewind, dev login only).
  TIME_ENTRY_NOT_OPEN: "TIME_ENTRY_NOT_OPEN",
  DEV_REWIND_EMERGENCY_NOT_SUPPORTED: "DEV_REWIND_EMERGENCY_NOT_SUPPORTED",
  DEV_REWIND_LIMIT_EXCEEDED: "DEV_REWIND_LIMIT_EXCEEDED",
  // Step 6: temporary supervisors.
  TEMPORARY_SUPERVISOR_INACTIVE: "TEMPORARY_SUPERVISOR_INACTIVE",
  TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS: "TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS",
  TEMPORARY_SUPERVISOR_NOT_ON_SHIFT: "TEMPORARY_SUPERVISOR_NOT_ON_SHIFT",
  TEMPORARY_SUPERVISOR_ALREADY_ASSIGNED: "TEMPORARY_SUPERVISOR_ALREADY_ASSIGNED",
  SHIFT_NOT_OPEN: "SHIFT_NOT_OPEN",
  // Step 6: users and roles.
  LAST_ACTIVE_OWNER: "LAST_ACTIVE_OWNER",
  ROLE_REQUIRES_TIME_TRACKING: "ROLE_REQUIRES_TIME_TRACKING",
  MEMBERSHIP_ARCHIVED: "MEMBERSHIP_ARCHIVED",
  // Step 8: reports, uploads and onboarding.
  /** 429 from the rate limiter (mapped in AllExceptionsFilter). */
  RATE_LIMITED: "RATE_LIMITED",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_TYPE_NOT_ALLOWED: "FILE_TYPE_NOT_ALLOWED",
  /** The malware-scan hook refused the file. */
  FILE_REJECTED: "FILE_REJECTED",
  /** A redeem referenced an upload that is not this invitation's (or has the wrong purpose). */
  UPLOAD_NOT_FOUND: "UPLOAD_NOT_FOUND",
  INVITATION_ALREADY_USED: "INVITATION_ALREADY_USED",
  REPORT_NOT_READY: "REPORT_NOT_READY",
  // Step 9: the mobile worker app.
  /** Sign-in with a valid code, for an application still waiting for the Owner's decision. */
  ACCOUNT_PENDING_APPROVAL: "ACCOUNT_PENDING_APPROVAL",
  /** Sign-in with a valid code, for an application the Owner rejected. */
  ACCOUNT_REJECTED: "ACCOUNT_REJECTED",
  /** Sign-in with a valid code (or any call), for a suspended member. */
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  /** An offline event signed with a key an Owner revoked (the app clears its queue and signs in again). */
  DEVICE_KEY_REVOKED: "DEVICE_KEY_REVOKED",
  /** The transcription provider failed or is not configured. */
  TRANSCRIPTION_UNAVAILABLE: "TRANSCRIPTION_UNAVAILABLE",
  // Flexible organization model: roles, scope, work rules.
  /** A custom role's name is already used by another active role. */
  ROLE_NAME_TAKEN: "ROLE_NAME_TAKEN",
  /** A built-in role cannot be edited or archived. */
  SYSTEM_ROLE_IMMUTABLE: "SYSTEM_ROLE_IMMUTABLE",
  /** A role with members cannot be archived. */
  ROLE_IN_USE: "ROLE_IN_USE",
  /** A permission list with an unknown permission, or one without a permission it needs. */
  INVALID_ROLE_PERMISSIONS: "INVALID_ROLE_PERMISSIONS",
  /** The change would leave no active member who can manage roles and settings. */
  LAST_ADMIN: "LAST_ADMIN",
  /** The new limit of Owners is below the number of active Owners. */
  OWNER_LIMIT_BELOW_CURRENT: "OWNER_LIMIT_BELOW_CURRENT",
  /** A project or site of a scope does not exist in this organization. */
  SCOPE_TARGET_NOT_FOUND: "SCOPE_TARGET_NOT_FOUND",
  /** An organization-wide action (payroll months, the audit log, users, roles...) by a member restricted to some projects. */
  SCOPE_RESTRICTED: "SCOPE_RESTRICTED",
  /** A set of work rules that is out of range (details.problems says which). */
  WORK_RULES_INVALID: "WORK_RULES_INVALID",
  /** A work-rule change must take effect after today, so the past is never rewritten. */
  WORK_RULES_EFFECTIVE_DATE_PAST: "WORK_RULES_EFFECTIVE_DATE_PAST",
  /** Clock-in earlier than the work rules allow before the shift starts (details.opensAt). */
  CLOCK_IN_TOO_EARLY: "CLOCK_IN_TOO_EARLY",
  // Mobile manager mode.
  /** The caller has no worker profile with time tracking: no salary, no own attendance (404). */
  NO_WORKER_PROFILE: "NO_WORKER_PROFILE",
  /** Workers of a new shift already have an overlapping shift (409, `details.conflicts`); nothing was created. */
  SHIFT_ASSIGNMENT_CONFLICT: "SHIFT_ASSIGNMENT_CONFLICT",
  /** A subject settled only by its own decision (an application: approve or reject), not marked handled directly (409). */
  NOTIFICATION_SUBJECT_NOT_HANDLED_HERE: "NOTIFICATION_SUBJECT_NOT_HANDLED_HERE",
} as const;
