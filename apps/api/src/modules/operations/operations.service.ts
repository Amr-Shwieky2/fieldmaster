import { Injectable } from "@nestjs/common";
import {
  LocationValidationStatus,
  OfflineSyncEventStatus,
  ShiftStatus,
  TemporaryPointStatus,
  TimeEntryStatus,
} from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { scopeOf, shiftScopeWhere, timeEntryScopeWhere, workerScopeWhere } from "../../common/scope/scope-filters";

/** How far back the "recent" lists look. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const OFFLINE_REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 50;

const workerSelect = { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } } as const;
type WorkerRow = { id: string; membership: { user: { fullLegalName: string } } };
const workerOf = (worker: WorkerRow) => ({ id: worker.id, fullLegalName: worker.membership.user.fullLegalName });

const minutesSince = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));

/**
 * The live operations page (Step 6): what is happening right now, for
 * everyone who holds VIEW_OPERATIONS. Operational only -- no money for
 * anyone, Owners included. Positions are the last accepted clock event of
 * each open entry (event-based; there is no continuous tracking). A member
 * restricted to some projects sees only those projects' shifts, workers and
 * events (the organization-wide emergency call-outs are left out).
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workRules: WorkRulesService,
  ) {}

  async snapshot(organizationId: string, viewer?: AuthenticatedUser, now = new Date()) {
    const recentSince = new Date(now.getTime() - RECENT_WINDOW_MS);
    const scope = viewer ? scopeOf(viewer) : { restricted: false as const };
    const shiftScope = shiftScopeWhere(scope);
    const inShiftScope = shiftScope ? { shift: shiftScope } : {};
    const rules = await this.workRules.current(organizationId, this.prisma);

    const openEntriesQuery = this.prisma.timeEntry.findMany({
      where: { organizationId, status: TimeEntryStatus.ACTIVE, ...(timeEntryScopeWhere(scope) ?? {}) },
      select: {
        id: true,
        clockInAt: true,
        isEmergency: true,
        shiftId: true,
        worker: { select: workerSelect },
        shift: { select: { id: true, title: true, shiftType: true } },
        clockEvents: {
          select: { latitude: true, longitude: true, accuracyMeters: true, serverReceivedAt: true, locationValidationStatus: true, eventType: true },
          orderBy: { serverReceivedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { clockInAt: "asc" },
    });
    // Shifts on now: inside their scheduled window, or with someone clocked in -- the open entries' shifts, by id
    // (a correlated "has an open entry" subquery per shift costs more, and its estimate sets off the planner's JIT).
    const shiftsQuery = openEntriesQuery.then((entries) =>
      this.prisma.shift.findMany({
        where: {
          organizationId,
          status: { notIn: [ShiftStatus.DRAFT, ShiftStatus.CLOSED, ShiftStatus.CANCELLED] },
          AND: [
            { OR: [{ scheduledStart: { lte: now }, scheduledEnd: { gte: now } }, { id: { in: [...new Set(entries.map((entry) => entry.shiftId))] } }] },
            ...(shiftScope ? [shiftScope] : []),
          ],
        },
        select: {
          id: true,
          title: true,
          shiftType: true,
          scheduledStart: true,
          scheduledEnd: true,
          graceMinutes: true,
          site: { select: { id: true, name: true, latitude: true, longitude: true, defaultGeofenceRadiusMeters: true } },
          geofence: { select: { centerLatitude: true, centerLongitude: true, radiusMeters: true } },
          assignments: { where: { removedAt: null }, select: { worker: { select: workerSelect } } },
          timeEntries: { select: { workerProfileId: true, status: true } },
        },
        orderBy: { scheduledStart: "asc" },
      }),
    );

    const [openEntries, shifts, points, emergencies, attempts, suspicious, offline] = await Promise.all([
      openEntriesQuery,
      shiftsQuery,
      this.prisma.temporaryCheckInPoint.findMany({
        where: { organizationId, status: TemporaryPointStatus.ACTIVE, revokedAt: null, expiresAt: { gt: now }, ...inShiftScope },
        select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true, expiresAt: true, shift: { select: { id: true, title: true, shiftType: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.emergencyCallout.findMany({
        // The Turan rota belongs to the whole organization: a member restricted to some projects sees no call-outs.
        where: { organizationId, actualEndClick: null, ...(scope.restricted ? { id: { in: [] } } : {}) },
        select: {
          id: true,
          timeEntryId: true,
          actualStartClick: true,
          compensatedStart: true,
          startLatitude: true,
          startLongitude: true,
          authorizationSource: true,
          worker: { select: workerSelect },
        },
        orderBy: { actualStartClick: "asc" },
      }),
      this.prisma.rejectedClockAttempt.findMany({
        where: { organizationId, serverReceivedAt: { gte: recentSince }, ...inShiftScope },
        select: {
          id: true,
          eventType: true,
          code: true,
          serverReceivedAt: true,
          latitude: true,
          longitude: true,
          accuracyMeters: true,
          distanceMeters: true,
          allowedRadiusMeters: true,
          requiredAccuracyMeters: true,
          timeEntryId: true,
          worker: { select: workerSelect },
          shift: { select: { id: true, title: true, shiftType: true } },
        },
        orderBy: { serverReceivedAt: "desc" },
        take: LIST_LIMIT,
      }),
      this.prisma.clockEvent.findMany({
        where: {
          timeEntry: { organizationId, ...inShiftScope },
          serverReceivedAt: { gte: recentSince },
          OR: [{ mockLocationSuspected: true }, { locationValidationStatus: LocationValidationStatus.FLAGGED }],
        },
        select: {
          id: true,
          eventType: true,
          origin: true,
          serverReceivedAt: true,
          latitude: true,
          longitude: true,
          mockLocationSuspected: true,
          locationValidationStatus: true,
          timeEntry: { select: { id: true, worker: { select: workerSelect }, shift: { select: { id: true, title: true, shiftType: true } } } },
        },
        orderBy: { serverReceivedAt: "desc" },
        take: LIST_LIMIT,
      }),
      this.prisma.offlineSyncEvent.findMany({
        where: {
          batch: { organizationId, ...(workerScopeWhere(scope) ? { worker: workerScopeWhere(scope) } : {}) },
          processedAt: { gte: new Date(now.getTime() - OFFLINE_REVIEW_WINDOW_MS) },
          status: { in: [OfflineSyncEventStatus.FLAGGED, OfflineSyncEventStatus.REJECTED] },
        },
        select: {
          id: true,
          eventType: true,
          status: true,
          deviceTimestamp: true,
          processedAt: true,
          rejectionReason: true,
          resultTimeEntryId: true,
          batch: { select: { worker: { select: workerSelect } } },
        },
        orderBy: { processedAt: "desc" },
        take: LIST_LIMIT,
      }),
    ]);

    // A flagged offline event waits for review until its entry is approved or rejected.
    const flaggedEntryIds = offline.map((event) => event.resultTimeEntryId).filter((id): id is string => id !== null);
    const decidedEntries =
      flaggedEntryIds.length > 0
        ? await this.prisma.timeEntry.findMany({
            where: { id: { in: flaggedEntryIds }, status: { in: [TimeEntryStatus.APPROVED, TimeEntryStatus.REJECTED] } },
            select: { id: true },
          })
        : [];
    const decided = new Set(decidedEntries.map((entry) => entry.id));

    const lateWorkers = shifts.flatMap((shift) => {
      const lateFrom = shift.scheduledStart.getTime() + shift.graceMinutes * 60_000;
      if (now.getTime() <= lateFrom) return [];
      const started = new Set(shift.timeEntries.map((entry) => entry.workerProfileId));
      return shift.assignments
        .filter((assignment) => !started.has(assignment.worker.id))
        .map((assignment) => ({
          worker: workerOf(assignment.worker),
          shift: { id: shift.id, title: shift.title, shiftType: shift.shiftType },
          scheduledStart: shift.scheduledStart,
          graceMinutes: shift.graceMinutes,
          lateMinutes: minutesSince(shift.scheduledStart, now),
        }));
    });

    const sites = new Map<string, { siteId: string; name: string; centerLatitude: number; centerLongitude: number; radiusMeters: number }>();
    for (const shift of shifts) {
      if (!shift.site) continue;
      sites.set(shift.site.id, {
        siteId: shift.site.id,
        name: shift.site.name,
        centerLatitude: shift.geofence?.centerLatitude ?? shift.site.latitude,
        centerLongitude: shift.geofence?.centerLongitude ?? shift.site.longitude,
        radiusMeters: shift.geofence?.radiusMeters ?? shift.site.defaultGeofenceRadiusMeters,
      });
    }

    return {
      generatedAt: now,
      workersOnShift: openEntries.map((entry) => {
        const event = entry.clockEvents[0] ?? null;
        return {
          timeEntryId: entry.id,
          worker: workerOf(entry.worker),
          shift: entry.shift,
          clockInAt: entry.clockInAt,
          openMinutes: entry.clockInAt ? minutesSince(entry.clockInAt, now) : 0,
          isEmergency: entry.isEmergency,
          position: event
            ? {
                latitude: event.latitude,
                longitude: event.longitude,
                accuracyMeters: event.accuracyMeters,
                at: event.serverReceivedAt,
                eventType: event.eventType,
                locationValidationStatus: event.locationValidationStatus,
              }
            : null,
        };
      }),
      sites: [...sites.values()],
      temporaryPoints: points,
      activeEmergencies: emergencies.map((callout) => ({
        calloutId: callout.id,
        timeEntryId: callout.timeEntryId,
        worker: workerOf(callout.worker),
        authorizationSource: callout.authorizationSource,
        actualStartClick: callout.actualStartClick,
        compensatedStart: callout.compensatedStart,
        start: { latitude: callout.startLatitude, longitude: callout.startLongitude },
      })),
      activeShifts: shifts.map((shift) => ({
        id: shift.id,
        title: shift.title,
        shiftType: shift.shiftType,
        scheduledStart: shift.scheduledStart,
        scheduledEnd: shift.scheduledEnd,
        siteName: shift.site?.name ?? null,
        expectedCount: shift.assignments.length,
        clockedInCount: shift.timeEntries.filter((entry) => entry.status === TimeEntryStatus.ACTIVE).length,
        lateCount: lateWorkers.filter((late) => late.shift.id === shift.id).length,
      })),
      lateWorkers,
      longOpenEntries: openEntries
        .filter((entry) => entry.clockInAt && minutesSince(entry.clockInAt, now) >= rules.standardDayMinutes)
        .map((entry) => ({
          timeEntryId: entry.id,
          worker: workerOf(entry.worker),
          shift: entry.shift,
          clockInAt: entry.clockInAt,
          openMinutes: minutesSince(entry.clockInAt!, now),
          isEmergency: entry.isEmergency,
        })),
      recentRejectedAttempts: attempts.map((attempt) => ({
        id: attempt.id,
        eventType: attempt.eventType,
        code: attempt.code,
        at: attempt.serverReceivedAt,
        latitude: attempt.latitude,
        longitude: attempt.longitude,
        accuracyMeters: attempt.accuracyMeters,
        distanceMeters: attempt.distanceMeters,
        allowedRadiusMeters: attempt.allowedRadiusMeters,
        requiredAccuracyMeters: attempt.requiredAccuracyMeters,
        timeEntryId: attempt.timeEntryId,
        worker: workerOf(attempt.worker),
        shift: attempt.shift,
      })),
      suspiciousLocations: suspicious.map((event) => ({
        clockEventId: event.id,
        eventType: event.eventType,
        origin: event.origin,
        at: event.serverReceivedAt,
        latitude: event.latitude,
        longitude: event.longitude,
        mockLocationSuspected: event.mockLocationSuspected,
        locationValidationStatus: event.locationValidationStatus,
        timeEntryId: event.timeEntry.id,
        worker: workerOf(event.timeEntry.worker),
        shift: event.timeEntry.shift,
      })),
      offlineReview: offline
        .filter((event) => event.status === OfflineSyncEventStatus.REJECTED || (event.resultTimeEntryId !== null && !decided.has(event.resultTimeEntryId)))
        .map((event) => ({
          id: event.id,
          eventType: event.eventType,
          status: event.status,
          deviceTimestamp: event.deviceTimestamp,
          processedAt: event.processedAt,
          rejectionReason: event.rejectionReason,
          timeEntryId: event.resultTimeEntryId,
          worker: workerOf(event.batch.worker),
        })),
    };
  }
}
