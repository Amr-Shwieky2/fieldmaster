import { PayrollAdjustmentType, TimeEntryStatus } from "@fieldmaster/shared-types";
import { pickEffectiveCompensationProfile } from "@fieldmaster/shared-validation";
import { toEngineProfile } from "../../payroll/payroll-inputs.service";
import { reportShiftScope } from "../report-scope";
import type { AttendanceRecordsService } from "../../attendance/attendance-records.service";
import type { ReportDataDeps, ReportLoadContext } from "../report.types";

/**
 * The worker attendance ledger (the dispute record): every entry of one
 * worker in the period with its full evidence -- the same evidence the
 * attendance detail page shows (`AttendanceRecordsService.getEvidence`),
 * which carries no money by design -- plus the refused attempts that never
 * led to an entry.
 *
 * `LedgerOperationalData` (a Field Manager's ledger) has no money field at
 * all. `LedgerFinancialData` (an Owner's, or the worker's own) adds each
 * approved entry's pay, computed by `PayrollCalculationService` with the
 * compensation profile in effect on the entry's date (the payroll engine's
 * own rule), and what each forgotten stamp deducted or gave back.
 */

type Evidence = Awaited<ReturnType<AttendanceRecordsService["getEvidence"]>>;

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

export interface LedgerClockEvent {
  eventType: string;
  origin: string;
  deviceTimestamp: string;
  serverReceivedAt: string;
  /** The entry's validated time for this event (after any correction). */
  validatedAt: string | null;
  deviceTimeDeviationSeconds: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  distanceFromSiteMeters: number | null;
  locationValidationStatus: string;
  mockLocationSuspected: boolean;
  isManualCorrection: boolean;
  temporaryPointName: string | null;
  offlineSyncStatus: string | null;
}

export interface LedgerRejectedAttempt {
  eventType: string;
  origin: string;
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
  temporaryPointName: string | null;
}

