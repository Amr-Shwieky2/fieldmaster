import type { Prisma } from "@prisma/client";
import { CheckInMethod, ClockEventType, LocationValidationStatus } from "@fieldmaster/shared-types";
import { ErrorCodes } from "../../../common/errors/app-exception";
import type { ReportDataDeps, ReportLoadContext } from "../report.types";

/**
 * The site violations report (no money for anyone):
 * - every clock attempt the server refused (outside the geofence, GPS
 *   accuracy too low, device clock off, mock location), with the distance
 *   against the radius, the accuracy against the requirement and the clock
 *   deviation;
 * - suspicious locations: clock events flagged for review or with a
 *   suspected mock location, and attempts refused as a mock location;
 * - Flexi-Check entries (emergency call-outs excluded: they have their own
 *   report), with who enabled it and why;
 * - clock-ins at a temporary check-in point.
 * Attempts belong to the period of their shift; events to their entry's.
 */

interface Place {
  workerName: string;
  businessDate: string;
  shiftTitle: string;
  shiftType: string;
  projectName: string | null;
  siteName: string | null;
}

export interface ViolationAttempt extends Place {
  eventType: string;
  origin: string;
  code: string;
  serverReceivedAt: string;
  deviceTimestamp: string;
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

export interface SuspiciousEvent extends Place {
  eventType: string;
  origin: string;
  serverReceivedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationSuspected: boolean;
  locationValidationStatus: string;
  distanceFromSiteMeters: number | null;
}

export interface FlexiCheckEntry extends Place {
  status: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  enabledByName: string | null;
  reason: string | null;
  /** Distance of the clock-in from the site (measured, not enforced). */
  clockInDistanceMeters: number | null;
}

export interface TemporaryPointUse extends Place {
  eventType: string;
  serverReceivedAt: string;
  pointName: string;
  pointRadiusMeters: number;
  distanceMeters: number | null;
  accuracyMeters: number;
}

export interface SiteViolationsData {
  attempts: ViolationAttempt[];
  suspiciousEvents: SuspiciousEvent[];
  mockLocationAttempts: ViolationAttempt[];
  flexiCheckEntries: FlexiCheckEntry[];
  temporaryPointUses: TemporaryPointUse[];
  summary: {
    attempts: number;
    attemptsByCode: { code: string; count: number }[];
    suspicious: number;
    flexiCheckEntries: number;
    temporaryPointUses: number;
  };
}

const workerName = { select: { membership: { select: { user: { select: { fullLegalName: true } } } } } } as const;
const shiftPlace = {
  select: { title: true, shiftType: true, businessDate: true, project: { select: { name: true } }, site: { select: { name: true } } },
} as const;

export async function loadSiteViolations(deps: ReportDataDeps, context: ReportLoadContext): Promise<SiteViolationsData> {
  const { filters, organizationId } = context;
  const businessDate = { gte: filters.fromDate, lte: filters.toDate };
  const shiftWhere: Prisma.ShiftWhereInput = {
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
  };
  const worker = filters.workerProfileId ? { workerProfileId: filters.workerProfileId } : {};
  const entryWhere: Prisma.TimeEntryWhereInput = {
    organizationId,
    businessDate,
    ...worker,
    ...(Object.keys(shiftWhere).length > 0 ? { shift: shiftWhere } : {}),
  };

  const [attemptRows, suspiciousRows, flexiRows, pointRows] = await Promise.all([
    deps.prisma.rejectedClockAttempt.findMany({
      where: { organizationId, ...worker, shift: { ...shiftWhere, businessDate } },
      select: {
        eventType: true,
        origin: true,
        code: true,
        serverReceivedAt: true,
        deviceTimestamp: true,
        deviationSeconds: true,
        latitude: true,
        longitude: true,
        accuracyMeters: true,
        mockLocationSuspected: true,
        distanceMeters: true,
        allowedRadiusMeters: true,
        requiredAccuracyMeters: true,
        temporaryCheckInPoint: { select: { name: true } },
        worker: workerName,
        shift: shiftPlace,
      },
      orderBy: [{ serverReceivedAt: "asc" }, { id: "asc" }],
    }),
    deps.prisma.clockEvent.findMany({
      where: {
        timeEntry: entryWhere,
        OR: [{ locationValidationStatus: LocationValidationStatus.FLAGGED }, { mockLocationSuspected: true }],
      },
      select: {
        eventType: true,
        origin: true,
        serverReceivedAt: true,
        latitude: true,
        longitude: true,
        accuracyMeters: true,
        mockLocationSuspected: true,
        locationValidationStatus: true,
        distanceFromSiteMeters: true,
        timeEntry: { select: { businessDate: true, worker: workerName, shift: shiftPlace } },
      },
      orderBy: [{ serverReceivedAt: "asc" }, { id: "asc" }],
    }),
    deps.prisma.timeEntry.findMany({
      where: { ...entryWhere, checkInMethod: CheckInMethod.FLEXI_CHECK, isEmergency: false },
      select: {
        businessDate: true,
        status: true,
        clockInAt: true,
        clockOutAt: true,
        flexiCheckEnabledBy: true,
        flexiCheckReason: true,
        worker: workerName,
        shift: shiftPlace,
        clockEvents: { select: { eventType: true, distanceFromSiteMeters: true }, orderBy: { serverReceivedAt: "asc" } },
      },
      orderBy: [{ businessDate: "asc" }, { clockInAt: "asc" }, { id: "asc" }],
    }),
    deps.prisma.clockEvent.findMany({
      where: { timeEntry: entryWhere, temporaryCheckInPointId: { not: null } },
      select: {
        eventType: true,
        serverReceivedAt: true,
        distanceFromSiteMeters: true,
        accuracyMeters: true,
        temporaryCheckInPoint: { select: { name: true, radiusMeters: true } },
        timeEntry: { select: { businessDate: true, worker: workerName, shift: shiftPlace } },
      },
      orderBy: [{ serverReceivedAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const enablerIds = [...new Set(flexiRows.map((row) => row.flexiCheckEnabledBy).filter((id): id is string => id !== null))];
  const enablers =
    enablerIds.length > 0 ? await deps.prisma.user.findMany({ where: { id: { in: enablerIds } }, select: { id: true, fullLegalName: true } }) : [];

  const place = (row: {
    worker: { membership: { user: { fullLegalName: string } } };
    shift: { title: string; shiftType: string; businessDate: string; project: { name: string } | null; site: { name: string } | null };
  }): Place => ({
    workerName: row.worker.membership.user.fullLegalName,
    businessDate: row.shift.businessDate,
    shiftTitle: row.shift.title,
    shiftType: row.shift.shiftType,
    projectName: row.shift.project?.name ?? null,
    siteName: row.shift.site?.name ?? null,
  });

  const attempts: ViolationAttempt[] = attemptRows.map((row) => ({
    ...place(row),
    eventType: row.eventType,
    origin: row.origin,
    code: row.code,
    serverReceivedAt: row.serverReceivedAt.toISOString(),
    deviceTimestamp: row.deviceTimestamp.toISOString(),
    deviationSeconds: row.deviationSeconds,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
    mockLocationSuspected: row.mockLocationSuspected,
    distanceMeters: row.distanceMeters,
    allowedRadiusMeters: row.allowedRadiusMeters,
    requiredAccuracyMeters: row.requiredAccuracyMeters,
    temporaryPointName: row.temporaryCheckInPoint?.name ?? null,
  }));

  const suspiciousEvents: SuspiciousEvent[] = suspiciousRows.map((row) => ({
    ...place({ worker: row.timeEntry.worker, shift: row.timeEntry.shift }),
    businessDate: row.timeEntry.businessDate,
    eventType: row.eventType,
    origin: row.origin,
    serverReceivedAt: row.serverReceivedAt.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
    mockLocationSuspected: row.mockLocationSuspected,
    locationValidationStatus: row.locationValidationStatus,
    distanceFromSiteMeters: row.distanceFromSiteMeters,
  }));

  const flexiCheckEntries: FlexiCheckEntry[] = flexiRows.map((row) => ({
    ...place(row),
    businessDate: row.businessDate,
    status: row.status,
    clockInAt: row.clockInAt?.toISOString() ?? null,
    clockOutAt: row.clockOutAt?.toISOString() ?? null,
    enabledByName: row.flexiCheckEnabledBy ? (enablers.find((user) => user.id === row.flexiCheckEnabledBy)?.fullLegalName ?? null) : null,
    reason: row.flexiCheckReason,
    clockInDistanceMeters: row.clockEvents.find((event) => event.eventType === ClockEventType.CLOCK_IN)?.distanceFromSiteMeters ?? null,
  }));

  const temporaryPointUses: TemporaryPointUse[] = pointRows.map((row) => ({
    ...place({ worker: row.timeEntry.worker, shift: row.timeEntry.shift }),
    businessDate: row.timeEntry.businessDate,
    eventType: row.eventType,
    serverReceivedAt: row.serverReceivedAt.toISOString(),
    pointName: row.temporaryCheckInPoint?.name ?? "",
    pointRadiusMeters: row.temporaryCheckInPoint?.radiusMeters ?? 0,
    distanceMeters: row.distanceFromSiteMeters,
    accuracyMeters: row.accuracyMeters,
  }));

  const codeCounts = new Map<string, number>();
  for (const attempt of attempts) codeCounts.set(attempt.code, (codeCounts.get(attempt.code) ?? 0) + 1);
  const mockLocationAttempts = attempts.filter((attempt) => attempt.code === ErrorCodes.MOCK_LOCATION_BLOCKED);

  return {
    attempts,
    suspiciousEvents,
    mockLocationAttempts,
    flexiCheckEntries,
    temporaryPointUses,
    summary: {
      attempts: attempts.length,
      attemptsByCode: [...codeCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      suspicious: suspiciousEvents.length + mockLocationAttempts.length,
      flexiCheckEntries: flexiCheckEntries.length,
      temporaryPointUses: temporaryPointUses.length,
    },
  };
}
