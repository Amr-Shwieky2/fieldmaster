import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  AttendanceFlag,
  AttendanceListTab,
  CheckInMethod,
  ClockEventType,
  EventOrigin,
  LocationValidationStatus,
  PayrollPeriodStatus,
  STANDARD_DAY_MINUTES,
  TimeEntryStatus,
} from "@fieldmaster/shared-types";
import { splitWorkedMinutes } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN, paginate } from "../../common/validation/patterns";
import type { ListAttendanceQueryDto } from "./dto/attendance-list.dto";

/**
 * Read models of the admin attendance screens (Step 5): the paginated list
 * and the evidence of one time entry. Neither carries any money -- the same
 * response goes to Owners and Field Managers, and an Owner's cost estimate
 * comes from the separate, Owner-only `GET /time-entries/:id/estimated-cost`.
 * Every field is selected explicitly (no Prisma row is returned as is), so a
 * column added later never reaches these screens by accident.
 */

const TAB_STATUSES: Record<AttendanceListTab, TimeEntryStatus[] | null> = {
  [AttendanceListTab.PENDING]: [TimeEntryStatus.PENDING_APPROVAL, TimeEntryStatus.CORRECTION_REQUESTED],
  [AttendanceListTab.APPROVED]: [TimeEntryStatus.APPROVED],
  [AttendanceListTab.REJECTED]: [TimeEntryStatus.REJECTED],
  [AttendanceListTab.ALL]: null,
};

const LIST_SELECT = {
  id: true,
  status: true,
  businessDate: true,
  clockInAt: true,
  clockOutAt: true,
  rawDurationMinutes: true,
  unpaidBreakMinutes: true,
  approvedRegularMinutes: true,
  approvedOvertimeMinutes: true,
  fullDayCredit: true,
  isEmergency: true,
  devRewoundAt: true,
  checkInMethod: true,
  worker: { select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } } },
  shift: {
    select: { id: true, title: true, shiftType: true, project: { select: { id: true, name: true } }, site: { select: { id: true, name: true } } },
  },
  dailySummary: { select: { text: true, taskCategory: true } },
  clockEvents: { select: { origin: true, locationValidationStatus: true, mockLocationSuspected: true, temporaryCheckInPointId: true } },
  rejectedClockAttempts: { select: { code: true } },
} satisfies Prisma.TimeEntrySelect;

type ListRow = Prisma.TimeEntryGetPayload<{ select: typeof LIST_SELECT }>;

/**
 * Each flag's database filter and its test on a loaded row, side by side so
 * the list's badges and its flag filters can never disagree.
 */
const FLAG_RULES: Record<AttendanceFlag, { where: Prisma.TimeEntryWhereInput; test: (row: ListRow) => boolean }> = {
  [AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT]: {
    where: { rejectedClockAttempts: { some: { code: ErrorCodes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS } } },
    test: (row) => row.rejectedClockAttempts.some((attempt) => attempt.code === ErrorCodes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS),
  },
  [AttendanceFlag.SUSPICIOUS_LOCATION]: {
    where: {
      OR: [
        { clockEvents: { some: { OR: [{ locationValidationStatus: LocationValidationStatus.FLAGGED }, { mockLocationSuspected: true }] } } },
        { rejectedClockAttempts: { some: { code: ErrorCodes.MOCK_LOCATION_BLOCKED } } },
      ],
    },
    test: (row) =>
      row.clockEvents.some((event) => event.locationValidationStatus === LocationValidationStatus.FLAGGED || event.mockLocationSuspected) ||
      row.rejectedClockAttempts.some((attempt) => attempt.code === ErrorCodes.MOCK_LOCATION_BLOCKED),
  },
  [AttendanceFlag.OFFLINE]: {
    where: { clockEvents: { some: { origin: EventOrigin.OFFLINE } } },
    test: (row) => row.clockEvents.some((event) => event.origin === EventOrigin.OFFLINE),
  },
  [AttendanceFlag.FLEXI_CHECK]: {
    // An emergency call-out is technically Flexi-Check too; it has its own flag.
    where: { checkInMethod: CheckInMethod.FLEXI_CHECK, isEmergency: false },
    test: (row) => row.checkInMethod === CheckInMethod.FLEXI_CHECK && !row.isEmergency,
  },
  [AttendanceFlag.TEMPORARY_POINT]: {
    where: { clockEvents: { some: { temporaryCheckInPointId: { not: null } } } },
    test: (row) => row.clockEvents.some((event) => event.temporaryCheckInPointId !== null),
  },
  [AttendanceFlag.EMERGENCY]: {
    where: { isEmergency: true },
    test: (row) => row.isEmergency,
  },
  [AttendanceFlag.DEV_REWOUND]: {
    where: { devRewoundAt: { not: null } },
    test: (row) => row.devRewoundAt !== null,
  },
};

