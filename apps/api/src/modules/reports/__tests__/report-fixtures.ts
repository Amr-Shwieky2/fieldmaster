import { ReportType } from "@fieldmaster/shared-types";
import type { ReportDocumentMeta } from "../report.types";
import type { LedgerEntry, LedgerFinancialData, LedgerOperationalData } from "../data/ledger.data";
import type { OperationalAttendanceData } from "../data/attendance.data";
import type { OvertimeFinancialData, OvertimeOperationalData } from "../data/overtime.data";
import type { EmergencyFinancialData, EmergencyOperationalData } from "../data/emergency-callouts.data";
import type { SiteViolationsData } from "../data/site-violations.data";
import type { ForgottenStampsFinancialData, ForgottenStampsOperationalData } from "../data/forgotten-stamps.data";
import type { PayrollReportData } from "../data/payroll.data";

/** Realistic report data without a database: an Arabic worker, a Latin one, a hostile name, every evidence kind. */

export const REPORT_ID = "01928c3e-7a1b-7c4d-9e2f-0a1b2c3d4e5f";
export const DATA_HASH = "3f2a9c0d1e4b5a6978f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a";
export const HOSTILE_NAME = '<script>alert("x")</script> =HYPERLINK("http://evil")';

export function meta(
  reportType: ReportType,
  financial: boolean,
  filters: ReportDocumentMeta["filters"] = { fromDate: "2026-10-01", toDate: "2026-10-31" },
): ReportDocumentMeta {
  return {
    reportId: REPORT_ID,
    reportType,
    title: "عنوان",
    financial,
    filters,
    names: { organizationName: "شركة الطرق الوطنية", workerName: "خالد ناصر", projectName: "مشروع الشارع الرئيسي", siteName: "تقاطع الجامعة" },
    generatedAt: new Date("2026-10-13T08:30:00Z"),
    generatedByName: "دانا المالكة",
    dataHash: DATA_HASH,
  };
}