export interface LedgerForgottenStamp {
  infractionId: string;
  businessMonth: string;
  sequence: number;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface LedgerCorrection {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  note: string | null;
  editedByName: string | null;
  createdAt: string;
  forgottenStamp: LedgerForgottenStamp | null;
}

export interface LedgerApproval {
  action: string;
  actedByName: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LedgerEmergency {
  authorizationSource: string;
  authorizedByName: string | null;
  actualStartClick: string;
  actualEndClick: string | null;
  compensatedStart: string;
  compensatedEnd: string | null;
  actualWorkedMinutes: number | null;
  retroactiveMinutes: number;
  returnBufferMinutes: number | null;
  compensatedDurationMinutes: number | null;
}

export interface LedgerEntry {
  timeEntryId: string;
  businessDate: string;
  status: string;
  checkInMethod: string;
  isEmergency: boolean;
  flags: string[];
  shift: { title: string; shiftType: string; projectName: string | null; siteName: string | null; scheduledStart: string; scheduledEnd: string };
  clockInAt: string | null;
  clockOutAt: string | null;
  minutes: {
    raw: number | null;
    unpaidBreak: number;
    worked: number | null;
    regular: number | null;
    overtime: number | null;
    /** APPROVED (what payroll uses), EXPECTED (the split approval would store) or OPEN. */
    basis: string;
    approvedSplitOutdated: boolean;
  };
  fullDayCredit: { applied: boolean; reason: string | null; byName: string | null; at: string | null };
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedReason: string | null;
  clockEvents: LedgerClockEvent[];
  rejectedAttempts: LedgerRejectedAttempt[];
  corrections: LedgerCorrection[];
  approvals: LedgerApproval[];
  dailySummary: {
    text: string | null;
    taskCategory: string;
    materialsUsed: string | null;
    problemsEncountered: string | null;
    followUpRequired: boolean;
    hasVoiceNote: boolean;
  } | null;
  emergency: LedgerEmergency | null;
}

/** A refused attempt at a shift for which the worker never got an entry. */
export interface LedgerUnlinkedAttempt extends LedgerRejectedAttempt {
  businessDate: string;
  shiftTitle: string;
  shiftType: string;
  siteName: string | null;
}

export interface LedgerOperationalTotals {
  entries: number;
  approvedEntries: number;
  workedMinutes: number;
  approvedRegularMinutes: number;
  approvedOvertimeMinutes: number;
  rejectedAttempts: number;
  corrections: number;
  forgottenStamps: number;
  emergencies: number;
}

export interface LedgerOperationalData {
  entries: LedgerEntry[];
  unlinkedAttempts: LedgerUnlinkedAttempt[];
  totals: LedgerOperationalTotals;
}

// ── Financial version ─────────────────────────────────────────────────────

export const LedgerPayStatus = {
  PAID: "PAID",
  /** Pay is computed for approved entries only, as payroll does. */
  NOT_APPROVED: "NOT_APPROVED",
  NO_COMPENSATION_PROFILE: "NO_COMPENSATION_PROFILE",
} as const;
export type LedgerPayStatus = (typeof LedgerPayStatus)[keyof typeof LedgerPayStatus];

export interface LedgerEntryPay {
  compensationType: string;
  standardDayCredited: boolean;
  regularMinutes: number;
  overtimeMinutes: number;
  baseAgorot: number;
  overtimeAgorot: number;
  totalAgorot: number;
}

export interface LedgerStampMoney {
  infractionId: string;
  sequence: number;
  /** Positive: what the penalty took. */
  deductionAgorot: number;
  /** Positive: what its reversal gave back. */
  reversalAgorot: number;
}

export interface LedgerFinancialEntry extends LedgerEntry {
  payStatus: LedgerPayStatus;
  pay: LedgerEntryPay | null;
  forgottenStampMoney: LedgerStampMoney[];
}

export interface LedgerFinancialData {
  entries: LedgerFinancialEntry[];
  unlinkedAttempts: LedgerUnlinkedAttempt[];
  totals: LedgerOperationalTotals & {
    payAgorot: number;
    forgottenStampDeductionsAgorot: number;
    reversalsAgorot: number;
    netAgorot: number;
  };
}

// ── Loading ───────────────────────────────────────────────────────────────

/** A stored refused attempt (on the evidence page, or not linked to any entry). */
interface AttemptRow {
  eventType: string;
  origin: string;
  code: string;
  deviceTimestamp: Date;
  serverReceivedAt: Date;
  deviationSeconds: number | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationSuspected: boolean;
  distanceMeters: number | null;
  allowedRadiusMeters: number | null;
  requiredAccuracyMeters: number | null;
  temporaryCheckInPoint: { name: string } | null;
}

function rejectedAttempt(attempt: AttemptRow): LedgerRejectedAttempt {
  return {
    eventType: attempt.eventType,
    origin: attempt.origin,
    code: attempt.code,
    deviceTimestamp: attempt.deviceTimestamp.toISOString(),
    serverReceivedAt: attempt.serverReceivedAt.toISOString(),
    deviationSeconds: attempt.deviationSeconds,
    latitude: attempt.latitude,
    longitude: attempt.longitude,
    accuracyMeters: attempt.accuracyMeters,
    mockLocationSuspected: attempt.mockLocationSuspected,
    distanceMeters: attempt.distanceMeters,
    allowedRadiusMeters: attempt.allowedRadiusMeters,
    requiredAccuracyMeters: attempt.requiredAccuracyMeters,
    temporaryPointName: attempt.temporaryCheckInPoint?.name ?? null,
  };
}

function ledgerEntry(evidence: Evidence): LedgerEntry {
  return {
    timeEntryId: evidence.id,
    businessDate: evidence.businessDate,
    status: evidence.status,
    checkInMethod: evidence.checkInMethod,
    isEmergency: evidence.isEmergency,
    flags: [...evidence.flags],
    shift: {
      title: evidence.shift.title,
      shiftType: evidence.shift.shiftType,
      projectName: evidence.shift.project?.name ?? null,
      siteName: evidence.shift.site?.name ?? null,
      scheduledStart: evidence.shift.scheduledStart.toISOString(),
      scheduledEnd: evidence.shift.scheduledEnd.toISOString(),
    },
    clockInAt: iso(evidence.clockInAt),
    clockOutAt: iso(evidence.clockOutAt),
    minutes: {
      raw: evidence.duration.rawDurationMinutes,
      unpaidBreak: evidence.duration.unpaidBreakMinutes,
      worked: evidence.duration.workedMinutes,
      regular: evidence.duration.regularMinutes,
      overtime: evidence.duration.overtimeMinutes,
      basis: evidence.duration.basis,
      approvedSplitOutdated: evidence.duration.approvedSplitOutdated,
    },
    fullDayCredit: {
      applied: evidence.fullDayCredit.applied,
      reason: evidence.fullDayCredit.reason,
      byName: evidence.fullDayCredit.appliedByName,
      at: iso(evidence.fullDayCredit.appliedAt),
    },
    approvedAt: iso(evidence.approvedAt),
    approvedByName: evidence.approvedByName,
    rejectedReason: evidence.rejectedReason,
    clockEvents: evidence.clockEvents.map((event) => ({
      eventType: event.eventType,
      origin: event.origin,
      deviceTimestamp: event.deviceTimestamp.toISOString(),
      serverReceivedAt: event.serverReceivedAt.toISOString(),
      validatedAt: iso(event.validatedAt),
      deviceTimeDeviationSeconds: event.deviceTimeDeviationSeconds,
      latitude: event.latitude,
      longitude: event.longitude,
      accuracyMeters: event.accuracyMeters,
      distanceFromSiteMeters: event.distanceFromSiteMeters,
      locationValidationStatus: event.locationValidationStatus,
      mockLocationSuspected: event.mockLocationSuspected,
      isManualCorrection: event.isManualCorrection,
      temporaryPointName: event.temporaryCheckInPoint?.name ?? null,
      offlineSyncStatus: event.offlineSync?.status ?? null,
    })),
    rejectedAttempts: evidence.rejectedAttempts.map(rejectedAttempt),
    corrections: evidence.history.corrections.map((correction) => ({
      field: correction.field,
      oldValue: correction.oldValue,
      newValue: correction.newValue,
      reason: correction.reason,
      note: correction.note,
      editedByName: correction.editedByName,
      createdAt: correction.createdAt.toISOString(),
      forgottenStamp: correction.infraction
        ? {
            infractionId: correction.infraction.id,
            businessMonth: correction.infraction.businessMonth,
            sequence: correction.infraction.monthlySequenceNumber,
            reversedAt: iso(correction.infraction.reversedAt),
            reversalReason: correction.infraction.reversalReason,
          }
        : null,
    })),
    approvals: evidence.history.approvals.map((approval) => ({
      action: approval.action,
      actedByName: approval.actedByName,
      notes: approval.notes,
      createdAt: approval.createdAt.toISOString(),
    })),
    dailySummary: evidence.dailySummary
      ? {
          text: evidence.dailySummary.text,
          taskCategory: evidence.dailySummary.taskCategory,
          materialsUsed: evidence.dailySummary.materialsUsed,
          problemsEncountered: evidence.dailySummary.problemsEncountered,
          followUpRequired: evidence.dailySummary.followUpRequired,
          hasVoiceNote: evidence.dailySummary.voiceNoteUrl !== null,
        }
      : null,
    emergency: evidence.emergency
      ? {
          authorizationSource: evidence.emergency.authorizationSource,
          authorizedByName: evidence.emergency.authorizedByName,
          actualStartClick: evidence.emergency.actualStartClick.toISOString(),
          actualEndClick: iso(evidence.emergency.actualEndClick),
          compensatedStart: evidence.emergency.compensatedStart.toISOString(),
          compensatedEnd: iso(evidence.emergency.compensatedEnd),
          actualWorkedMinutes: evidence.emergency.actualWorkedMinutes,
          retroactiveMinutes: evidence.emergency.retroactiveMinutes,
          returnBufferMinutes: evidence.emergency.returnBufferMinutes,
          compensatedDurationMinutes: evidence.emergency.compensatedDurationMinutes,
        }
      : null,
  };
}

function operationalTotals(entries: readonly LedgerEntry[], unlinkedAttempts: number): LedgerOperationalTotals {
  const approved = entries.filter((entry) => entry.status === TimeEntryStatus.APPROVED);
  return {
    entries: entries.length,
    approvedEntries: approved.length,
    workedMinutes: entries.reduce((sum, entry) => sum + (entry.minutes.worked ?? 0), 0),
    approvedRegularMinutes: approved.reduce((sum, entry) => sum + (entry.minutes.regular ?? 0), 0),
    approvedOvertimeMinutes: approved.reduce((sum, entry) => sum + (entry.minutes.overtime ?? 0), 0),
    rejectedAttempts: unlinkedAttempts + entries.reduce((sum, entry) => sum + entry.rejectedAttempts.length, 0),
    corrections: entries.reduce((sum, entry) => sum + entry.corrections.length, 0),
    forgottenStamps: entries.reduce((sum, entry) => sum + entry.corrections.filter((correction) => correction.forgottenStamp !== null).length, 0),
    emergencies: entries.filter((entry) => entry.isEmergency).length,
  };
}

export async function loadLedgerOperational(deps: ReportDataDeps, context: ReportLoadContext): Promise<LedgerOperationalData> {
  const { organizationId, filters } = context;
  const workerProfileId = filters.workerProfileId as string;
  const businessDate = { gte: filters.fromDate, lte: filters.toDate };

  const scoped = reportShiftScope(filters);
  const rows = await deps.prisma.timeEntry.findMany({
    where: { organizationId, workerProfileId, businessDate, ...(scoped ? { shift: scoped } : {}) },
    select: { id: true },
    orderBy: [{ businessDate: "asc" }, { clockInAt: "asc" }, { id: "asc" }],
  });
  const entries: LedgerEntry[] = [];
  // One entry at a time (a background job; the database is shared with live traffic).
  for (const row of rows) entries.push(ledgerEntry(await deps.attendanceRecords.getEvidence(organizationId, row.id)));

  const unlinked = await deps.prisma.rejectedClockAttempt.findMany({
    where: { organizationId, workerProfileId, timeEntryId: null, shift: { businessDate, ...(scoped ? { AND: [scoped] } : {}) } },
    select: {
      eventType: true,
      origin: true,
      code: true,
      deviceTimestamp: true,
      serverReceivedAt: true,
      deviationSeconds: true,
      latitude: true,
      longitude: true,
      accuracyMeters: true,
      mockLocationSuspected: true,
      distanceMeters: true,
      allowedRadiusMeters: true,
      requiredAccuracyMeters: true,
      temporaryCheckInPoint: { select: { name: true } },
      shift: { select: { businessDate: true, title: true, shiftType: true, site: { select: { name: true } } } },
    },
    orderBy: [{ serverReceivedAt: "asc" }, { id: "asc" }],
  });
  const unlinkedAttempts = unlinked.map((attempt) => ({
    ...rejectedAttempt(attempt),
    businessDate: attempt.shift.businessDate,
    shiftTitle: attempt.shift.title,
    shiftType: attempt.shift.shiftType,
    siteName: attempt.shift.site?.name ?? null,
  }));

  return { entries, unlinkedAttempts, totals: operationalTotals(entries, unlinkedAttempts.length) };
}

export async function loadLedgerFinancial(deps: ReportDataDeps, context: ReportLoadContext): Promise<LedgerFinancialData> {
  const operational = await loadLedgerOperational(deps, context);
  const workerProfileId = context.filters.workerProfileId as string;

  const profiles = await deps.prisma.compensationProfile.findMany({ where: { workerProfileId }, orderBy: [{ effectiveStartDate: "asc" }, { id: "asc" }] });
  const engineProfiles = profiles.map(toEngineProfile);
  const infractionIds = operational.entries.flatMap((entry) =>
    entry.corrections.flatMap((correction) => (correction.forgottenStamp ? [correction.forgottenStamp.infractionId] : [])),
  );
  const adjustments =
    infractionIds.length > 0
      ? await deps.prisma.payrollAdjustment.findMany({
          where: { organizationId: context.organizationId, relatedInfractionId: { in: infractionIds } },
          select: { relatedInfractionId: true, type: true, amountAgorot: true },
        })
      : [];
  const sumOf = (infractionId: string, type: string) =>
    adjustments
      .filter((adjustment) => adjustment.relatedInfractionId === infractionId && adjustment.type === type)
      .reduce((sum, adjustment) => sum + adjustment.amountAgorot, 0);

  const rules = await deps.workRules.resolver(context.organizationId);
  const entries = operational.entries.map((entry): LedgerFinancialEntry => {
    let payStatus: LedgerPayStatus = LedgerPayStatus.NOT_APPROVED;
    let pay: LedgerEntryPay | null = null;
    if (entry.status === TimeEntryStatus.APPROVED) {
      const effective = pickEffectiveCompensationProfile(engineProfiles, workerProfileId, entry.businessDate);
      const profile = effective ? (profiles.find((candidate) => candidate.id === effective.id) ?? null) : null;
      if (!profile) {
        payStatus = LedgerPayStatus.NO_COMPENSATION_PROFILE;
      } else {
        const result = deps.payrollCalculation.computeEntryCompensation(
          { approvedRegularMinutes: entry.minutes.regular, approvedOvertimeMinutes: entry.minutes.overtime, fullDayCredit: entry.fullDayCredit.applied },
          profile,
          rules.rulesFor(entry.businessDate),
        );
        payStatus = LedgerPayStatus.PAID;
        pay = {
          compensationType: profile.compensationType,
          standardDayCredited: result.standardDayCredited,
          regularMinutes: result.regularMinutes,
          overtimeMinutes: result.overtimeMinutes,
          baseAgorot: result.baseAgorot,
          overtimeAgorot: result.overtimeAgorot,
          totalAgorot: result.baseAgorot + result.overtimeAgorot,
        };
      }
    }
    const forgottenStampMoney = entry.corrections.flatMap((correction) =>
      correction.forgottenStamp
        ? [
            {
              infractionId: correction.forgottenStamp.infractionId,
              sequence: correction.forgottenStamp.sequence,
              deductionAgorot: -sumOf(correction.forgottenStamp.infractionId, PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY),
              reversalAgorot: sumOf(correction.forgottenStamp.infractionId, PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL),
            },
          ]
        : [],
    );
    return { ...entry, payStatus, pay, forgottenStampMoney };
  });

  const payAgorot = entries.reduce((sum, entry) => sum + (entry.pay?.totalAgorot ?? 0), 0);
  const stamps = entries.flatMap((entry) => entry.forgottenStampMoney);
  const forgottenStampDeductionsAgorot = stamps.reduce((sum, stamp) => sum + stamp.deductionAgorot, 0);
  const reversalsAgorot = stamps.reduce((sum, stamp) => sum + stamp.reversalAgorot, 0);
  return {
    entries,
    unlinkedAttempts: operational.unlinkedAttempts,
    totals: {
      ...operational.totals,
      payAgorot,
      forgottenStampDeductionsAgorot,
      reversalsAgorot,
      netAgorot: payAgorot - forgottenStampDeductionsAgorot + reversalsAgorot,
    },
  };
}
