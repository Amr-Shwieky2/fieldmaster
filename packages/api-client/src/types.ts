import type {
  AccountStatus,
  ApprovalAction,
  AttendanceFlag,
  AttendanceListTab,
  CheckInMethod,
  ClockEventType,
  CompensationType,
  CorrectionReason,
  EmergencyAuthorizationSource,
  EventOrigin,
  LocationValidationStatus,
  NotificationType,
  OfflineSyncEventStatus,
  OrgRole,
  PayrollPeriodStatus,
  ShiftStatus,
  ShiftType,
  ShiftWorkerPresence,
  TaskCategory,
  TemporaryPointStatus,
  TemporarySupervisorState,
  TimeEntryStatus,
  TuranStatus,
  TuranType,
} from "@fieldmaster/shared-types";

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  correlationId: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  organizationId: string;
  role: OrgRole;
}

/** A member offered for one-click login while the API runs in dev login (test) mode. */
export interface DevLoginUser {
  membershipId: string;
  userId: string;
  fullLegalName: string;
  preferredName: string | null;
  phoneNumber: string;
  role: OrgRole;
  organizationId: string;
  organizationName: string;
}

export interface Worker {
  id: string;
  organizationId: string;
  fullLegalName: string;
  preferredName: string | null;
  phoneNumber: string;
  accountStatus: AccountStatus;
  role: OrgRole;
  createdAt: string;
  compensation?: {
    compensationType: CompensationType;
    dailyBaseRateAgorot: number | null;
    baseHourlyRateAgorot: number | null;
    overtimeHourlyRateAgorot: number;
    effectiveStartDate: string;
  } | null;
}

export interface Project {
  id: string;
  name: string;
  client: string | null;
  projectCode: string;
  status: string;
  budgetAgorot?: number | null;
}

export interface Site {
  id: string;
  projectId: string;
  name: string;
  latitude: number;
  longitude: number;
  defaultGeofenceRadiusMeters: number;
  geofences?: Geofence[];
}

export interface Geofence {
  id: string;
  siteId: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
  minAccuracyMeters: number;
}

export interface Shift {
  id: string;
  organizationId: string;
  projectId: string | null;
  siteId: string | null;
  geofenceId: string | null;
  shiftType: ShiftType;
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
  checkInMethod: CheckInMethod;
  status: ShiftStatus;
  managerId: string;
  businessDate: string;
  assignments?: { id: string; workerProfileId: string }[];
  site?: Site | null;
  project?: Project | null;
  /** Only on GET /shifts/:id. */
  geofence?: Geofence | null;
  temporaryCheckInPoints?: TemporaryCheckInPoint[];
}

export interface TimeEntry {
  id: string;
  organizationId: string;
  workerProfileId: string;
  shiftId: string;
  status: TimeEntryStatus;
  businessDate: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  rawDurationMinutes: number | null;
  approvedRegularMinutes: number | null;
  approvedOvertimeMinutes: number | null;
  fullDayCredit: boolean;
  isEmergency?: boolean;
  /** Set when the test-mode rewind (dev login only) moved clockInAt back; shown as a "test edit" badge. */
  devRewoundAt?: string | null;
  shift?: Shift;
  dailySummary?: { text: string | null; taskCategory: string } | null;
  clockEvents?: ClockEvent[];
}

export interface ClockEvent {
  id: string;
  timeEntryId: string;
  eventType: string;
  origin: string;
  deviceId: string;
  clientEventId: string;
  deviceTimestamp: string;
  serverReceivedAt: string;
  deviceTimeDeviationSeconds: number | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationSuspected: boolean;
  distanceFromSiteMeters: number | null;
  locationValidationStatus: string;
}

/** Response of POST /clock-events/clock-in. */
export interface ClockInResult {
  timeEntry: TimeEntry;
  clockEvent: ClockEvent;
}

export interface TemporaryCheckInPoint {
  id: string;
  shiftId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  status: TemporaryPointStatus;
  expiresAt: string;
  revokedAt: string | null;
}