const approvedEntry: LedgerEntry = {
  timeEntryId: "0192aaaa-0000-7000-8000-000000000001",
  businessDate: "2026-10-12",
  status: "APPROVED",
  checkInMethod: "GEOFENCED",
  isEmergency: false,
  flags: ["OUTSIDE_GEOFENCE_ATTEMPT", "SUSPICIOUS_LOCATION"],
  shift: {
    title: "إغلاق مسار في شارع يافا",
    shiftType: "STANDARD",
    projectName: "مشروع الشارع الرئيسي",
    siteName: "تقاطع الجامعة",
    scheduledStart: "2026-10-12T04:00:00.000Z",
    scheduledEnd: "2026-10-12T13:00:00.000Z",
  },
  clockInAt: "2026-10-12T04:00:00.000Z",
  clockOutAt: "2026-10-12T14:30:00.000Z",
  minutes: { raw: 630, unpaidBreak: 0, worked: 630, regular: 540, overtime: 90, basis: "APPROVED", approvedSplitOutdated: false },
  fullDayCredit: { applied: false, reason: null, byName: null, at: null },
  approvedAt: "2026-10-12T15:00:00.000Z",
  approvedByName: "يوسف المدير",
  rejectedReason: null,
  clockEvents: [
    {
      eventType: "CLOCK_IN",
      origin: "ONLINE",
      deviceTimestamp: "2026-10-12T05:01:58.000Z",
      serverReceivedAt: "2026-10-12T05:02:01.000Z",
      validatedAt: "2026-10-12T04:00:00.000Z",
      deviceTimeDeviationSeconds: 3,
      latitude: 32.0858,
      longitude: 34.7818,
      accuracyMeters: 10,
      distanceFromSiteMeters: 55.6,
      locationValidationStatus: "PASSED",
      mockLocationSuspected: false,
      isManualCorrection: false,
      temporaryPointName: null,
      offlineSyncStatus: null,
    },
    {
      eventType: "CLOCK_OUT",
      origin: "OFFLINE",
      deviceTimestamp: "2026-10-12T14:30:00.000Z",
      serverReceivedAt: "2026-10-12T14:45:00.000Z",
      validatedAt: "2026-10-12T14:30:00.000Z",
      deviceTimeDeviationSeconds: 900,
      latitude: 32.0859,
      longitude: 34.7819,
      accuracyMeters: 12.4,
      distanceFromSiteMeters: 60,
      locationValidationStatus: "FLAGGED",
      mockLocationSuspected: true,
      isManualCorrection: false,
      temporaryPointName: "البوابة الشمالية",
      offlineSyncStatus: "FLAGGED",
    },
  ],
  rejectedAttempts: [
    {
      eventType: "CLOCK_IN",
      origin: "ONLINE",
      code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
      deviceTimestamp: "2026-10-12T04:58:00.000Z",
      serverReceivedAt: "2026-10-12T04:58:01.000Z",
      deviationSeconds: 1,
      latitude: 32.095,
      longitude: 34.7818,
      accuracyMeters: 10,
      mockLocationSuspected: false,
      distanceMeters: 1067.4,
      allowedRadiusMeters: 100,
      requiredAccuracyMeters: null,
      temporaryPointName: null,
    },
    {
      eventType: "CLOCK_IN",
      origin: "ONLINE",
      code: "GPS_ACCURACY_TOO_LOW",
      deviceTimestamp: "2026-10-12T04:59:00.000Z",
      serverReceivedAt: "2026-10-12T04:59:01.000Z",
      deviationSeconds: 1,
      latitude: 32.0858,
      longitude: 34.7818,
      accuracyMeters: 80,
      mockLocationSuspected: false,
      distanceMeters: null,
      allowedRadiusMeters: null,
      requiredAccuracyMeters: 50,
      temporaryPointName: null,
    },
  ],
  corrections: [
    {
      field: "clockInAt",
      oldValue: "2026-10-12T05:02:01.000Z",
      newValue: "2026-10-12T04:00:00.000Z",
      reason: "FORGOTTEN_CLOCK_IN",
      note: "Started on time; the phone was in the car.",
      editedByName: "يوسف المدير",
      createdAt: "2026-10-12T15:00:00.000Z",
      forgottenStamp: {
        infractionId: "0192bbbb-0000-7000-8000-000000000003",
        businessMonth: "2026-10",
        sequence: 3,
        reversedAt: "2026-10-13T07:00:00.000Z",
        reversalReason: "خطأ من المدير",
      },
    },
  ],
  approvals: [{ action: "APPROVE", actedByName: "يوسف المدير", notes: null, createdAt: "2026-10-12T15:00:00.000Z" }],
  dailySummary: {
    text: "أغلقنا المسار ووجّهنا حركة المرور.\nثم ركّبنا اللافتات.",
    taskCategory: "TRAFFIC_CONTROL",
    materialsUsed: "12 مخروطًا",
    problemsEncountered: null,
    followUpRequired: true,
    hasVoiceNote: false,
  },
  emergency: null,
};

