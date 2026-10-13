// Enums are plain `as const` objects (not TS `enum`) so they are
// structurally interchangeable with Prisma's generated enum types, which
// use the same pattern. `OrgRole.OWNER` etc. still works exactly like an
// enum at every call site.

export const OrgRole = {
  OWNER: "OWNER",
  FIELD_MANAGER: "FIELD_MANAGER",
  WORKER: "WORKER",
} as const;
export type OrgRole = (typeof OrgRole)[keyof typeof OrgRole];

export const AccountStatus = {
  INVITED: "INVITED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  REJECTED: "REJECTED",
  ARCHIVED: "ARCHIVED",
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const CompensationType = {
  DAILY: "DAILY",
  HOURLY: "HOURLY",
} as const;
export type CompensationType = (typeof CompensationType)[keyof typeof CompensationType];

export const ShiftType = {
  STANDARD: "STANDARD",
  DAY_TURAN: "DAY_TURAN",
  NIGHT_TURAN: "NIGHT_TURAN",
  EMERGENCY_CALLOUT: "EMERGENCY_CALLOUT",
} as const;
export type ShiftType = (typeof ShiftType)[keyof typeof ShiftType];

export const ShiftStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  OPEN: "OPEN",
  ACTIVE: "ACTIVE",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;
export type ShiftStatus = (typeof ShiftStatus)[keyof typeof ShiftStatus];

export const CheckInMethod = {
  GEOFENCED: "GEOFENCED",
  FLEXI_CHECK: "FLEXI_CHECK",
} as const;
export type CheckInMethod = (typeof CheckInMethod)[keyof typeof CheckInMethod];

export const ClockEventType = {
  CLOCK_IN: "CLOCK_IN",
  CLOCK_OUT: "CLOCK_OUT",
} as const;
export type ClockEventType = (typeof ClockEventType)[keyof typeof ClockEventType];

export const EventOrigin = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
} as const;
export type EventOrigin = (typeof EventOrigin)[keyof typeof EventOrigin];

export const TimeEntryStatus = {
  ACTIVE: "ACTIVE",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CORRECTION_REQUESTED: "CORRECTION_REQUESTED",
} as const;
export type TimeEntryStatus = (typeof TimeEntryStatus)[keyof typeof TimeEntryStatus];

export const LocationValidationStatus = {
  PASSED: "PASSED",
  FLAGGED: "FLAGGED",
  BLOCKED: "BLOCKED",
  UNAVAILABLE: "UNAVAILABLE",
} as const;
export type LocationValidationStatus = (typeof LocationValidationStatus)[keyof typeof LocationValidationStatus];

export const CorrectionReason = {
  FORGOTTEN_CLOCK_IN: "FORGOTTEN_CLOCK_IN",
  FORGOTTEN_CLOCK_OUT: "FORGOTTEN_CLOCK_OUT",
  DEVICE_FAILURE: "DEVICE_FAILURE",
  BROKEN_PHONE: "BROKEN_PHONE",
  NO_CONNECTIVITY: "NO_CONNECTIVITY",
  SYSTEM_ERROR: "SYSTEM_ERROR",
  MANAGER_INSTRUCTION: "MANAGER_INSTRUCTION",
  OTHER: "OTHER",
} as const;
export type CorrectionReason = (typeof CorrectionReason)[keyof typeof CorrectionReason];

export const TuranType = {
  DAY_TURAN: "DAY_TURAN",
  NIGHT_TURAN: "NIGHT_TURAN",
} as const;
export type TuranType = (typeof TuranType)[keyof typeof TuranType];

export const TuranStatus = {
  SCHEDULED: "SCHEDULED",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  MISSED: "MISSED",
} as const;
export type TuranStatus = (typeof TuranStatus)[keyof typeof TuranStatus];

export const EmergencyAuthorizationSource = {
  NIGHT_TURAN_ASSIGNMENT: "NIGHT_TURAN_ASSIGNMENT",
  MANUAL_MANAGER_AUTHORIZATION: "MANUAL_MANAGER_AUTHORIZATION",
} as const;
export type EmergencyAuthorizationSource =
  (typeof EmergencyAuthorizationSource)[keyof typeof EmergencyAuthorizationSource];

export const TemporaryPointStatus = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
} as const;
export type TemporaryPointStatus = (typeof TemporaryPointStatus)[keyof typeof TemporaryPointStatus];

