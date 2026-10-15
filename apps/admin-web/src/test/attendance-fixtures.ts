import { ApiRequestError, type AttendanceListItem, type AttendanceListResponse, type EmergencyCalloutRecord, type ForgottenStampInfraction, type TimeEntryEvidence } from "@fieldmaster/api-client";

/**
 * Step 5 test data: what the API returns for the attendance screens. Times are
 * UTC instants; in Asia/Jerusalem (IDT, UTC+3) 04:00Z reads 07:00.
 */

export function apiError(status: number, code: string, message = "Message from the API", details: Record<string, unknown> = {}) {
  return new ApiRequestError(status, { statusCode: status, code, message, details, correlationId: "test-correlation" });
}

/** True when any Arabic-Indic digit is on screen (the app must show 0-9 only). */
export function hasArabicIndicDigits(text: string | null | undefined): boolean {
  return /[٠-٩۰-۹]/.test(text ?? "");
}

export const LIST_ITEM: AttendanceListItem = {
  id: "te-1",
  status: "PENDING_APPROVAL",
  businessDate: "2026-10-04",
  clockInAt: "2026-10-04T04:00:00.000Z",
  clockOutAt: "2026-10-04T14:30:00.000Z",
  rawDurationMinutes: 630,
  unpaidBreakMinutes: 0,
  approvedRegularMinutes: null,
  approvedOvertimeMinutes: null,
  fullDayCredit: false,
  isEmergency: false,
  devRewoundAt: null,
  checkInMethod: "GEOFENCED",
  // What the API sends with every row: the day rules in force on its business date.
  dayRules: { standardDayMinutes: 540, overtimeThresholdMinutes: 540 },
  worker: { id: "wp-1", fullLegalName: "خالد ناصر" },
  shift: { id: "s-1", title: "تنظيم حركة المرور صباحًا", shiftType: "STANDARD", project: { id: "p-1", name: "مشروع أيالون" }, site: { id: "site-1", name: "تقاطع الشمال" } },
  dailySummary: { text: "أغلقت المسرب ونظّمت حركة المرور.", taskCategory: "TRAFFIC_CONTROL" },
  flags: ["OUTSIDE_GEOFENCE_ATTEMPT"],
};

export function listPage(items: AttendanceListItem[], overrides: Partial<AttendanceListResponse> = {}): AttendanceListResponse {
  return { items, page: 1, pageSize: 20, total: items.length, tabCounts: { PENDING: items.length, APPROVED: 0, REJECTED: 0, ALL: items.length }, ...overrides };
}