const emergencyEntry: LedgerEntry = {
  ...approvedEntry,
  timeEntryId: "0192aaaa-0000-7000-8000-000000000002",
  businessDate: "2026-10-10",
  status: "PENDING_APPROVAL",
  checkInMethod: "FLEXI_CHECK",
  isEmergency: true,
  flags: ["EMERGENCY"],
  shift: { ...approvedEntry.shift, title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT", projectName: null, siteName: null },
  minutes: { raw: 135, unpaidBreak: 0, worked: 135, regular: 135, overtime: 0, basis: "EXPECTED", approvedSplitOutdated: false },
  approvedAt: null,
  approvedByName: null,
  clockEvents: [],
  rejectedAttempts: [],
  corrections: [],
  approvals: [],
  dailySummary: null,
  emergency: {
    authorizationSource: "NIGHT_TURAN_ASSIGNMENT",
    authorizedByName: null,
    actualStartClick: "2026-10-10T00:00:00.000Z",
    actualEndClick: "2026-10-10T01:00:00.000Z",
    compensatedStart: "2026-10-09T23:00:00.000Z",
    compensatedEnd: "2026-10-10T01:15:00.000Z",
    actualWorkedMinutes: 60,
    retroactiveMinutes: 60,
    returnBufferMinutes: 15,
    compensatedDurationMinutes: 135,
  },
};

const totals = {
  entries: 2,
  approvedEntries: 1,
  workedMinutes: 765,
  approvedRegularMinutes: 540,
  approvedOvertimeMinutes: 90,
  rejectedAttempts: 3,
  corrections: 1,
  forgottenStamps: 1,
  emergencies: 1,
};

const unlinkedAttempt = {
  ...approvedEntry.rejectedAttempts[0],
  code: "DEVICE_TIME_DEVIATION_EXCEEDED",
  deviationSeconds: 640,
  businessDate: "2026-10-11",
  shiftTitle: HOSTILE_NAME,
  shiftType: "STANDARD",
  siteName: null,
};

export const ledgerOperational: LedgerOperationalData = { entries: [approvedEntry, emergencyEntry], unlinkedAttempts: [unlinkedAttempt], totals };

export const ledgerFinancial: LedgerFinancialData = {
  entries: [
    {
      ...approvedEntry,
      payStatus: "PAID",
      pay: {
        compensationType: "DAILY",
        standardDayCredited: true,
        regularMinutes: 540,
        overtimeMinutes: 90,
        baseAgorot: 45_000,
        overtimeAgorot: 10_500,
        totalAgorot: 55_500,
      },
      forgottenStampMoney: [{ infractionId: "0192bbbb-0000-7000-8000-000000000003", sequence: 3, deductionAgorot: 1_000, reversalAgorot: 1_000 }],
    },
    { ...emergencyEntry, payStatus: "NOT_APPROVED", pay: null, forgottenStampMoney: [] },
  ],
  unlinkedAttempts: [unlinkedAttempt],
  totals: { ...totals, payAgorot: 55_500, forgottenStampDeductionsAgorot: 1_000, reversalsAgorot: 1_000, netAgorot: 55_500 },
};

export const attendance: OperationalAttendanceData = {
  rows: [
    {
      timeEntryId: approvedEntry.timeEntryId,
      businessDate: "2026-10-12",
      workerProfileId: "0192cccc-0000-7000-8000-000000000001",
      workerName: "خالد ناصر",
      shiftTitle: "إغلاق مسار",
      shiftType: "STANDARD",
      projectName: "مشروع الشارع الرئيسي",
      siteName: "تقاطع الجامعة",
      checkInMethod: "GEOFENCED",
      status: "APPROVED",
      clockInAt: "2026-10-12T04:00:00.000Z",
      clockOutAt: "2026-10-12T14:30:00.000Z",
      rawDurationMinutes: 630,
      workedMinutes: 630,
      approvedRegularMinutes: 540,
      approvedOvertimeMinutes: 90,
      fullDayCredit: false,
      isEmergency: false,
      flags: ["OUTSIDE_GEOFENCE_ATTEMPT"],
    },
    {
      timeEntryId: "0192aaaa-0000-7000-8000-000000000009",
      businessDate: "2026-10-12",
      workerProfileId: "0192cccc-0000-7000-8000-000000000002",
      workerName: HOSTILE_NAME,
      shiftTitle: "Emergency Call-out",
      shiftType: "EMERGENCY_CALLOUT",
      projectName: null,
      siteName: null,
      checkInMethod: "FLEXI_CHECK",
      status: "ACTIVE",
      clockInAt: "2026-10-12T20:00:00.000Z",
      clockOutAt: null,
      rawDurationMinutes: null,
      workedMinutes: null,
      approvedRegularMinutes: null,
      approvedOvertimeMinutes: null,
      fullDayCredit: false,
      isEmergency: true,
      flags: ["EMERGENCY"],
    },
  ],
  summary: {
    entries: 2,
    workers: 2,
    byStatus: [
      { status: "APPROVED", count: 1 },
      { status: "ACTIVE", count: 1 },
    ],
    workedMinutes: 630,
    approvedRegularMinutes: 540,
    approvedOvertimeMinutes: 90,
    flaggedEntries: 2,
    byFlag: [
      { flag: "EMERGENCY", count: 1 },
      { flag: "OUTSIDE_GEOFENCE_ATTEMPT", count: 1 },
    ],
  },
};

const overtimeRow = {
  timeEntryId: approvedEntry.timeEntryId,
  businessDate: "2026-10-12",
  workerProfileId: "0192cccc-0000-7000-8000-000000000001",
  workerName: "خالد ناصر",
  shiftTitle: "إغلاق مسار",
  shiftType: "STANDARD",
  projectName: "مشروع الشارع الرئيسي",
  siteName: "تقاطع الجامعة",
  clockInAt: "2026-10-12T04:00:00.000Z",
  clockOutAt: "2026-10-12T14:30:00.000Z",
  workedMinutes: 630,
  approvedRegularMinutes: 540,
  approvedOvertimeMinutes: 90,
  isEmergency: false,
};

export const overtimeOperational: OvertimeOperationalData = {
  rows: [overtimeRow],
  workers: [{ workerProfileId: overtimeRow.workerProfileId, workerName: "خالد ناصر", entries: 1, overtimeMinutes: 90 }],
  totals: { entries: 1, overtimeMinutes: 90 },
  pending: { entries: 2, expectedOvertimeMinutes: 45 },
};

export const overtimeFinancial: OvertimeFinancialData = {
  rows: [{ ...overtimeRow, compensationType: "DAILY", overtimePayAgorot: 10_500 }],
  workers: [{ workerProfileId: overtimeRow.workerProfileId, workerName: "خالد ناصر", entries: 1, overtimeMinutes: 90, overtimePayAgorot: 10_500 }],
  totals: { entries: 1, overtimeMinutes: 90, overtimePayAgorot: 10_500, entriesWithoutCompensation: 0 },
  pending: { entries: 2, expectedOvertimeMinutes: 45 },
};

const calloutRow = {
  calloutId: "0192dddd-0000-7000-8000-000000000001",
  workerProfileId: "0192cccc-0000-7000-8000-000000000003",
  workerName: "باسل عازر",
  businessDate: "2026-10-10",
  status: "APPROVED",
  authorizationSource: "NIGHT_TURAN_ASSIGNMENT",
  authorizedByName: null,
  turanType: "NIGHT_TURAN",
  actualStartClick: "2026-10-10T00:00:00.000Z",
  actualEndClick: "2026-10-10T01:00:00.000Z",
  compensatedStart: "2026-10-09T23:00:00.000Z",
  compensatedEnd: "2026-10-10T01:15:00.000Z",
  actualWorkedMinutes: 60,
  retroactiveMinutes: 60,
  returnBufferMinutes: 15,
  compensatedDurationMinutes: 135,
  summaryText: "أصلحنا إشارة المرور المعطلة.",
  summaryCategory: "TRAFFIC_LIGHT_REPAIR",
};

export const emergencyOperational: EmergencyOperationalData = { rows: [calloutRow], totals: { callouts: 1, actualWorkedMinutes: 60, compensatedMinutes: 135 } };

export const emergencyFinancial: EmergencyFinancialData = {
  rows: [{ ...calloutRow, costBasis: "APPROVED", costAgorot: 11_250 }],
  totals: { callouts: 1, actualWorkedMinutes: 60, compensatedMinutes: 135, costAgorot: 11_250 },
};

const place = {
  workerName: "خالد ناصر",
  businessDate: "2026-10-12",
  shiftTitle: "إغلاق مسار",
  shiftType: "STANDARD",
  projectName: "مشروع الشارع الرئيسي",
  siteName: "تقاطع الجامعة",
};
const violationAttempt = {
  ...place,
  ...approvedEntry.rejectedAttempts[0],
};

export const siteViolations: SiteViolationsData = {
  attempts: [
    violationAttempt,
    { ...violationAttempt, code: "MOCK_LOCATION_BLOCKED", mockLocationSuspected: true, distanceMeters: null, allowedRadiusMeters: null },
  ],
  suspiciousEvents: [
    {
      ...place,
      eventType: "CLOCK_OUT",
      origin: "OFFLINE",
      serverReceivedAt: "2026-10-12T14:45:00.000Z",
      latitude: 32.0859,
      longitude: 34.7819,
      accuracyMeters: 12,
      mockLocationSuspected: false,
      locationValidationStatus: "FLAGGED",
      distanceFromSiteMeters: 60,
    },
  ],
  mockLocationAttempts: [{ ...violationAttempt, code: "MOCK_LOCATION_BLOCKED", mockLocationSuspected: true, distanceMeters: null, allowedRadiusMeters: null }],
  flexiCheckEntries: [
    {
      ...place,
      status: "PENDING_APPROVAL",
      clockInAt: "2026-10-12T04:00:00.000Z",
      clockOutAt: "2026-10-12T12:00:00.000Z",
      enabledByName: "يوسف المدير",
      reason: "No signal in the tunnel",
      clockInDistanceMeters: 412.2,
    },
  ],
  temporaryPointUses: [
    {
      ...place,
      eventType: "CLOCK_IN",
      serverReceivedAt: "2026-10-12T05:00:00.000Z",
      pointName: "البوابة الشمالية",
      pointRadiusMeters: 100,
      distanceMeters: 12.3,
      accuracyMeters: 8,
    },
  ],
  summary: {
    attempts: 2,
    attemptsByCode: [
      { code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS", count: 1 },
      { code: "MOCK_LOCATION_BLOCKED", count: 1 },
    ],
    suspicious: 2,
    flexiCheckEntries: 1,
    temporaryPointUses: 1,
  },
};

const stampRow = {
  infractionId: "0192bbbb-0000-7000-8000-000000000003",
  businessMonth: "2026-10",
  sequence: 3,
  entryBusinessDate: "2026-10-12",
  correctedField: "clockOutAt",
  correctionReason: "FORGOTTEN_CLOCK_OUT",
  correctionNote: null,
  correctedByName: "يوسف المدير",
  correctedAt: "2026-10-12T15:00:00.000Z",
  reversedAt: "2026-10-13T07:00:00.000Z",
  reversedByName: "دانا المالكة",
  reversalReason: "خطأ من المدير",
};

export const forgottenStampsOperational: ForgottenStampsOperationalData = {
  workers: [
    { workerProfileId: "0192cccc-0000-7000-8000-000000000001", workerName: "خالد ناصر", infractions: [stampRow], counts: { infractions: 1, reversed: 1 } },
  ],
  totals: { workers: 1, infractions: 1, reversed: 1 },
};

export const forgottenStampsFinancial: ForgottenStampsFinancialData = {
  workers: [
    {
      workerProfileId: "0192cccc-0000-7000-8000-000000000001",
      workerName: "خالد ناصر",
      infractions: [{ ...stampRow, deductionAgorot: 1_000, reversalAgorot: 1_000 }],
      counts: { infractions: 1, reversed: 1 },
      money: { deductionsAgorot: 1_000, reversalsAgorot: 1_000, netAgorot: 0 },
    },
  ],
  totals: { workers: 1, infractions: 1, reversed: 1, deductionsAgorot: 1_000, reversalsAgorot: 1_000, netAgorot: 0 },
};

const payrollLine = {
  workerProfileId: "0192cccc-0000-7000-8000-000000000001",
  fullLegalName: "خالد ناصر",
  approvedShifts: 2,
  standardDaysCredited: 2,
  regularMinutes: 1080,
  overtimeMinutes: 90,
  emergencyRetroactiveMinutes: 60,
  emergencyReturnMinutes: 15,
  grossBaseAgorot: 90_000,
  overtimeAgorot: 10_500,
  positiveAdjustmentsAgorot: 0,
  forgottenStampPenaltiesAgorot: 2_000,
  reversalsAgorot: 1_000,
  otherDeductionsAgorot: 0,
  netPayableAgorot: 99_500,
  pendingEntries: 1,
  entriesWithoutCompensation: 0,
};

export const payroll: PayrollReportData = {
  yearMonth: "2026-10",
  version: 2,
  status: "FINALIZED",
  isCurrent: true,
  legacy: false,
  previousVersion: 1,
  createdAt: "2026-10-12T15:00:00.000Z",
  createdByName: "دانا المالكة",
  calculatedAt: "2026-10-12T15:01:00.000Z",
  calculatedByName: "دانا المالكة",
  finalizedAt: "2026-10-12T16:00:00.000Z",
  finalizedByName: "دانا المالكة",
  reopenedAt: "2026-10-12T15:00:00.000Z",
  reopenedByName: "دانا المالكة",
  reopenReason: "تصحيح خصم",
  calculated: true,
  workers: [payrollLine],
  totals: { ...payrollLine, workers: 1 },
  adjustments: [
    {
      workerName: "خالد ناصر",
      type: "FORGOTTEN_STAMP_PENALTY",
      source: "SYSTEM",
      amountAgorot: -1_000,
      reason: null,
      createdByName: "يوسف المدير",
      createdAt: "2026-10-12T15:00:00.000Z",
    },
  ],
  workersWithoutCompensation: [],
  pending: { entries: 1, byWorker: [{ fullLegalName: "خالد ناصر", entries: 1 }] },
  legacyNetByWorker: null,
};