export const PayrollPeriodStatus = {
  OPEN: "OPEN",
  CALCULATING: "CALCULATING",
  REVIEW: "REVIEW",
  FINALIZED: "FINALIZED",
  REOPENED: "REOPENED",
} as const;
export type PayrollPeriodStatus = (typeof PayrollPeriodStatus)[keyof typeof PayrollPeriodStatus];

export const PayrollAdjustmentType = {
  FORGOTTEN_STAMP_PENALTY: "FORGOTTEN_STAMP_PENALTY",
  FORGOTTEN_STAMP_REVERSAL: "FORGOTTEN_STAMP_REVERSAL",
  MANUAL_DEDUCTION: "MANUAL_DEDUCTION",
  MANUAL_BONUS: "MANUAL_BONUS",
} as const;
export type PayrollAdjustmentType = (typeof PayrollAdjustmentType)[keyof typeof PayrollAdjustmentType];

export const PayrollAdjustmentSource = {
  SYSTEM: "SYSTEM",
  MANUAL: "MANUAL",
} as const;
export type PayrollAdjustmentSource = (typeof PayrollAdjustmentSource)[keyof typeof PayrollAdjustmentSource];

/** Step 7: a payroll calculation runs as a background job; this is where it stands. */
export const PayrollCalculationState = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;
export type PayrollCalculationState = (typeof PayrollCalculationState)[keyof typeof PayrollCalculationState];

/**
 * Step 7: a worker's monthly salary statement. FINALIZED comes from a
 * finalized payroll version; DRAFT is the estimate for a month that has no
 * finalized version yet (approved attendance so far, may still change).
 */
export const SalaryStatementStatus = {
  FINALIZED: "FINALIZED",
  DRAFT: "DRAFT",
} as const;
export type SalaryStatementStatus = (typeof SalaryStatementStatus)[keyof typeof SalaryStatementStatus];

/**
 * Step 7: where the Owner dashboard's figures for a month come from: the
 * month's finalized payroll version, or a live calculation over the approved
 * attendance and adjustments so far.
 */
export const PayrollFigureSource = {
  FINALIZED: "FINALIZED",
  LIVE: "LIVE",
} as const;
export type PayrollFigureSource = (typeof PayrollFigureSource)[keyof typeof PayrollFigureSource];

export const ApprovalAction = {
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  REQUEST_CORRECTION: "REQUEST_CORRECTION",
} as const;
export type ApprovalAction = (typeof ApprovalAction)[keyof typeof ApprovalAction];

export const TaskCategory = {
  CONSTRUCTION: "CONSTRUCTION",
  TRAFFIC_CONTROL: "TRAFFIC_CONTROL",
  TRAFFIC_SIGN: "TRAFFIC_SIGN",
  TRAFFIC_LIGHT_INSTALLATION: "TRAFFIC_LIGHT_INSTALLATION",
  TRAFFIC_LIGHT_REPAIR: "TRAFFIC_LIGHT_REPAIR",
  INSPECTION: "INSPECTION",
  MAINTENANCE: "MAINTENANCE",
  EMERGENCY_REPAIR: "EMERGENCY_REPAIR",
  OTHER: "OTHER",
} as const;
export type TaskCategory = (typeof TaskCategory)[keyof typeof TaskCategory];

export const NotificationType = {
  WORKER_CLOCKED_IN: "WORKER_CLOCKED_IN",
  WORKER_CLOCKED_OUT: "WORKER_CLOCKED_OUT",
  OVERTIME_THRESHOLD_CROSSED: "OVERTIME_THRESHOLD_CROSSED",
  EMERGENCY_SHIFT_STARTED: "EMERGENCY_SHIFT_STARTED",
  EMERGENCY_SHIFT_ENDED: "EMERGENCY_SHIFT_ENDED",
  SHIFT_AWAITING_APPROVAL: "SHIFT_AWAITING_APPROVAL",
  SHIFT_APPROVED: "SHIFT_APPROVED",
  SHIFT_REJECTED: "SHIFT_REJECTED",
  ONBOARDING_SUBMITTED: "ONBOARDING_SUBMITTED",
  WORKER_APPROVED: "WORKER_APPROVED",
  TURAN_ASSIGNMENT_CREATED: "TURAN_ASSIGNMENT_CREATED",
  TURAN_ASSIGNMENT_CHANGED: "TURAN_ASSIGNMENT_CHANGED",
  TEMPORARY_CHECK_IN_POINT_OPENED: "TEMPORARY_CHECK_IN_POINT_OPENED",
  PAYROLL_FINALIZED: "PAYROLL_FINALIZED",
  OFFLINE_EVENT_SYNCED: "OFFLINE_EVENT_SYNCED",
  OFFLINE_EVENT_REJECTED: "OFFLINE_EVENT_REJECTED",
  SUSPICIOUS_LOCATION_DETECTED: "SUSPICIOUS_LOCATION_DETECTED",
  TEMPORARY_SUPERVISOR_ISSUE_REPORTED: "TEMPORARY_SUPERVISOR_ISSUE_REPORTED",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const OfflineSyncEventStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FLAGGED: "FLAGGED",
  REJECTED: "REJECTED",
  DUPLICATE: "DUPLICATE",
} as const;
export type OfflineSyncEventStatus = (typeof OfflineSyncEventStatus)[keyof typeof OfflineSyncEventStatus];

