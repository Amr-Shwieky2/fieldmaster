import type {
  AccountStatus,
  Permission,
  WorkRules,
  WorkRuleKey,
  WorkRuleVersion,
  ApprovalAction,
  AttendanceFlag,
  AttendanceListTab,
  CheckInMethod,
  ClockEventType,
  CompensationType,
  CorrectionReason,
  FileAssetPurpose,
  OnboardingFilePurpose,
  GovernmentIdType,
  InvitationStatus,
  EmergencyAuthorizationSource,
  EventOrigin,
  LocationValidationStatus,
  MockLocationState,
  DevicePlatform,
  NotificationType,
  OfflineSyncEventStatus,
  OrgRole,
  PayrollAdjustmentSource,
  PayrollAdjustmentType,
  PayrollCalculationState,
  PayrollFigureSource,
  PayrollPeriodStatus,
  ReportStatus,
  ReportType,
  SalaryStatementStatus,
  ShiftStatus,
  ShiftType,
  ShiftWorkerPresence,
  SummarySource,
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
  /** Step 9: shown on the worker's shift screen (GET /shifts/:id). */
  instructions?: string | null;
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
  /** Only on GET /shifts/:id. For a Worker: only the points usable right now (active, not expired); managers get every point. */
  temporaryCheckInPoints?: TemporaryCheckInPoint[];
  /** Step 9, only on GET /shifts/:id: the shift manager's full name. */
  managerName?: string | null;
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
  /** Step 9: what the phone reported (null on events before Step 9 or when it did not say). */
  mockLocationState?: MockLocationState | null;
  /** Step 9: movement heuristics recorded with the event (never a refusal on their own). */
  locationSignals?: string[];
  distanceFromSiteMeters: number | null;
  locationValidationStatus: string;
}

/**
 * Response of POST /clock-events/clock-in. The receipt (Step 9): `clockEvent.id`
 * is the reference, with `serverReceivedAt` and `deviceTimestamp`;
 * `timeEntry.shift` carries the shift (id, title, ...).
 */
export interface ClockInResult {
  timeEntry: TimeEntry;
  clockEvent: ClockEvent;
}

/**
 * Response of POST /clock-events/clock-out: the closed entry (as before Step 9)
 * with its shift and, for the receipt, the clock-out event (`clockEvent.id` is
 * the reference, with `serverReceivedAt` and `deviceTimestamp`).
 */