/** A pending 10 h 30 m entry with one refused clock-in (outside the geofence) and a corrected clock-in. */
export const EVIDENCE: TimeEntryEvidence = {
  dayRules: { standardDayMinutes: 540, overtimeThresholdMinutes: 540 },
  id: "te-1",
  status: "PENDING_APPROVAL",
  businessDate: "2026-10-04",
  flags: ["OUTSIDE_GEOFENCE_ATTEMPT"],
  checkInMethod: "GEOFENCED",
  isEmergency: false,
  devRewoundAt: null,
  createdAt: "2026-10-04T04:10:00.000Z",
  clockInAt: "2026-10-04T04:00:00.000Z",
  clockOutAt: "2026-10-04T14:30:00.000Z",
  rejectedReason: null,
  approvedAt: null,
  approvedByName: null,
  periodFinalized: false,
  worker: { id: "wp-1", fullLegalName: "خالد ناصر", phoneNumber: "+972500010001" },
  shift: {
    id: "s-1",
    title: "تنظيم حركة المرور صباحًا",
    shiftType: "STANDARD",
    status: "PUBLISHED",
    scheduledStart: "2026-10-04T04:00:00.000Z",
    scheduledEnd: "2026-10-04T13:00:00.000Z",
    checkInMethod: "GEOFENCED",
    project: { id: "p-1", name: "مشروع أيالون", client: null, projectCode: "AYL-01" },
    site: { id: "site-1", name: "تقاطع الشمال", address: null, latitude: 32.0853, longitude: 34.7818, defaultGeofenceRadiusMeters: 150 },
    geofence: { id: "g-1", centerLatitude: 32.0853, centerLongitude: 34.7818, radiusMeters: 150, minAccuracyMeters: 50 },
  },
  duration: { rawDurationMinutes: 630, unpaidBreakMinutes: 0, workedMinutes: 630, regularMinutes: 540, overtimeMinutes: 90, basis: "EXPECTED", approvedSplitOutdated: false },
  fullDayCredit: { applied: false, reason: null, appliedByName: null, appliedAt: null, eligible: false },
  emergency: null,
  clockEvents: [
    {
      id: "ce-in",
      eventType: "CLOCK_IN",
      origin: "ONLINE",
      deviceId: "device-1",
      deviceTimestamp: "2026-10-04T05:00:30.000Z",
      serverReceivedAt: "2026-10-04T05:00:00.000Z",
      validatedAt: "2026-10-04T04:00:00.000Z",
      deviceTimeDeviationSeconds: 30,
      latitude: 32.0858,
      longitude: 34.7818,
      accuracyMeters: 10,
      mockLocationSuspected: false,
      distanceFromSiteMeters: 56,
      locationValidationStatus: "PASSED",
      isManualCorrection: false,
      appVersion: "1.0.0",
      temporaryCheckInPoint: null,
      offlineSync: null,
    },
    {
      id: "ce-out",
      eventType: "CLOCK_OUT",
      origin: "OFFLINE",
      deviceId: "device-1",
      deviceTimestamp: "2026-10-04T14:30:00.000Z",
      serverReceivedAt: "2026-10-04T15:10:00.000Z",
      validatedAt: "2026-10-04T14:30:00.000Z",
      deviceTimeDeviationSeconds: 2400,
      latitude: 32.0856,
      longitude: 34.7819,
      accuracyMeters: 12,
      mockLocationSuspected: false,
      distanceFromSiteMeters: null,
      locationValidationStatus: "FLAGGED",
      isManualCorrection: false,
      appVersion: "1.0.0",
      temporaryCheckInPoint: null,
      offlineSync: { status: "FLAGGED", syncedAt: "2026-10-04T15:10:00.000Z", offlineEventAgeSeconds: 2400, batchId: "batch-1", duplicateSyncs: 1 },
    },
  ],
  rejectedAttempts: [
    {
      id: "ra-1",
      eventType: "CLOCK_IN",
      origin: "ONLINE",
      code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
      deviceTimestamp: "2026-10-04T04:55:00.000Z",
      serverReceivedAt: "2026-10-04T04:55:00.000Z",
      deviationSeconds: 0,
      latitude: 32.0875,
      longitude: 34.7818,
      accuracyMeters: 10,
      mockLocationSuspected: false,
      distanceMeters: 229,
      allowedRadiusMeters: 150,
      requiredAccuracyMeters: null,
      temporaryCheckInPoint: null,
    },
  ],
  dailySummary: {
    text: "أغلقت المسرب ونظّمت حركة المرور.",
    voiceNoteUrl: null,
    taskCategory: "TRAFFIC_CONTROL",
    materialsUsed: "أقماع مرورية",
    problemsEncountered: null,
    followUpRequired: true,
    createdAt: "2026-10-04T14:30:00.000Z",
  },
  history: {
    corrections: [
      {
        id: "corr-1",
        field: "clockInAt",
        oldValue: "2026-10-04T05:00:00.000Z",
        newValue: "2026-10-04T04:00:00.000Z",
        reason: "FORGOTTEN_CLOCK_IN",
        note: null,
        editedByName: "يوسف الخطيب",
        createdAt: "2026-10-04T15:20:00.000Z",
        infraction: { id: "inf-1", businessMonth: "2026-10", monthlySequenceNumber: 3, reversedAt: null, reversalReason: null },
      },
    ],
    approvals: [],
    auditEvents: [
      { id: "a-1", action: "CLOCK_IN", entityType: "TimeEntry", actorName: "خالد ناصر", field: null, oldValue: null, newValue: null, reason: null, note: null, createdAt: "2026-10-04T05:00:00.000Z" },
      {
        id: "a-2",
        action: "MANUAL_TIME_CORRECTION",
        entityType: "TimeEntry",
        actorName: "يوسف الخطيب",
        field: "clockInAt",
        oldValue: "2026-10-04T05:00:00.000Z",
        newValue: "2026-10-04T04:00:00.000Z",
        reason: "FORGOTTEN_CLOCK_IN",
        note: null,
        createdAt: "2026-10-04T15:20:00.000Z",
      },
    ],
  },
  allowedActions: { approve: true, reject: true, requestCorrection: true, fullDayCredit: false, correct: true },
};