/**
 * Tabs of the admin attendance list (`GET /attendance/entries?tab=`). PENDING
 * holds everything still waiting for a manager: PENDING_APPROVAL and
 * CORRECTION_REQUESTED entries.
 */
export const AttendanceListTab = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ALL: "ALL",
} as const;
export type AttendanceListTab = (typeof AttendanceListTab)[keyof typeof AttendanceListTab];

/** Flags of a time entry in the admin attendance list; also its filters (`flags=`). */
export const AttendanceFlag = {
  /** The worker was refused at least once for being outside the geofence (or temporary point) of this shift. */
  OUTSIDE_GEOFENCE_ATTEMPT: "OUTSIDE_GEOFENCE_ATTEMPT",
  /** A mock location was suspected (and refused), or a clock event was flagged for review. */
  SUSPICIOUS_LOCATION: "SUSPICIOUS_LOCATION",
  /** A clock event was captured offline and synced later. */
  OFFLINE: "OFFLINE",
  /** A Flexi-Check shift (not an emergency call-out). */
  FLEXI_CHECK: "FLEXI_CHECK",
  /** The clock-in was validated at a temporary check-in point. */
  TEMPORARY_POINT: "TEMPORARY_POINT",
  EMERGENCY: "EMERGENCY",
  /** The clock-in was moved by the test-mode rewind (dev login only). */
  DEV_REWOUND: "DEV_REWOUND",
} as const;
export type AttendanceFlag = (typeof AttendanceFlag)[keyof typeof AttendanceFlag];

/**
 * Where a temporary-supervisor assignment stands now (derived, not stored).
 * Only ACTIVE gives access: not revoked, inside its window, and the shift is
 * not closed or cancelled.
 */
export const TemporarySupervisorState = {
  ACTIVE: "ACTIVE",
  UPCOMING: "UPCOMING",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
} as const;
export type TemporarySupervisorState = (typeof TemporarySupervisorState)[keyof typeof TemporarySupervisorState];

/** A worker's attendance on one shift, as a temporary supervisor (or the live operations page) sees it. */
export const ShiftWorkerPresence = {
  NOT_CLOCKED_IN: "NOT_CLOCKED_IN",
  CLOCKED_IN: "CLOCKED_IN",
  CLOCKED_OUT: "CLOCKED_OUT",
} as const;
export type ShiftWorkerPresence = (typeof ShiftWorkerPresence)[keyof typeof ShiftWorkerPresence];

/** Every business table's timezone anchor for monthly/daily grouping. */
export const BUSINESS_TIMEZONE = "Asia/Jerusalem";

/** One standard working day, per compensation rules. */
export const STANDARD_DAY_MINUTES = 540;

export const FORGOTTEN_STAMP_FREE_INFRACTIONS = 2;
export const FORGOTTEN_STAMP_PENALTY_AGOROT = 1000;

export const EMERGENCY_RETROACTIVE_MINUTES = 60;
export const EMERGENCY_RETURN_BUFFER_MINUTES = 15;

/**
 * Owner dashboard (Step 7): a business day is an overtime spike when its
 * approved overtime minutes (all workers together) are at least
 * OVERTIME_SPIKE_FACTOR times the month's average overtime per working day,
 * and at least OVERTIME_SPIKE_MIN_MINUTES. A working day is a day with at
 * least one approved shift. A reporting rule only: no pay depends on it.
 */
export const OVERTIME_SPIKE_FACTOR = 2;
export const OVERTIME_SPIKE_MIN_MINUTES = 60;

export const DEVICE_TIME_DEVIATION_LIMIT_SECONDS = 120;
