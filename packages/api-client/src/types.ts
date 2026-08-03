import type {
  AccountStatus,
  CheckInMethod,
  CompensationType,
  NotificationType,
  OfflineSyncEventStatus,
  OrgRole,
  PayrollPeriodStatus,
  ShiftStatus,
  ShiftType,
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
  shift?: Shift;
  dailySummary?: { text: string | null; taskCategory: string } | null;
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
  title: string;
  body: string;
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