/** A Night Turan emergency call-out as a Field Manager receives it: no `estimatedCostAgorot` key at all. */
export const CALLOUT_FOR_MANAGER: EmergencyCalloutRecord = {
  id: "co-1",
  worker: { id: "wp-1", fullLegalName: "خالد ناصر" },
  authorizationSource: "NIGHT_TURAN_ASSIGNMENT",
  authorizedByName: null,
  turanAssignment: { id: "tu-1", turanType: "NIGHT_TURAN", startAt: "2026-10-04T17:00:00.000Z", endAt: "2026-10-05T05:00:00.000Z" },
  actualStartClick: "2026-10-04T21:26:00.000Z",
  compensatedStart: "2026-10-04T20:26:00.000Z",
  actualEndClick: "2026-10-04T22:26:00.000Z",
  compensatedEnd: "2026-10-04T22:41:00.000Z",
  actualWorkedMinutes: 60,
  retroactiveMinutes: 60,
  returnBufferMinutes: 15,
  compensatedDurationMinutes: 135,
  start: { latitude: 32.0858, longitude: 34.7818, accuracyMeters: 12 },
  end: { latitude: 32.0853, longitude: 34.7818, accuracyMeters: 8 },
  timeEntryId: "te-9",
  status: "PENDING_APPROVAL",
  businessDate: "2026-10-04",
  summary: { text: "أعدت تشغيل وحدة التحكم بالإشارة.", taskCategory: "EMERGENCY_REPAIR", materialsUsed: null, problemsEncountered: null, followUpRequired: false },
  createdAt: "2026-10-04T21:26:00.000Z",
};

/** The same call-out as an Owner receives it (Owner DTO: with the cost estimate). */
export const CALLOUT_FOR_OWNER: EmergencyCalloutRecord = { ...CALLOUT_FOR_MANAGER, estimatedCostAgorot: 11_111 };

/** Three forgotten stamps of one worker in October; the third deducted 10.00 (Owner rows only carry `deductionAgorot`). */
export function infractions(forOwner: boolean): ForgottenStampInfraction[] {
  return [1, 2, 3].map((sequence) => ({
    id: `inf-${sequence}`,
    workerProfileId: "wp-1",
    timeEntryId: `te-${sequence}`,
    correctionId: `corr-${sequence}`,
    businessMonth: "2026-10",
    monthlySequenceNumber: sequence,
    reversedAt: null,
    reversedBy: null,
    reversedByName: null,
    reversalReason: null,
    reversalAdjustmentId: null,
    createdAt: `2026-10-0${sequence}T15:00:00.000Z`,
    ...(forOwner ? { deductionAgorot: sequence >= 3 ? 1_000 : 0 } : {}),
    worker: { id: "wp-1", fullLegalName: "خالد ناصر" },
    correction: {
      id: `corr-${sequence}`,
      field: "clockOutAt",
      oldValue: null,
      newValue: `2026-10-0${sequence}T14:00:00.000Z`,
      reason: sequence === 2 ? "FORGOTTEN_CLOCK_IN" : "FORGOTTEN_CLOCK_OUT",
      note: null,
      editedBy: "u-fm",
      editedByName: "يوسف الخطيب",
      createdAt: `2026-10-0${sequence}T15:00:00.000Z`,
    },
    timeEntry: { id: `te-${sequence}`, businessDate: `2026-10-0${sequence}`, status: "PENDING_APPROVAL" },
  }));
}