export interface ClockOutResult extends TimeEntry {
  shift: Shift;
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

// ── Payroll (Step 7) ─────────────────────────────────────────────────
// Every payroll response is Owner only (the API answers 403 to anyone else),
// except `MySalaryStatements`, which holds only the caller's own pay.
// A month's payroll has versions: the latest is the working one; a FINALIZED
// version never changes, and reopening it creates the next version. A version
// is always shown from its stored calculation, never recomputed.

/** `GET /payroll-periods`: one row per month, with its latest version. */
export interface PayrollPeriodSummary {
  /** The latest version's id. */
  id: string;
  yearMonth: string;
  version: number;
  versionCount: number;
  status: PayrollPeriodStatus;
  /** From the latest version's calculation; null when it was never calculated. */
  workers: number | null;
  netPayableAgorot: number | null;
  calculatedAt: string | null;
  finalizedAt: string | null;
}

/** A background calculation of a version (`POST .../calculate` answers 202 with it). */
export interface PayrollCalculationRun {
  /** Also the job id: the same Idempotency-Key always gives the same run. */
  id: string;
  yearMonth: string;
  version: number;
  state: PayrollCalculationState;
  /** 0-100. */
  progress: number;
  processedWorkers: number;
  totalWorkers: number;
  requestedAt: string;
  requestedByName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** FAILED only: an API error code (`errors.<code>` in the messages). */
  errorCode: string | null;
}

/** One worker's results in a version. */
export interface PayrollWorkerLine {
  workerProfileId: string;
  fullLegalName: string;
  /** Null for versions calculated before Step 7 that did not store the entries. */
  approvedShifts: number | null;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  /** The -60 / +15 minutes of emergency call-outs, already inside the paid minutes above. */
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  /** Manual bonuses. */
  positiveAdjustmentsAgorot: number;
  /** Forgotten-stamp penalties (a positive amount, deducted). */
  forgottenStampPenaltiesAgorot: number;
  /** Reversals of forgotten-stamp penalties (a positive amount, added back). */
  reversalsAgorot: number;
  /** Manual deductions (a positive amount, deducted). */
  otherDeductionsAgorot: number;
  netPayableAgorot: number;
  /** Entries waiting for approval at calculation time: not included. Null before Step 7. */
  pendingEntries: number | null;
  /** Approved entries with no compensation profile on their date: not paid. Null before Step 7. */
  entriesWithoutCompensation: number | null;
}

export interface PayrollTotals {
  workers: number;
  approvedShifts: number | null;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  positiveAdjustmentsAgorot: number;
  forgottenStampPenaltiesAgorot: number;
  reversalsAgorot: number;
  otherDeductionsAgorot: number;
  netPayableAgorot: number;
}

/** A version's labor cost per project or per site (adjustments are per worker, so not included). */
export interface PayrollCostGroup {
  /** Project or site id; null = shifts without one (emergency call-outs). */
  id: string | null;
  name: string | null;
  /** Sites only: the site's project. */
  projectName?: string | null;
  approvedShifts: number;
  workers: number;
  regularMinutes: number;
  overtimeMinutes: number;
  grossBaseAgorot: number;
  overtimeAgorot: number;
  totalAgorot: number;
}

export interface PayrollAdjustmentLine {
  id: string;
  workerProfileId: string;
  fullLegalName: string;
  type: PayrollAdjustmentType;
  source: PayrollAdjustmentSource;
  /** Signed: positive adds, negative deducts. */
  amountAgorot: number;
  reason: string | null;
  createdAt: string;
  createdByName: string | null;
  /** Forgotten-stamp penalty: its infraction and the time entry it was recorded on. */
  relatedInfractionId: string | null;
  timeEntryId: string | null;
  /** A reversal: the penalty adjustment it cancels. */
  reversalOfId: string | null;
  /** A penalty: the adjustment that reversed it, if any. */
  reversedById: string | null;
}

/** What the Owner may do with this version now (the API enforces the same rules). */
export interface PayrollAllowedActions {
  calculate: boolean;
  finalize: boolean;
  reopen: boolean;
  addAdjustment: boolean;
}

/** `GET /payroll-periods/:yearMonth` (latest version) and `.../versions/:version`. */
export interface PayrollVersionDetail {
  id: string;
  yearMonth: string;
  version: number;
  status: PayrollPeriodStatus;
  /** The month's latest version (the working one, or the last finalized one). */
  isCurrent: boolean;
  /** Restored from before Step 7: only what was stored then is shown (see the nullable fields). */
  legacy: boolean;
  createdAt: string;
  createdByName: string | null;
  /** Version 2 and later: the reopen that created this version. */
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  previousVersion: number | null;
  /** The calculation shown (the finalized one, once FINALIZED). */
  calculatedAt: string | null;
  calculatedByName: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  /** The latest calculation run of this version (state, progress, error). */
  calculation: PayrollCalculationRun | null;
  /** Latest working version only: approved attendance, rates or adjustments changed after the calculation shown. */
  changedSinceCalculation: boolean;
  allowedActions: PayrollAllowedActions;
  /** Null until the version is calculated. */
  totals: PayrollTotals | null;
  workers: PayrollWorkerLine[];
  /** Null for legacy versions (not stored before Step 7). */
  projects: PayrollCostGroup[] | null;
  sites: PayrollCostGroup[] | null;
  /** Adjustments included in the calculation shown. */
  adjustments: PayrollAdjustmentLine[];
  /** Latest working version only: adjustments added after the calculation shown (included at the next calculation). */
  adjustmentsNotIncluded: PayrollAdjustmentLine[];
  warnings: {
    /** Approved entries that had no compensation profile on their date: not paid. */
    workersWithoutCompensation: { workerProfileId: string; fullLegalName: string; entries: number; businessDates: string[] }[];
  };
  /** Entries waiting for approval at calculation time ("بانتظار الموافقة — غير محسوبة"). Null when not known (legacy, or never calculated). */
  pending: { entries: number; byWorker: { workerProfileId: string; fullLegalName: string; entries: number }[] } | null;
  /** Legacy versions without items: the net per worker their old calculation stored. */
  legacyNetByWorker: { workerProfileId: string; fullLegalName: string; netPayableAgorot: number }[] | null;
}

/** `GET /payroll-periods/:yearMonth/versions`: the version history (who / when / why). */
export interface PayrollVersionSummary {
  id: string;
  version: number;
  status: PayrollPeriodStatus;
  isCurrent: boolean;
  legacy: boolean;
  createdAt: string;
  createdByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  calculatedAt: string | null;
  calculatedByName: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  workers: number | null;
  netPayableAgorot: number | null;
}

/** One approved entry as a version's calculation saw and paid it. */
export interface PayrollEntryLine {
  timeEntryId: string;
  businessDate: string;
  shift: { id: string; title: string; shiftType: ShiftType };
  projectName: string | null;
  siteName: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  approvedRegularMinutes: number;
  approvedOvertimeMinutes: number;
  fullDayCredit: boolean;
  isEmergency: boolean;
  emergencyRetroactiveMinutes: number;
  emergencyReturnMinutes: number;
  /** Null: no compensation profile on that date, so the entry was not paid. */
  compensationType: CompensationType | null;
  standardDayCredited: boolean;
  regularMinutes: number;
  overtimeMinutes: number;
  baseAgorot: number;
  overtimeAgorot: number;
  totalAgorot: number;
}

/** `GET /payroll-periods/:yearMonth/versions/:version/workers/:workerProfileId`: a worker's drill-down. */
export interface PayrollWorkerDetail {
  yearMonth: string;
  version: number;
  worker: PayrollWorkerLine;
  /** Null for legacy versions (entries not stored before Step 7). */
  entries: PayrollEntryLine[] | null;
  adjustments: PayrollAdjustmentLine[];
}

export interface CreatePayrollAdjustmentInput {
  workerProfileId: string;
  type: "MANUAL_BONUS" | "MANUAL_DEDUCTION";
  /** A positive amount; the type gives the sign. */
  amountAgorot: number;
  reason: string;
}

/** Labor cost of a project or site in the Owner dashboard. */
export interface DashboardCostItem {
  /** Null = shifts without a project / site (emergency call-outs). */
  id: string | null;
  name: string | null;
  approvedShifts: number;
  laborCostAgorot: number;
  overtimeAgorot: number;
}

export interface DashboardWorkerCost {
  workerProfileId: string;
  fullLegalName: string;
  approvedShifts: number;
  overtimeMinutes: number;
  /** Base + overtime. */
  laborCostAgorot: number;
  /** After the month's adjustments. */
  netPayableAgorot: number;
}

export interface DashboardDay {
  /** YYYY-MM-DD (Asia/Jerusalem business date). */
  date: string;
  laborCostAgorot: number;
  overtimeAgorot: number;
  overtimeMinutes: number;
  isOvertimeSpike: boolean;
}

export interface DashboardOvertimeSpike {
  date: string;
  overtimeMinutes: number;
  overtimeAgorot: number;
  /** The day's threshold: max(spikeMinimumMinutes, spikeFactor x the average). */
  thresholdMinutes: number;
  workers: { workerProfileId: string; fullLegalName: string; overtimeMinutes: number }[];
}

/** `GET /payroll-periods/:yearMonth/dashboard` (Owner only). */
export interface FinancialDashboard {
  yearMonth: string;
  /** FINALIZED: the month's latest version is finalized and the figures are its own; LIVE: approved attendance and adjustments so far. */
  source: PayrollFigureSource;
  finalizedVersion: number | null;
  /** Labor cost + adjustments: what the month pays. */
  netPayableAgorot: number;
  laborCostAgorot: number;
  previousMonth: { yearMonth: string; source: PayrollFigureSource; netPayableAgorot: number; laborCostAgorot: number };
  costByProject: DashboardCostItem[];
  costBySite: (DashboardCostItem & { projectName: string | null })[];
  /** Every worker with pay this month, highest net first. */
  costByWorker: DashboardWorkerCost[];
  /** The first five of costByWorker. */
  topEarners: DashboardWorkerCost[];
  overtime: {
    totalAgorot: number;
    totalMinutes: number;
    /** Overtime minutes per working day (a day with at least one approved shift). */
    averageDailyMinutes: number;
    spikeFactor: number;
    spikeMinimumMinutes: number;
    spikes: DashboardOvertimeSpike[];
  };
  forgottenStamps: { penalties: number; penaltiesAgorot: number; reversals: number; reversalsAgorot: number; netDeductionsAgorot: number };
  emergencies: { callouts: number; compensatedMinutes: number; costAgorot: number };
  /** Every day of the month up to today (the whole month for a past month). */
  dailyTrend: DashboardDay[];
  /** Entries waiting for approval now (always live): what they would cost if approved as recorded. */
  pendingApproval: { entries: number; exposureAgorot: number; entriesWithoutCompensation: number };
  workersWithoutCompensation: { workerProfileId: string; fullLegalName: string; entries: number }[];
}

/** One month of the caller's own salary (`GET /payroll-statements/me`). */
export interface SalaryStatement {
  yearMonth: string;
  status: SalaryStatementStatus;
  /** True for DRAFT: an estimate from the approved attendance so far, not a finalized payslip. */
  isEstimate: boolean;
  /** The finalized version the statement comes from; null for an estimate. */
  version: number | null;
  finalizedAt: string | null;
  approvedShifts: number | null;
  standardDaysCredited: number;
  regularMinutes: number;
  overtimeMinutes: number;
  baseAgorot: number;
  overtimeAgorot: number;
  /** Base + overtime. */
  grossAgorot: number;
  /** Manual bonuses minus manual deductions. */
  adjustmentsAgorot: number;
  /** Forgotten-stamp penalties minus their reversals. */
  forgottenStampDeductionsAgorot: number;
  netPayableAgorot: number;
  /** Estimates only: the caller's entries still waiting for approval (not included). */
  pendingEntries: number | null;
}

export interface MySalaryStatements {
  /** Finalized months, newest first. */
  statements: SalaryStatement[];
  /** Months without a finalized version yet (the current month, and the previous one until it is finalized), newest first. */
  estimates: SalaryStatement[];
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

// ── Reports (Step 8) ────────────────────────────────────────────────────
// Every report is generated by a background job as a PDF and a CSV (UTF-8
// with BOM). Money appears only in a financial report (an Owner's, or a
// worker's own ledger); a Field Manager's report uses an operational template.

/** Filters of a report. Dates are business dates (YYYY-MM-DD, Asia/Jerusalem), inclusive. */
export interface ReportFilters {
  /** Required for every type except PAYROLL. */
  fromDate?: string;
  toDate?: string;
  /** Required for WORKER_ATTENDANCE_LEDGER; optional for the others (not PAYROLL). */
  workerProfileId?: string;
  /** Optional narrowing (OPERATIONAL_ATTENDANCE, OVERTIME, SITE_VIOLATIONS). */
  projectId?: string;
  siteId?: string;
  /** PAYROLL only: the month and the payroll version (Owner only). */
  yearMonth?: string;
  version?: number;
}

export interface CreateReportInput {
  reportType: ReportType;
  filters: ReportFilters;
}

/** `POST /reports` (202), `GET /reports`, `GET /reports/:id`. */
export interface GeneratedReport {
  id: string;
  reportType: ReportType;
  status: ReportStatus;
  /** 0-100. */
  progress: number;
  filters: ReportFilters;
  /** True: the financial template (an Owner's report, or a worker's own ledger). */
  includesFinancials: boolean;
  templateVersion: string;
  requestedByUserId: string;
  requestedByName: string | null;
  subjectWorkerProfileId: string | null;
  subjectWorkerName: string | null;
  /** SHA-256 of the report's source data, printed in every PDF footer. Null until generated. */
  sha256Hash: string | null;
  /** SHA-256 of the stored files (what `verify` recomputes). Null until generated (and for reports from before Step 8: no CSV, no file hash). */
  pdfSha256: string | null;
  csvSha256: string | null;
  pageCount: number | null;
  /** FAILED only: an API error code (`errors.<code>`). */
  errorCode: string | null;
  /** When it was requested. */
  generatedAt: string;
  finishedAt: string | null;
}

export type ReportFileFormat = "pdf" | "csv";

/** `GET /reports/:id/download?format=pdf|csv`: a short-lived signed URL (the download is audited). */
export interface ReportDownload {
  downloadUrl: string;
  expiresInSeconds: number;
  fileName: string;
  sha256: string | null;
}

/** `GET /reports/:id/verify`: the stored files hashed again and compared with the hashes recorded at generation. */
export interface ReportVerification {
  reportId: string;
  /** Every stored file matches its recorded hash. False when a file changed or no hash was recorded. */
  valid: boolean;
  checkedAt: string;
  dataSha256: string | null;
  files: { format: "PDF" | "CSV"; expectedSha256: string | null; actualSha256: string | null; matches: boolean }[];
}

// ── Worker onboarding (Step 8) ──────────────────────────────────────────

/** `GET /onboarding-invitations` (Owner and Field Manager). Tokens are never listed: only their hash is stored. */
export interface OnboardingInvitation {
  id: string;
  status: InvitationStatus;
  prefilledPhoneNumber: string | null;
  createdAt: string;
  createdByName: string | null;
  expiresAt: string;
  usedAt: string | null;
  /** The pending (or approved) worker its application created. */
  workerProfileId: string | null;
  workerName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
}

/** `POST /onboarding-invitations`: the only time the token is returned. The link is `<admin web origin><joinPath>`. */
export interface CreatedInvitation {
  invitationId: string;
  token: string;
  joinPath: string;
  expiresAt: string;
}

/** `GET /onboarding/invitations/:token` (public). An invalid, used, expired or revoked token is 404 `INVITATION_INVALID_OR_EXPIRED`, without saying which. */
export interface PublicInvitation {
  organizationName: string;
  prefilledPhoneNumber: string | null;
  expiresAt: string;
  privacyNoticeVersion: string;
  maxUploadBytes: number;
  allowedContentTypes: Record<OnboardingFilePurpose, string[]>;
}

/** `POST /onboarding/invitations/:token/uploads` (public, multipart: `file`, `purpose`). */
export interface UploadedFile {
  fileAssetId: string;
  purpose: FileAssetPurpose;
  /** Detected from the file's content. */
  contentType: string;
  sizeBytes: number;
}

/** `POST /onboarding/invitations/:token/redeem` (public). */
export interface JoinApplicationInput {
  /** E.164, e.g. +972501234567 (the number the worker signs in with). */
  phoneNumber: string;
  fullLegalName: string;
  preferredName?: string;
  governmentIdType: GovernmentIdType;
  governmentIdNumber: string;
  identityDocumentAssetId: string;
  profilePhotoAssetId?: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  accountHolderName: string;
  consentAccepted: true;
  privacyNoticeVersion: string;
}

export interface UploadedFileSummary {
  fileAssetId: string;
  contentType: string;
  sizeBytes: number;
}

/** `GET /workers/:id/onboarding-review` (Owner only; every view is audited): the application with its sensitive fields decrypted. */
export interface OnboardingReview {
  workerProfileId: string;
  membershipStatus: AccountStatus;
  fullLegalName: string;
  preferredName: string | null;
  phoneNumber: string;
  submittedAt: string;
  governmentIdType: GovernmentIdType | null;
  governmentIdNumber: string | null;
  bankAccount: { bankName: string; branchNumber: string; accountNumber: string; accountHolderName: string } | null;
  consentAcceptedAt: string | null;
  privacyNoticeVersion: string | null;
  identityDocument: UploadedFileSummary | null;
  profilePhoto: UploadedFileSummary | null;
}

/** `GET /file-assets/:id/view-url` (Owner only; every view is audited): a short-lived signed URL. */
export interface FileViewUrl {
  url: string;
  expiresInSeconds: number;
  contentType: string;
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
  /** The standard day and overtime threshold in force on the entry's business date. */
  dayRules?: { standardDayMinutes: number; overtimeThresholdMinutes: number };
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
  /** The day-length rules in force on the entry's business date (no money): the correction preview splits minutes with them. */
  dayRules?: { standardDayMinutes: number; overtimeThresholdMinutes: number };
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

// ── Step 9: the mobile worker app ─────────────────────────────────────────

/** `PUT /devices/me`: the signed-in device registers itself (on every sign-in and app start; an upsert). */
export interface RegisterDeviceInput {
  /** The app's stable install id (the one sent at sign-in). */
  deviceId: string;
  platform: DevicePlatform;
  osVersion: string | null;
  appVersion: string | null;
  /** An Expo push token ("ExponentPushToken[...]"), or null when push is not available or not allowed. */
  pushToken: string | null;
  /** What the attestation adapter could tell (dev: "DEV_MOCK"; real devices without an attestation module: "UNAVAILABLE"). */
  attestationState?: string;
}

export interface RegisteredDevice {
  deviceId: string;
  platform: DevicePlatform;
  /** The device's offline-signing key: ACTIVE, REVOKED by an Owner, or NONE yet. */
  keyStatus: DeviceKeyStatus;
  registeredAt: string;
}

/** A file in a React Native FormData (a local `file://` or `content://` uri), or a browser Blob/File. */
export type UploadableFile = Blob | { uri: string; name: string; type: string };

/** `POST /attachments` (multipart `purpose` + `file`): an attendance photo or a voice summary, private, for the caller only. */
export interface UploadedAttachment {
  fileAssetId: string;
  purpose: FileAssetPurpose;
  /** Detected from the file's content. */
  contentType: string;
  sizeBytes: number;
}

/** `POST /attachments/:id/transcription`: the voice summary as Arabic text, for the worker to check and edit before sending. */
export interface VoiceTranscription {
  fileAssetId: string;
  text: string;
  /** "mock" in development (a fixed Arabic sentence), otherwise the configured provider. */
  provider: string;
  language: "ar";
}

/**
 * Step 9 fields of POST /clock-events/clock-in and /clock-out (beside the
 * existing location, device and summary fields). Photos and the voice note
 * are uploaded first with `POST /attachments`, then referenced here; they
 * must be the caller's own, unused uploads.
 */
export interface ClockEventAttachmentFields {
  /** At most MAX_ATTENDANCE_PHOTOS ATTENDANCE_PHOTO uploads. */
  photoAssetIds?: string[];
  /** What the phone could tell about a fake location (Android's flag; iOS and web: UNAVAILABLE). */
  mockLocationState?: MockLocationState;
  /** Simple movement heuristics that looked suspicious (e.g. "IMPOSSIBLE_SPEED", "ZERO_ACCURACY"); recorded for review, never a refusal on their own. */
  locationSignals?: string[];
}

/** Clock-out only: the summary is typed, or recorded and transcribed (then possibly edited). Text or a voice note is required. */
export interface ClockOutSummaryFields {
  summaryText?: string;
  summarySource?: SummarySource;
  /** A VOICE_SUMMARY upload of the caller. */
  voiceNoteAssetId?: string;
  /** The transcript as the service returned it (before the worker's edits), kept with the summary. */
  transcription?: string;
  followUpRequired?: boolean;
}

/** `GET /emergency-callouts/eligibility`: whether the caller may start an emergency call-out right now, and why not. */
export interface EmergencyEligibility {
  eligible: boolean;
  /** Why not (an API error code such as "EMERGENCY_NOT_ELIGIBLE" or "ACTIVE_TIME_ENTRY_EXISTS"); null when eligible. */
  reason: string | null;
  /** The Turan assignment that makes the caller eligible (or would, if active). */
  turanAssignment: TuranAssignment | null;
  /** A call-out already running for the caller (the app shows its timer instead of the start button). */
  activeCallout: { calloutId: string; timeEntryId: string; actualStartClick: string; compensatedStart: string } | null;
}

/** `GET /time-entries/:id/my-pay`: the caller's own pay for one APPROVED entry (404 for anyone else's entry). */
export interface MyEntryPay {
  timeEntryId: string;
  /** False until the entry is approved: no amount is computed before. */
  approved: boolean;
  compensationType: CompensationType | null;
  regularMinutes: number;
  overtimeMinutes: number;
  /** Emergency call-outs: the paid minutes include the −60 / +15 compensation. */
  compensatedMinutes: number | null;
  baseAgorot: number | null;
  overtimeAgorot: number | null;
  totalAgorot: number | null;
  /** True when the entry's month is finalized (the amount is the finalized one). */
  finalized: boolean;
}

/** `GET /payroll-statements/me/current`: the open month as a labeled estimate ("تقدير — غير نهائي"), from approved entries only. */
export interface CurrentSalaryEstimate extends SalaryStatement {
  isEstimate: true;
  /** Always "APPROVED_ENTRIES_ONLY": pending entries are counted in `pendingEntries`, never paid. */
  basis: "APPROVED_ENTRIES_ONLY";
  calculatedAt: string;
}

/** The caller's own notification preferences (`GET/PATCH /notifications/preferences`): in-app always; push per type. */
export interface MyNotificationPreferences {
  /** One line per notification type the caller can receive. */
  preferences: { type: NotificationType; push: boolean }[];
}

/** The worker's own entry detail additions (GET /time-entries/:id for the caller's own entry, Step 9). No money. */
export interface MyTimeEntryCorrection {
  field: string;
  oldValue: string | null;
  newValue: string;
  reason: CorrectionReason;
  note: string | null;
  correctedAt: string;
  correctedByName: string | null;
}

export interface MyTimeEntryDetail extends TimeEntry {
  /** Step 9: the manager's reason when the entry was rejected. */
  rejectedReason?: string | null;
  corrections: MyTimeEntryCorrection[];
  summary: {
    text: string | null;
    taskCategory: TaskCategory;
    followUpRequired: boolean;
    summarySource: SummarySource | null;
    hasVoiceNote: boolean;
  } | null;
  photoCount: number;
}

/**
 * Step 9: the `data` of a push notification (Expo). Only what the app needs
 * to open the right screen: the in-app notification's id and type, and the
 * ids of the records it is about. Never a name, an amount or a reason (a push
 * can show on a locked screen; the in-app notification has the details).
 * The title is the type's Arabic label and the body a generic «عرض التفاصيل».
 */
export interface PushNotificationData {
  notificationId: string;
  type: NotificationType;
  timeEntryId?: string;
  shiftId?: string;
  calloutId?: string;
  /** A temporary-supervisor assignment (TEMPORARY_SUPERVISOR_ISSUE_REPORTED). */
  assignmentId?: string;
  /** A Turan assignment (TURAN_ASSIGNMENT_CREATED / _CHANGED about a Turan; a shift assignment carries shiftId instead). */
  turanAssignmentId?: string;
  /** YYYY-MM. */
  yearMonth?: string;
}

// ── Flexible organization model: roles, permissions, scope, work rules ──

/** `GET /auth/me`: who the caller is right now. Clients decide what to show from `permissions`, never from a role's name. */
export interface MyAccess {
  userId: string;
  membershipId: string;
  organizationId: string;
  /** OWNER / FIELD_MANAGER / WORKER for the built-in roles, CUSTOM for a role an Owner created. */
  role: OrgRole;
  roleId: string | null;
  roleName: string | null;
  /** Effective permissions (a member restricted to some projects has no organization-wide ones). */
  permissions: Permission[];
  isTimeTrackable: boolean;
  workerProfileId: string | null;
  /** The rules in force today that apps show or apply (never money: the forgotten-stamp penalty is not here). */
  workRules: Pick<WorkRules, "standardDayMinutes" | "overtimeThresholdMinutes" | "emergencyMinutesBefore" | "emergencyMinutesAfter" | "clockInEarlyWindowMinutes">;
  scope: { restricted: boolean; projectIds: string[]; siteIds: string[]; visibleProjectIds: string[] };
}

export interface Role {
  id: string;
  /** A built-in role: fixed permissions, never edited or archived. */
  name: string;
  description: string | null;
  isSystem: boolean;
  systemKey: "OWNER" | "FIELD_MANAGER" | "WORKER" | null;
  permissions: Permission[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface RoleDetail extends Role {
  members: { membershipId: string; userId: string; fullLegalName: string; status: AccountStatus }[];
}

/** `GET /roles/catalog`: the permissions grouped as the role editor shows them. */
export interface PermissionCatalog {
  groups: {
    group: "ATTENDANCE" | "SCHEDULING" | "SITES" | "WORKERS" | "FINANCE" | "REPORTS" | "SETTINGS" | "AUDIT";
    permissions: { permission: Permission; requires: Permission[]; financial: boolean; organizationWide: boolean }[];
  }[];
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: Permission[];
  reason?: string;
}

/** `GET /memberships/access`: each member's role record and project scope. */
export interface MemberAccess {
  membershipId: string;
  roleId: string | null;
  roleName: string | null;
  restrictedToScope: boolean;
  projectIds: string[];
  siteIds: string[];
}

export interface SetMemberScopeInput {
  /** false = every project; true = only the projects and sites below (at least one). */
  restricted: boolean;
  projectIds?: string[];
  siteIds?: string[];
  reason: string;
}

export interface OwnerLimit {
  /** null = no limit. */
  maxOwners: number | null;
  activeOwners: number;
  canEdit: boolean;
}

/** A work-rule version as the API shows it: the money rule (the penalty) is absent for a member who may not see money. */
export interface WorkRuleVersionView extends Omit<WorkRuleVersion, "rules"> {
  rules: Partial<WorkRules>;
}

export interface WorkRulesView {
  canEdit: boolean;
  canSeeMoney: boolean;
  /** The rules in force today. */
  current: Partial<WorkRules>;
  defaults: Partial<WorkRules>;
  limits: Partial<Record<WorkRuleKey, { min: number; max: number }>>;
  /** Oldest first. A version whose `effectiveFrom` is after `today` has not started yet. */
  versions: WorkRuleVersionView[];
  /** YYYY-MM-DD (Asia/Jerusalem). */
  today: string;
}

export interface WorkRulesImpact {
  effectiveFrom: string;
  openMonths: { yearMonth: string; status: string; version: number | null }[];
  finalizedMonths: { yearMonth: string; version: number }[];
}

/** `POST /organizations/me/work-rules`: only the rules sent change; `effectiveFrom` is after today. */
export interface CreateWorkRuleVersionInput extends Partial<WorkRules> {
  effectiveFrom: string;
  reason: string;
}