const TEMPORARY_POINT_SELECT = {
  id: true,
  name: true,
  latitude: true,
  longitude: true,
  radiusMeters: true,
  status: true,
  expiresAt: true,
} satisfies Prisma.TemporaryCheckInPointSelect;

const EVIDENCE_SELECT = {
  id: true,
  status: true,
  businessDate: true,
  clockInAt: true,
  clockOutAt: true,
  checkInMethod: true,
  rawDurationMinutes: true,
  unpaidBreakMinutes: true,
  approvedRegularMinutes: true,
  approvedOvertimeMinutes: true,
  fullDayCredit: true,
  fullDayCreditReason: true,
  fullDayCreditBy: true,
  fullDayCreditAt: true,
  isEmergency: true,
  devRewoundAt: true,
  approvedBy: true,
  approvedAt: true,
  rejectedReason: true,
  createdAt: true,
  worker: { select: { id: true, membership: { select: { user: { select: { fullLegalName: true, phoneNumber: true } } } } } },
  shift: {
    select: {
      id: true,
      title: true,
      shiftType: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      checkInMethod: true,
      // Never the project budget (Owner-only money): an explicit allowlist.
      project: { select: { id: true, name: true, client: true, projectCode: true } },
      site: { select: { id: true, name: true, address: true, latitude: true, longitude: true, defaultGeofenceRadiusMeters: true } },
      geofence: { select: { id: true, centerLatitude: true, centerLongitude: true, radiusMeters: true, minAccuracyMeters: true } },
    },
  },
  clockEvents: {
    select: {
      id: true,
      eventType: true,
      origin: true,
      deviceId: true,
      deviceTimestamp: true,
      serverReceivedAt: true,
      deviceTimeDeviationSeconds: true,
      latitude: true,
      longitude: true,
      accuracyMeters: true,
      mockLocationSuspected: true,
      distanceFromSiteMeters: true,
      locationValidationStatus: true,
      isManualCorrection: true,
      appVersion: true,
      temporaryCheckInPoint: { select: TEMPORARY_POINT_SELECT },
    },
    orderBy: { serverReceivedAt: "asc" },
  },
  rejectedClockAttempts: {
    select: {
      id: true,
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
      temporaryCheckInPoint: { select: TEMPORARY_POINT_SELECT },
    },
    orderBy: { serverReceivedAt: "asc" },
  },
  dailySummary: {
    select: { text: true, voiceNoteUrl: true, taskCategory: true, materialsUsed: true, problemsEncountered: true, followUpRequired: true, createdAt: true },
  },
  approvals: { select: { id: true, action: true, actedBy: true, notes: true, createdAt: true }, orderBy: { createdAt: "asc" } },
  corrections: {
    select: {
      id: true,
      field: true,
      oldValue: true,
      newValue: true,
      reason: true,
      note: true,
      editedBy: true,
      createdAt: true,
      // Never the deduction (Owner-only money): the sequence is what both roles see.
      forgottenStampInfraction: { select: { id: true, businessMonth: true, monthlySequenceNumber: true, reversedAt: true, reversalReason: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  emergencyCallout: {
    select: {
      id: true,
      authorizationSource: true,
      authorizedBy: true,
      turanAssignmentId: true,
      actualStartClick: true,
      compensatedStart: true,
      actualEndClick: true,
      compensatedEnd: true,
      actualWorkedMinutes: true,
      retroactiveMinutes: true,
      returnBufferMinutes: true,
      compensatedDurationMinutes: true,
      startLatitude: true,
      startLongitude: true,
      endLatitude: true,
      endLongitude: true,
    },
  },
} satisfies Prisma.TimeEntrySelect;

/** How the minutes on the evidence page were obtained. */
export const DurationBasis = {
  /** The split a manager approved (what payroll uses). */
  APPROVED: "APPROVED",
  /** The split approval would store now (shared `splitWorkedMinutes`). */
  EXPECTED: "EXPECTED",
  /** No clock-out yet. */
  OPEN: "OPEN",
} as const;

@Injectable()
export class AttendanceRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListAttendanceQueryDto) {
    const tab = query.tab ?? AttendanceListTab.PENDING;
    const { page, pageSize, skip, take } = paginate(query.page, query.pageSize);

    const shiftFilter: Prisma.ShiftWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.shiftType ? { shiftType: query.shiftType } : {}),
    };
    const base: Prisma.TimeEntryWhereInput = {
      organizationId,
      ...(query.workerProfileId ? { workerProfileId: query.workerProfileId } : {}),
      ...(query.from || query.to ? { businessDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      ...(Object.keys(shiftFilter).length > 0 ? { shift: shiftFilter } : {}),
      ...(query.flags && query.flags.length > 0 ? { AND: query.flags.map((flag) => FLAG_RULES[flag].where) } : {}),
    };
    const whereFor = (forTab: AttendanceListTab): Prisma.TimeEntryWhereInput => {
      const statuses = TAB_STATUSES[forTab];
      return statuses ? { ...base, status: { in: statuses } } : base;
    };
    // Waiting entries oldest first, like an approval queue; history newest first.
    const orderBy: Prisma.TimeEntryOrderByWithRelationInput[] =
      tab === AttendanceListTab.PENDING
        ? [{ businessDate: "asc" }, { clockOutAt: "asc" }, { id: "asc" }]
        : [{ businessDate: "desc" }, { clockInAt: "desc" }, { id: "desc" }];

    const [rows, pending, approved, rejected, all] = await this.prisma.$transaction([
      this.prisma.timeEntry.findMany({ where: whereFor(tab), select: LIST_SELECT, orderBy, skip, take }),
      this.prisma.timeEntry.count({ where: whereFor(AttendanceListTab.PENDING) }),
      this.prisma.timeEntry.count({ where: whereFor(AttendanceListTab.APPROVED) }),
      this.prisma.timeEntry.count({ where: whereFor(AttendanceListTab.REJECTED) }),
      this.prisma.timeEntry.count({ where: whereFor(AttendanceListTab.ALL) }),
    ]);
    const tabCounts: Record<AttendanceListTab, number> = { PENDING: pending, APPROVED: approved, REJECTED: rejected, ALL: all };

    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        businessDate: row.businessDate,
        clockInAt: row.clockInAt,
        clockOutAt: row.clockOutAt,
        rawDurationMinutes: row.rawDurationMinutes,
        unpaidBreakMinutes: row.unpaidBreakMinutes,
        approvedRegularMinutes: row.approvedRegularMinutes,
        approvedOvertimeMinutes: row.approvedOvertimeMinutes,
        fullDayCredit: row.fullDayCredit,
        isEmergency: row.isEmergency,
        devRewoundAt: row.devRewoundAt,
        checkInMethod: row.checkInMethod,
        worker: { id: row.worker.id, fullLegalName: row.worker.membership.user.fullLegalName },
        shift: { id: row.shift.id, title: row.shift.title, shiftType: row.shift.shiftType, project: row.shift.project, site: row.shift.site },
        dailySummary: row.dailySummary,
        flags: (Object.keys(FLAG_RULES) as AttendanceFlag[]).filter((flag) => FLAG_RULES[flag].test(row)),
      })),
      page,
      pageSize,
      total: tabCounts[tab],
      tabCounts,
    };
  }

  async getEvidence(organizationId: string, id: string) {
    const entry = UUID_PATTERN.test(id) ? await this.prisma.timeEntry.findFirst({ where: { id, organizationId }, select: EVIDENCE_SELECT }) : null;
    if (!entry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");

    const offlineEventIds = entry.clockEvents.filter((event) => event.origin === EventOrigin.OFFLINE).map((event) => event.id);
    const [syncEvents, auditEvents, period] = await Promise.all([
      offlineEventIds.length > 0
        ? this.prisma.offlineSyncEvent.findMany({
            where: { resultClockEventId: { in: offlineEventIds } },
            select: { resultClockEventId: true, status: true, processedAt: true, offlineEventAgeSeconds: true, batchId: true },
            orderBy: { processedAt: "asc" },
          })
        : Promise.resolve([]),
      // The entry's own events (and its call-out's). Forgotten-stamp infraction events are left out on
      // purpose: their newValue is the deduction, which only an Owner may see.
      this.prisma.auditLog.findMany({
        where: {
          organizationId,
          OR: [
            { entityType: "TimeEntry", entityId: entry.id },
            ...(entry.emergencyCallout ? [{ entityType: "EmergencyCallout", entityId: entry.emergencyCallout.id }] : []),
          ],
        },
        select: {
          id: true,
          action: true,
          entityType: true,
          field: true,
          oldValue: true,
          newValue: true,
          reason: true,
          note: true,
          createdAt: true,
          actor: { select: { fullLegalName: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.payrollPeriod.findFirst({
        where: { organizationId, yearMonth: entry.businessDate.slice(0, 7) },
        orderBy: { version: "desc" },
        select: { status: true },
      }),
    ]);

    const userIds = [
      entry.approvedBy,
      entry.fullDayCreditBy,
      entry.emergencyCallout?.authorizedBy,
      ...entry.approvals.map((approval) => approval.actedBy),
      ...entry.corrections.map((correction) => correction.editedBy),
    ].filter((userId): userId is string => typeof userId === "string");
    const users =
      userIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, fullLegalName: true } }) : [];
    const nameOf = (userId: string | null | undefined) => (userId ? (users.find((user) => user.id === userId)?.fullLegalName ?? null) : null);

    const periodFinalized = period?.status === PayrollPeriodStatus.FINALIZED;
    const hasEnded = entry.clockOutAt !== null && entry.rawDurationMinutes !== null;
    const split = hasEnded
      ? splitWorkedMinutes({ rawDurationMinutes: entry.rawDurationMinutes!, unpaidBreakMinutes: entry.unpaidBreakMinutes, fullDayCredit: entry.fullDayCredit })
      : null;
    const isApproved = entry.status === TimeEntryStatus.APPROVED;
    const awaitingApproval = entry.status === TimeEntryStatus.PENDING_APPROVAL || entry.status === TimeEntryStatus.CORRECTION_REQUESTED;
    const fullDayCreditEligible = hasEnded && entry.rawDurationMinutes! < STANDARD_DAY_MINUTES && !entry.fullDayCredit;

    // The same flag tests as the list, on the same facts.
    const flagFacts = {
      checkInMethod: entry.checkInMethod,
      isEmergency: entry.isEmergency,
      devRewoundAt: entry.devRewoundAt,
      clockEvents: entry.clockEvents.map((event) => ({ ...event, temporaryCheckInPointId: event.temporaryCheckInPoint?.id ?? null })),
      rejectedClockAttempts: entry.rejectedClockAttempts,
    } as unknown as ListRow;

    return {
      id: entry.id,
      status: entry.status,
      businessDate: entry.businessDate,
      flags: (Object.keys(FLAG_RULES) as AttendanceFlag[]).filter((flag) => FLAG_RULES[flag].test(flagFacts)),
      checkInMethod: entry.checkInMethod,
      isEmergency: entry.isEmergency,
      devRewoundAt: entry.devRewoundAt,
      createdAt: entry.createdAt,
      /** The validated times (after corrections); the clock events below keep what the phone and the server recorded. */
      clockInAt: entry.clockInAt,
      clockOutAt: entry.clockOutAt,
      rejectedReason: entry.rejectedReason,
      approvedAt: entry.approvedAt,
      approvedByName: nameOf(entry.approvedBy),
      periodFinalized,
      worker: {
        id: entry.worker.id,
        fullLegalName: entry.worker.membership.user.fullLegalName,
        phoneNumber: entry.worker.membership.user.phoneNumber,
      },
      shift: entry.shift,
      duration: {
        rawDurationMinutes: entry.rawDurationMinutes,
        unpaidBreakMinutes: entry.unpaidBreakMinutes,
        workedMinutes: split?.workedMinutes ?? null,
        regularMinutes: isApproved ? entry.approvedRegularMinutes : (split?.regularMinutes ?? null),
        overtimeMinutes: isApproved ? entry.approvedOvertimeMinutes : (split?.overtimeMinutes ?? null),
        basis: isApproved ? DurationBasis.APPROVED : hasEnded ? DurationBasis.EXPECTED : DurationBasis.OPEN,
        /** Approved before a later correction changed the times: the approved split no longer matches them. */
        approvedSplitOutdated:
          isApproved && split !== null && (split.regularMinutes !== entry.approvedRegularMinutes || split.overtimeMinutes !== entry.approvedOvertimeMinutes),
      },
      fullDayCredit: {
        applied: entry.fullDayCredit,
        reason: entry.fullDayCreditReason,
        appliedByName: nameOf(entry.fullDayCreditBy),
        appliedAt: entry.fullDayCreditAt,
        eligible: fullDayCreditEligible,
      },
      emergency: entry.emergencyCallout
        ? {
            id: entry.emergencyCallout.id,
            authorizationSource: entry.emergencyCallout.authorizationSource,
            authorizedByName: nameOf(entry.emergencyCallout.authorizedBy),
            turanAssignmentId: entry.emergencyCallout.turanAssignmentId,
            actualStartClick: entry.emergencyCallout.actualStartClick,
            compensatedStart: entry.emergencyCallout.compensatedStart,
            actualEndClick: entry.emergencyCallout.actualEndClick,
            compensatedEnd: entry.emergencyCallout.compensatedEnd,
            actualWorkedMinutes: entry.emergencyCallout.actualWorkedMinutes,
            retroactiveMinutes: entry.emergencyCallout.retroactiveMinutes,
            returnBufferMinutes: entry.emergencyCallout.returnBufferMinutes,
            compensatedDurationMinutes: entry.emergencyCallout.compensatedDurationMinutes,
            start: { latitude: entry.emergencyCallout.startLatitude, longitude: entry.emergencyCallout.startLongitude },
            end:
              entry.emergencyCallout.endLatitude !== null && entry.emergencyCallout.endLongitude !== null
                ? { latitude: entry.emergencyCallout.endLatitude, longitude: entry.emergencyCallout.endLongitude }
                : null,
          }
        : null,
      clockEvents: entry.clockEvents.map((event) => {
        const syncs = syncEvents.filter((sync) => sync.resultClockEventId === event.id);
        return {
          ...event,
          validatedAt: event.eventType === ClockEventType.CLOCK_IN ? entry.clockInAt : entry.clockOutAt,
          offlineSync:
            event.origin === EventOrigin.OFFLINE && syncs.length > 0
              ? {
                  status: syncs[0].status,
                  syncedAt: syncs[0].processedAt,
                  offlineEventAgeSeconds: syncs[0].offlineEventAgeSeconds,
                  batchId: syncs[0].batchId,
                  /** Later batches that sent the same signed event again (answered DUPLICATE). */
                  duplicateSyncs: syncs.length - 1,
                }
              : null,
        };
      }),
      rejectedAttempts: entry.rejectedClockAttempts,
      dailySummary: entry.dailySummary,
      history: {
        corrections: entry.corrections.map((correction) => ({
          id: correction.id,
          field: correction.field,
          oldValue: correction.oldValue,
          newValue: correction.newValue,
          reason: correction.reason,
          note: correction.note,
          editedByName: nameOf(correction.editedBy),
          createdAt: correction.createdAt,
          infraction: correction.forgottenStampInfraction,
        })),
        approvals: entry.approvals.map((approval) => ({
          id: approval.id,
          action: approval.action,
          actedByName: nameOf(approval.actedBy),
          notes: approval.notes,
          createdAt: approval.createdAt,
        })),
        auditEvents: auditEvents.map((event) => ({
          id: event.id,
          action: event.action,
          entityType: event.entityType,
          actorName: event.actor?.fullLegalName ?? null,
          field: event.field,
          oldValue: event.oldValue,
          newValue: event.newValue,
          reason: event.reason,
          note: event.note,
          createdAt: event.createdAt,
        })),
      },
      /** What the manager can do now (the endpoints enforce the same rules). */
      allowedActions: {
        approve: awaitingApproval && !periodFinalized,
        reject: awaitingApproval,
        requestCorrection:
          entry.status === TimeEntryStatus.PENDING_APPROVAL || entry.status === TimeEntryStatus.APPROVED || entry.status === TimeEntryStatus.REJECTED,
        fullDayCredit: fullDayCreditEligible && !periodFinalized,
        correct: !periodFinalized,
      },
    };
  }
}