export interface TemporarySupervisorAssignment {
  id: string;
  shiftId: string;
  workerProfileId: string;
  activatedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

/** Response of POST /emergency-callouts/start: the compensated start is 60 minutes before the actual click. */
export interface EmergencyCalloutStartResult {
  timeEntryId: string;
  calloutId: string;
  actualStartClick: string;
  compensatedStart: string;
  retroactiveMinutes: number;
  explanation: string;
}

/** Response of POST /emergency-callouts/end: the compensated end is 15 minutes after the actual click. */
export interface EmergencyCalloutEndResult {
  timeEntryId: string;
  actualEndClick: string;
  compensatedEnd: string;
  actualWorkedMinutes: number;
  retroactiveMinutes: number;
  returnBufferMinutes: number;
  compensatedDurationMinutes: number;
}

/** GET /dev/worker-simulator/me (test mode only): what the worker-facing API does not expose. */
export interface WorkerSimulatorContext {
  workerProfileId: string | null;
  turanAssignments: {
    id: string;
    turanType: TuranType;
    status: TuranStatus;
    startAt: string;
    endAt: string;
    role: "ASSIGNED" | "BACKUP";
  }[];
  emergencyEligibleTuranAssignmentId: string | null;
  temporarySupervisorAssignments: { id: string; shiftId: string; shiftTitle: string; activatedAt: string; expiresAt: string }[];
}

export interface PayrollPeriod {
  id: string;
  organizationId: string;
  yearMonth: string;
  status: PayrollPeriodStatus;
  version: number;
  items?: PayrollItem[];
}

export interface PayrollItem {
  id: string;
  workerProfileId: string;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  positiveAdjustmentsAgorot: number;
  deductionsAgorot: number;
  netPayableAgorot: number;
  worker?: { membership: { user: { fullLegalName: string } } };
}

export interface FinancialDashboard {
  yearMonth: string;
  totalCurrentMonthPayrollAgorot: number;
  totalPreviousMonthPayrollAgorot: number;
  overtimeTotalAgorot: number;
  forgottenStampDeductionsAgorot: number;
  costByProject: { projectId: string | null; projectName: string; totalAgorot: number }[];
  pendingApprovalFinancialExposureAgorot: number;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  /** English text as stored by the API (still shown as-is by the mobile app). */
  title: string;
  body: string;
  /**
   * The raw values the text is built from (names, ISO instants, minutes,
   * counts, enum values) so a client can render the message in its own
   * language. `{}` or `null` on notifications created before this existed.
   * Money (`*Agorot`) is present only in an Owner's notifications.
   */
  dataJson: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface TuranAssignment {
  id: string;
  organizationId: string;
  turanType: TuranType;
  status: TuranStatus;
  startAt: string;
  endAt: string;
  notes: string | null;
  assignedWorkerProfileId: string;
  backupWorkerProfileId: string | null;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  note: string | null;
  correlationId: string;
  createdAt: string;
}

export interface OfflineSyncEventResult {
  clientEventId: string;
  status: OfflineSyncEventStatus;
  reason?: string;
  timeEntryId?: string;
}

export interface OfflineSyncBatchResponse {
  batchId: string;
  results: OfflineSyncEventResult[];
}

export interface OfflineSyncBatchRecord {
  id: string;
  deviceId: string;
  eventCount: number;
  submittedAt: string;
  events: {
    id: string;
    clientEventId: string;
    eventType: string;
    status: OfflineSyncEventStatus;
    rejectionReason: string | null;
    deviceTimestamp: string;
  }[];
}

export interface GeneratedReport {
  id: string;
  reportType: string;
  requestedByUserId: string;
  subjectWorkerProfileId: string | null;
  includesFinancials: boolean;
  sha256Hash: string;
  generatedAt: string;
}

// ── Step 5: attendance screens ──────────────────────────────────────────

/** A page of a paginated list. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Filters of `GET /attendance/entries`; all optional. Dates are business dates (YYYY-MM-DD, Asia/Jerusalem). */
export interface AttendanceListFilters {
  tab?: AttendanceListTab;
  workerProfileId?: string;
  from?: string;
  to?: string;
  projectId?: string;
  siteId?: string;
  shiftType?: ShiftType;
  /** An entry must carry every listed flag. */
  flags?: AttendanceFlag[];
  page?: number;
  pageSize?: number;
}

/** One row of the attendance list. Never carries money. */
export interface AttendanceListItem {
  id: string;
  status: TimeEntryStatus;
  businessDate: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  rawDurationMinutes: number | null;
  unpaidBreakMinutes: number;
  approvedRegularMinutes: number | null;
  approvedOvertimeMinutes: number | null;
  fullDayCredit: boolean;
  isEmergency: boolean;
  devRewoundAt: string | null;
  checkInMethod: CheckInMethod;
  worker: { id: string; fullLegalName: string };
  shift: { id: string; title: string; shiftType: ShiftType; project: { id: string; name: string } | null; site: { id: string; name: string } | null };
  dailySummary: { text: string | null; taskCategory: string } | null;
  flags: AttendanceFlag[];
}

export interface AttendanceListResponse extends Paginated<AttendanceListItem> {
  /** Entries per tab under the same filters. */
  tabCounts: Record<AttendanceListTab, number>;
}

export interface EvidenceTemporaryPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  status: TemporaryPointStatus;
  expiresAt: string;
}

export interface EvidenceClockEvent {
  id: string;
  eventType: ClockEventType;
  origin: EventOrigin;
  deviceId: string | null;
  /** What the phone's clock said. */
  deviceTimestamp: string;
  /** When the server received the event. */
  serverReceivedAt: string;
  /** The entry's current (validated, possibly corrected) time for this event. */
  validatedAt: string | null;
  deviceTimeDeviationSeconds: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationSuspected: boolean;
  /** From the site, or from the temporary point the clock-in used. */
  distanceFromSiteMeters: number | null;
  locationValidationStatus: LocationValidationStatus;
  isManualCorrection: boolean;
  appVersion: string | null;
  temporaryCheckInPoint: EvidenceTemporaryPoint | null;
  offlineSync: { status: OfflineSyncEventStatus; syncedAt: string; offlineEventAgeSeconds: number | null; batchId: string; duplicateSyncs: number } | null;
}

/** A clock-in/out the server refused for the phone's location or clock. */
export interface RejectedClockAttempt {
  id: string;
  eventType: ClockEventType;
  origin: EventOrigin;
  /** The error code the worker received. */
  code: string;
  deviceTimestamp: string;
  serverReceivedAt: string;
  deviationSeconds: number | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationSuspected: boolean;
  distanceMeters: number | null;
  allowedRadiusMeters: number | null;
  requiredAccuracyMeters: number | null;
  temporaryCheckInPoint: EvidenceTemporaryPoint | null;
}

export interface EvidenceInfraction {
  id: string;
  businessMonth: string;
  monthlySequenceNumber: number;
  reversedAt: string | null;
  reversalReason: string | null;
}

/** `GET /time-entries/:id/evidence`: everything a manager needs to decide on one entry. Never carries money. */
export interface TimeEntryEvidence {
  id: string;
  status: TimeEntryStatus;
  businessDate: string;
  /** Same flags (and rules) as the attendance list. */
  flags: AttendanceFlag[];
  checkInMethod: CheckInMethod;
  isEmergency: boolean;
  devRewoundAt: string | null;
  createdAt: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  rejectedReason: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  periodFinalized: boolean;
  worker: { id: string; fullLegalName: string; phoneNumber: string };
  shift: {
    id: string;
    title: string;
    shiftType: ShiftType;
    status: ShiftStatus;
    scheduledStart: string;
    scheduledEnd: string;
    checkInMethod: CheckInMethod;
    project: { id: string; name: string; client: string | null; projectCode: string } | null;
    site: { id: string; name: string; address: string | null; latitude: number; longitude: number; defaultGeofenceRadiusMeters: number } | null;
    geofence: { id: string; centerLatitude: number; centerLongitude: number; radiusMeters: number; minAccuracyMeters: number } | null;
  };
  duration: {
    rawDurationMinutes: number | null;
    unpaidBreakMinutes: number;
    workedMinutes: number | null;
    regularMinutes: number | null;
    overtimeMinutes: number | null;
    basis: "APPROVED" | "EXPECTED" | "OPEN";
    approvedSplitOutdated: boolean;
  };
  fullDayCredit: { applied: boolean; reason: string | null; appliedByName: string | null; appliedAt: string | null; eligible: boolean };
  emergency: {
    id: string;
    authorizationSource: EmergencyAuthorizationSource;
    authorizedByName: string | null;
    turanAssignmentId: string | null;
    actualStartClick: string;
    compensatedStart: string;
    actualEndClick: string | null;
    compensatedEnd: string | null;
    actualWorkedMinutes: number | null;
    retroactiveMinutes: number;
    returnBufferMinutes: number | null;
    compensatedDurationMinutes: number | null;
    start: { latitude: number; longitude: number };
    end: { latitude: number; longitude: number } | null;
  } | null;
  clockEvents: EvidenceClockEvent[];
  rejectedAttempts: RejectedClockAttempt[];
  dailySummary: {
    text: string | null;
    voiceNoteUrl: string | null;
    taskCategory: TaskCategory;
    materialsUsed: string | null;
    problemsEncountered: string | null;
    followUpRequired: boolean;
    createdAt: string;
  } | null;
  history: {
    corrections: {
      id: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      reason: CorrectionReason;
      note: string | null;
      editedByName: string | null;
      createdAt: string;
      infraction: EvidenceInfraction | null;
    }[];
    approvals: { id: string; action: ApprovalAction; actedByName: string | null; notes: string | null; createdAt: string }[];
    auditEvents: {
      id: string;
      action: string;
      entityType: string;
      actorName: string | null;
      field: string | null;
      oldValue: string | null;
      newValue: string | null;
      reason: string | null;
      note: string | null;
      createdAt: string;
    }[];
  };
  allowedActions: { approve: boolean; reject: boolean; requestCorrection: boolean; fullDayCredit: boolean; correct: boolean };
}

/** `GET /time-entries/:id/estimated-cost` (Owner only). */
export interface EntryCostEstimate {
  timeEntryId: string;
  basis: "APPROVED" | "ESTIMATED" | "OPEN" | "REJECTED" | "NO_COMPENSATION_PROFILE";
  compensationType: CompensationType | null;
  regularMinutes: number | null;
  overtimeMinutes: number | null;
  baseAgorot: number | null;
  overtimeAgorot: number | null;
  estimatedCostAgorot: number | null;
}

/** `GET /workers/:id/estimated-earnings?month=` (Owner only). */
export interface WorkerMonthEarnings {
  workerProfileId: string;
  month: string;
  approvedAgorot: number;
  pendingEstimateAgorot: number;
  adjustmentsAgorot: number;
  totalEstimatedAgorot: number;
  approvedEntries: number;
  pendingEntries: number;
  openEntries: number;
  entriesWithoutCompensationProfile: number;
}

export interface EmergencyCalloutFilters {
  workerProfileId?: string;
  from?: string;
  to?: string;
  status?: TimeEntryStatus;
  page?: number;
  pageSize?: number;
}

/** An emergency call-out. `estimatedCostAgorot` exists only in an Owner's response (the key is absent for anyone else). */
export interface EmergencyCalloutRecord {
  id: string;
  worker: { id: string; fullLegalName: string };
  authorizationSource: EmergencyAuthorizationSource;
  authorizedByName: string | null;
  turanAssignment: { id: string; turanType: TuranType; startAt: string; endAt: string } | null;
  actualStartClick: string;
  compensatedStart: string;
  actualEndClick: string | null;
  compensatedEnd: string | null;
  actualWorkedMinutes: number | null;
  retroactiveMinutes: number;
  returnBufferMinutes: number | null;
  compensatedDurationMinutes: number | null;
  start: { latitude: number; longitude: number; accuracyMeters: number | null };
  end: { latitude: number; longitude: number; accuracyMeters: number | null } | null;
  timeEntryId: string | null;
  status: TimeEntryStatus | null;
  businessDate: string | null;
  summary: {
    text: string | null;
    taskCategory: TaskCategory;
    materialsUsed: string | null;
    problemsEncountered: string | null;
    followUpRequired: boolean;
  } | null;
  createdAt: string;
  estimatedCostAgorot?: number | null;
}

/** A forgotten-stamp infraction. `deductionAgorot` exists only in an Owner's response. */
export interface ForgottenStampInfraction {
  id: string;
  workerProfileId: string;
  timeEntryId: string;
  correctionId: string;
  businessMonth: string;
  monthlySequenceNumber: number;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  reversalAdjustmentId: string | null;
  createdAt: string;
  deductionAgorot?: number;
  worker: { id: string; fullLegalName: string };
  correction: {
    id: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    reason: CorrectionReason;
    note: string | null;
    editedBy: string;
    editedByName: string | null;
    createdAt: string;
  };
  timeEntry: { id: string; businessDate: string; status: TimeEntryStatus };
}

/** Body of `POST /manual-corrections`. */
export interface ManualCorrectionInput {
  /** Omit (with shiftId + workerProfileId) to add a missing clock-in as a new entry. */
  timeEntryId?: string;
  shiftId?: string;
  workerProfileId?: string;
  field: "CLOCK_IN" | "CLOCK_OUT" | "UNPAID_BREAK_MINUTES";
  /** ISO instant for CLOCK_IN/CLOCK_OUT, whole minutes for UNPAID_BREAK_MINUTES. */
  newValue: string;
  reason: CorrectionReason;
  /** Required when reason is OTHER. */
  note?: string;
}

// ── Step 6: temporary supervisors ────────────────────────────────────────

/** `GET /shifts/:id/temporary-supervisors`: a shift's assignments with their state now. */
export interface TemporarySupervisorListItem {
  id: string;
  shiftId: string;
  worker: { id: string; fullLegalName: string };
  activatedAt: string;
  expiresAt: string;
  canOpenCheckInPoints: boolean;
  state: TemporarySupervisorState;
  assignedByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  createdAt: string;
}

/** `GET /temporary-supervisors/me`: the caller's ACTIVE assignments. */
export interface MyTemporarySupervision {
  id: string;
  activatedAt: string;
  expiresAt: string;
  canOpenCheckInPoints: boolean;
  shift: { id: string; title: string; shiftType: ShiftType; scheduledStart: string; scheduledEnd: string; siteName: string | null };
}

export interface SupervisedShiftWorker {
  workerProfileId: string;
  fullLegalName: string;
  presence: ShiftWorkerPresence;
  clockInAt: string | null;
  clockOutAt: string | null;
  locationOutcome: LocationValidationStatus | null;
  flags: AttendanceFlag[];
}

/** `GET /temporary-supervisors/:assignmentId/shift`: operational only (no money, no phone numbers). */
export interface SupervisedShift {
  assignment: { id: string; activatedAt: string; expiresAt: string; canOpenCheckInPoints: boolean };
  shift: {
    id: string;
    title: string;
    shiftType: ShiftType;
    status: ShiftStatus;
    scheduledStart: string;
    scheduledEnd: string;
    businessDate: string;
    checkInMethod: CheckInMethod;
    projectName: string | null;
    site: { name: string; latitude: number; longitude: number } | null;
    geofence: { centerLatitude: number; centerLongitude: number; radiusMeters: number } | null;
  };
  workers: SupervisedShiftWorker[];
  temporaryCheckInPoints: { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; expiresAt: string; createdAt: string }[];
}

// ── Step 6: live operations (no money for anyone) ───────────────────────

export interface OperationsPerson {
  id: string;
  fullLegalName: string;
}
export interface OperationsShiftRef {
  id: string;
  title: string;
  shiftType: ShiftType;
}

export interface OperationsSnapshot {
  generatedAt: string;
  workersOnShift: {
    timeEntryId: string;
    worker: OperationsPerson;
    shift: OperationsShiftRef;
    clockInAt: string | null;
    openMinutes: number;
    isEmergency: boolean;
    position: {
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      at: string;
      eventType: ClockEventType;
      locationValidationStatus: LocationValidationStatus;
    } | null;
  }[];
  sites: { siteId: string; name: string; centerLatitude: number; centerLongitude: number; radiusMeters: number }[];
  temporaryPoints: { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; expiresAt: string; shift: OperationsShiftRef }[];
  activeEmergencies: {
    calloutId: string;
    timeEntryId: string | null;
    worker: OperationsPerson;
    authorizationSource: EmergencyAuthorizationSource;
    actualStartClick: string;
    compensatedStart: string;
    start: { latitude: number; longitude: number };
  }[];
  activeShifts: {
    id: string;
    title: string;
    shiftType: ShiftType;
    scheduledStart: string;
    scheduledEnd: string;
    siteName: string | null;
    expectedCount: number;
    clockedInCount: number;
    lateCount: number;
  }[];
  lateWorkers: { worker: OperationsPerson; shift: OperationsShiftRef; scheduledStart: string; graceMinutes: number; lateMinutes: number }[];
  longOpenEntries: { timeEntryId: string; worker: OperationsPerson; shift: OperationsShiftRef; clockInAt: string | null; openMinutes: number; isEmergency: boolean }[];
  recentRejectedAttempts: {
    id: string;
    eventType: ClockEventType;
    code: string;
    at: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    distanceMeters: number | null;
    allowedRadiusMeters: number | null;
    requiredAccuracyMeters: number | null;
    timeEntryId: string | null;
    worker: OperationsPerson;
    shift: OperationsShiftRef;
  }[];
  suspiciousLocations: {
    clockEventId: string;
    eventType: ClockEventType;
    origin: EventOrigin;
    at: string;
    latitude: number;
    longitude: number;
    mockLocationSuspected: boolean;
    locationValidationStatus: LocationValidationStatus;
    timeEntryId: string;
    worker: OperationsPerson;
    shift: OperationsShiftRef;
  }[];
  offlineReview: {
    id: string;
    eventType: ClockEventType;
    status: OfflineSyncEventStatus;
    deviceTimestamp: string;
    processedAt: string;
    rejectionReason: string | null;
    timeEntryId: string | null;
    worker: OperationsPerson;
  }[];
}

// ── Step 6: organization settings ───────────────────────────────────────

/** Besides the Owners, who a manager-facing notification reaches. */
export type FieldManagerAudience = "SHIFT_MANAGER" | "ALL_FIELD_MANAGERS";

export interface NotificationPreferenceView {
  type: NotificationType;
  fieldManagerAudience: FieldManagerAudience;
  owners: boolean;
  fieldManagers: boolean;
  defaults: { owners: boolean; fieldManagers: boolean };
}

export interface WorkdaySettings {
  defaultGraceMinutes: number;
  defaultGeofenceRadiusMeters: number;
  defaultMinGpsAccuracyMeters: number;
  deviceTimeDeviationSeconds: number;
  temporaryPointRadiusMeters: number;
  temporaryPointMinAccuracyMeters: number;
  autoDeductUnpaidBreaks: boolean;
}

/** `GET /organizations/me/settings`. `forgottenStampPenaltyAgorot` is in an Owner's copy only. */
export interface OrganizationSettingsView {
  canEdit: boolean;
  workday: WorkdaySettings & { timezone: string };
  onboarding: { invitationTtlHours: number };
  notifications: NotificationPreferenceView[];
  testMode: { appEnv: string; devLoginEnabled: boolean };
  fixedRules: {
    standardDayMinutes: number;
    freeForgottenStampsPerMonth: number;
    emergencyRetroactiveMinutes: number;
    emergencyReturnBufferMinutes: number;
    forgottenStampPenaltyAgorot?: number;
  };
  updatedAt: string;
}

// ── Step 6: users, roles and devices ────────────────────────────────────

export interface Member {
  id: string;
  userId: string;
  fullLegalName: string;
  phoneNumber: string;
  role: OrgRole;
  status: AccountStatus;
  isTimeTrackable: boolean;
  workerProfileId: string | null;
  /** Latest sign-in or token refresh in this organization. */
  lastActiveAt: string | null;
  createdAt: string;
  archivedAt: string | null;
  isSelf: boolean;
}

export type DeviceKeyStatus = "NONE" | "ACTIVE" | "REVOKED";

export interface MemberSession {
  id: string;
  /** OTP | DEV_LOGIN | DEV_FIXED_OTP */
  origin: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  active: boolean;
}

export interface MemberDevice {
  id: string;
  clientDeviceId: string;
  platform: string;
  appVersion: string | null;
  osVersion: string | null;
  lastActiveAt: string | null;
  key: { status: DeviceKeyStatus; registeredAt: string | null; revokedAt: string | null };
  sessions: MemberSession[];
}
