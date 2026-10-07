import { Injectable } from "@nestjs/common";
import {
  CheckInMethod,
  ClockEventType,
  EventOrigin,
  LocationValidationStatus,
  NotificationType,
  OrgRole,
  ShiftStatus,
  TimeEntryStatus,
} from "@fieldmaster/shared-types";
import { calculateShiftCompensation, toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { GeofenceValidationService } from "../sites/geofence-validation.service";
import { TemporaryCheckInPointsService } from "../shifts/temporary-check-in-points.service";
import { NotificationsService } from "../notifications/notifications.service";
import { loadWorkerName, withoutFinancialData, type NotificationData } from "../notifications/notification-data";
import { LocationValidationService } from "./location-validation.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { ClockInDto } from "./dto/clock-in.dto";
import type { ClockOutDto } from "./dto/clock-out.dto";

const DEFAULT_TEMP_POINT_MIN_ACCURACY_METERS = 75;

@Injectable()
export class ClockEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly geofenceValidation: GeofenceValidationService,
    private readonly temporaryCheckInPoints: TemporaryCheckInPointsService,
    private readonly locationValidation: LocationValidationService,
    private readonly notifications: NotificationsService,
  ) {}

  async clockIn(organizationId: string, dto: ClockInDto, actor: AuthenticatedUser, idempotencyKey: string | undefined, correlationId: string) {
    const result = await this.idempotencyService.withIdempotency(idempotencyKey, "clock-in", dto, () =>
      this.clockInCore(organizationId, dto, actor, idempotencyKey ?? "none", correlationId),
    );
    return result.body;
  }

  /**
   * The full clock-in rule set (assignment, conflict, time/mock-location,
   * geofence). Called both by the online controller (wrapped in
   * request-level idempotency above) and by OfflineSyncService for each
   * queued event in a batch (which has its own batch-level idempotency key
   * plus the `[deviceId, clientEventId]` uniqueness on ClockEvent itself, so
   * it deliberately does not go through `withIdempotency` a second time).
   */
  async clockInCore(organizationId: string, dto: ClockInDto, actor: AuthenticatedUser, idempotencyKey: string, correlationId: string) {
    if (!actor.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "Only time-trackable workers can clock in.");
    }

    const shift = await this.prisma.shift.findFirst({
      where: { id: dto.shiftId, organizationId },
      include: { geofence: true, site: true },
    });
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

    if (shift.status === ShiftStatus.CANCELLED || shift.status === ShiftStatus.CLOSED) {
      throw new AppException(409, ErrorCodes.CONFLICT, "This shift is no longer open for clock-in.");
    }

    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { shiftId: dto.shiftId, workerProfileId: actor.workerProfileId, removedAt: null },
    });
    if (!assignment) throw new AppException(403, ErrorCodes.FORBIDDEN, "You are not assigned to this shift.");

    const existingActive = await this.prisma.timeEntry.findFirst({
      where: { workerProfileId: actor.workerProfileId, status: TimeEntryStatus.ACTIVE },
    });
    if (existingActive) {
      throw new AppException(409, ErrorCodes.ACTIVE_TIME_ENTRY_EXISTS, "You already have an open clock-in. Clock out before starting another.");
    }

    const deviceTimestamp = new Date(dto.deviceTimestamp);
    const origin = dto.origin ?? EventOrigin.ONLINE;
    const mockSuspected = dto.mockLocationSuspected ?? false;

    const timeValidation = this.locationValidation.validateTime({ deviceTimestamp, mockLocationSuspected: mockSuspected, origin });
    if (timeValidation.rejectOnlineDeviation) {
      throw new AppException(400, ErrorCodes.DEVICE_TIME_DEVIATION_EXCEEDED, "Your device clock appears out of sync. Please check your device time and try again.", {
        deviationSeconds: timeValidation.deviationSeconds,
      });
    }

    const locationValidationStatus = this.locationValidation.determineStatus(
      { deviceTimestamp, mockLocationSuspected: mockSuspected, origin },
      timeValidation,
    );
    if (locationValidationStatus === LocationValidationStatus.BLOCKED) {
      throw new AppException(403, ErrorCodes.MOCK_LOCATION_BLOCKED, "Location could not be verified as genuine. Please disable mock-location tools and try again.");
    }

    let distanceFromSiteMeters: number | null = null;

    if (shift.checkInMethod === CheckInMethod.GEOFENCED) {
      let center: { lat: number; lng: number; radius: number; minAccuracy: number };

      if (dto.temporaryCheckInPointId) {
        const point = await this.prisma.temporaryCheckInPoint.findFirst({
          where: { id: dto.temporaryCheckInPointId, organizationId, shiftId: dto.shiftId },
        });
        if (!point || !this.temporaryCheckInPoints.isCurrentlyActive(point)) {
          throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "This temporary check-in point is not currently active.");
        }
        center = { lat: point.latitude, lng: point.longitude, radius: point.radiusMeters, minAccuracy: DEFAULT_TEMP_POINT_MIN_ACCURACY_METERS };
      } else {
        if (!shift.geofence) {
          throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "This shift has no geofence configured for check-in.");
        }
        center = {
          lat: shift.geofence.centerLatitude,
          lng: shift.geofence.centerLongitude,
          radius: shift.geofence.radiusMeters,
          minAccuracy: shift.geofence.minAccuracyMeters,
        };
      }

      if (dto.accuracyMeters > center.minAccuracy) {
        throw new AppException(400, ErrorCodes.GPS_ACCURACY_TOO_LOW, "Your location accuracy is too low to verify your position. Move to an open area and try again.", {
          accuracyMeters: dto.accuracyMeters,
          requiredMeters: center.minAccuracy,
        });
      }

      const geofenceCheck = await this.geofenceValidation.check(dto.latitude, dto.longitude, center.lat, center.lng, center.radius);
      distanceFromSiteMeters = geofenceCheck.distanceMeters;
      if (!geofenceCheck.withinRadius) {
        throw new AppException(400, ErrorCodes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS, "You are outside the permitted check-in area.", {
          distanceMeters: geofenceCheck.distanceMeters,
          allowedRadiusMeters: geofenceCheck.allowedRadiusMeters,
        });
      }
    } else if (shift.site) {
      const distanceCheck = await this.geofenceValidation.check(dto.latitude, dto.longitude, shift.site.latitude, shift.site.longitude, shift.site.defaultGeofenceRadiusMeters);
      distanceFromSiteMeters = distanceCheck.distanceMeters;
    }

    const serverReceivedAt = new Date();
    // Server time is authoritative for *deviation detection* (spec 19.1),
    // but the business-relevant clock-in instant for an offline event is
    // when it actually happened on the device, not whenever the batch
    // happened to sync -- otherwise a worker who clocks in at 6am with no
    // signal and syncs at 6pm would be recorded as starting at 6pm.
    const effectiveAt = origin === EventOrigin.OFFLINE ? deviceTimestamp : serverReceivedAt;
    const businessDate = toBusinessDate(effectiveAt);

    const { timeEntry, clockEvent } = await this.prisma.$transaction(async (tx) => {
      const timeEntry = await tx.timeEntry.create({
        data: {
          id: generateId(),
          organizationId,
          workerProfileId: actor.workerProfileId!,
          shiftId: dto.shiftId,
          status: TimeEntryStatus.ACTIVE,
          businessDate,
          clockInAt: effectiveAt,
          checkInMethod: shift.checkInMethod,
          isEmergency: false,
        },
      });

      const clockEvent = await tx.clockEvent.create({
        data: {
          id: generateId(),
          timeEntryId: timeEntry.id,
          eventType: ClockEventType.CLOCK_IN,
          origin,
          idempotencyKey,
          deviceId: dto.deviceId,
          clientEventId: dto.clientEventId,
          deviceTimestamp,
          serverReceivedAt,
          deviceTimeDeviationSeconds: timeValidation.deviationSeconds,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: dto.accuracyMeters,
          altitude: dto.altitude,
          locationProvider: dto.locationProvider,
          mockLocationSuspected: mockSuspected,
          distanceFromSiteMeters,
          locationValidationStatus,
          appVersion: dto.appVersion,
        },
      });

      return { timeEntry, clockEvent };
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "CLOCK_IN",
      entityType: "TimeEntry",
      entityId: timeEntry.id,
      correlationId,
    });

    const clockInData = {
      timeEntryId: timeEntry.id,
      shiftId: shift.id,
      shiftTitle: shift.title,
      workerProfileId: actor.workerProfileId,
      workerName: await loadWorkerName(this.prisma, actor.workerProfileId),
      clockInAt: effectiveAt.toISOString(),
    };
    await this.notifyManagerAndOwners(organizationId, shift.managerId, {
      type: NotificationType.WORKER_CLOCKED_IN,
      title: "Worker clocked in",
      managerBody: `A worker clocked in for "${shift.title}".`,
      ownerBody: `A worker clocked in for "${shift.title}".`,
      managerData: clockInData,
      ownerData: clockInData,
    });

    return { status: 201, body: { timeEntry, clockEvent } };
  }

  async clockOut(organizationId: string, dto: ClockOutDto, actor: AuthenticatedUser, idempotencyKey: string | undefined, correlationId: string) {
    const result = await this.idempotencyService.withIdempotency(idempotencyKey, "clock-out", dto, () =>
      this.clockOutCore(organizationId, dto, actor, idempotencyKey ?? "none", correlationId),
    );
    return result.body;
  }

  /** See clockInCore's docstring -- same reuse pattern for clock-out. */
  async clockOutCore(organizationId: string, dto: ClockOutDto, actor: AuthenticatedUser, idempotencyKey: string, correlationId: string) {
    if (!actor.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "Only time-trackable workers can clock out.");
    }

    const timeEntry = await this.prisma.timeEntry.findFirst({
      where: { workerProfileId: actor.workerProfileId, status: TimeEntryStatus.ACTIVE },
      include: { shift: true },
    });
    if (!timeEntry) {
      throw new AppException(409, ErrorCodes.NO_ACTIVE_TIME_ENTRY, "You do not have an open clock-in to close.");
    }

    const hasSummary = (dto.summaryText && dto.summaryText.trim().length > 0) || (dto.voiceNoteUrl && dto.voiceNoteUrl.trim().length > 0);
    if (!hasSummary) {
      throw new AppException(400, ErrorCodes.SUMMARY_REQUIRED, "A task summary (text or voice note) is required to clock out.");
    }

    const deviceTimestamp = new Date(dto.deviceTimestamp);
    const origin = dto.origin ?? EventOrigin.ONLINE;
    const mockSuspected = dto.mockLocationSuspected ?? false;

    const timeValidation = this.locationValidation.validateTime({ deviceTimestamp, mockLocationSuspected: mockSuspected, origin });
    if (timeValidation.rejectOnlineDeviation) {
      throw new AppException(400, ErrorCodes.DEVICE_TIME_DEVIATION_EXCEEDED, "Your device clock appears out of sync. Please check your device time and try again.", {
        deviationSeconds: timeValidation.deviationSeconds,
      });
    }
    const locationValidationStatus = this.locationValidation.determineStatus(
      { deviceTimestamp, mockLocationSuspected: mockSuspected, origin },
      timeValidation,
    );
    if (locationValidationStatus === LocationValidationStatus.BLOCKED) {
      throw new AppException(403, ErrorCodes.MOCK_LOCATION_BLOCKED, "Location could not be verified as genuine. Please disable mock-location tools and try again.");
    }

    const serverReceivedAt = new Date();
    const effectiveAt = origin === EventOrigin.OFFLINE ? deviceTimestamp : serverReceivedAt;
    if (effectiveAt.getTime() <= timeEntry.clockInAt!.getTime()) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Clock-out must be after clock-in.");
    }
    const rawDurationMinutes = Math.max(0, Math.round((effectiveAt.getTime() - timeEntry.clockInAt!.getTime()) / 60_000));

    const clockEvent = await this.prisma.$transaction(async (tx) => {
      const clockEvent = await tx.clockEvent.create({
        data: {
          id: generateId(),
          timeEntryId: timeEntry.id,
          eventType: ClockEventType.CLOCK_OUT,
          origin,
          idempotencyKey,
          deviceId: dto.deviceId,
          clientEventId: dto.clientEventId,
          deviceTimestamp,
          serverReceivedAt,
          deviceTimeDeviationSeconds: timeValidation.deviationSeconds,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: dto.accuracyMeters,
          altitude: dto.altitude,
          locationProvider: dto.locationProvider,
          mockLocationSuspected: mockSuspected,
          locationValidationStatus,
          appVersion: dto.appVersion,
        },
      });

      await tx.dailySummary.create({
        data: {
          id: generateId(),
          timeEntryId: timeEntry.id,
          text: dto.summaryText,
          voiceNoteUrl: dto.voiceNoteUrl,
          taskCategory: dto.taskCategory,
          materialsUsed: dto.materialsUsed,
          problemsEncountered: dto.problemsEncountered,
          followUpRequired: dto.followUpRequired ?? false,
        },
      });

      await tx.timeEntry.update({
        where: { id: timeEntry.id },
        data: { clockOutAt: effectiveAt, rawDurationMinutes, status: TimeEntryStatus.PENDING_APPROVAL },
      });

      return clockEvent;
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "CLOCK_OUT",
      entityType: "TimeEntry",
      entityId: timeEntry.id,
      correlationId,
    });

    await this.notifyClockOut(organizationId, actor.workerProfileId, timeEntry.shift.managerId, timeEntry.shift.title, rawDurationMinutes, {
      timeEntryId: timeEntry.id,
      shiftId: timeEntry.shiftId,
      clockOutAt: effectiveAt.toISOString(),
    });

    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntry.id }, include: { dailySummary: true } });
    // `clockEvent` is exposed alongside `body` for internal callers (offline
    // sync needs its locationValidationStatus/id); the public controller
    // response is `body` alone, unchanged from before this refactor.
    return { status: 200, body: updated, clockEvent };
  }

  /**
   * The shift's manager gets `managerBody` / `managerData`; every other active
   * Owner gets `ownerBody` / `ownerData`. Only `ownerData` may carry money
   * (`*Agorot`): it is the Owner-only counterpart of `ownerBody`'s cost line.
   */
  private async notifyManagerAndOwners(
    organizationId: string,
    managerUserId: string,
    content: {
      type: NotificationType;
      title: string;
      managerBody: string;
      ownerBody: string;
      managerData: NotificationData;
      ownerData: NotificationData;
    },
  ) {
    const owners = await this.prisma.organizationMembership.findMany({
      where: { organizationId, role: OrgRole.OWNER, status: "ACTIVE", archivedAt: null },
    });
    const recipients = new Set<string>([managerUserId, ...owners.map((o) => o.userId)]);
    await this.notifications.notifyMany(
      Array.from(recipients).map((recipientUserId) => {
        const isShiftManager = recipientUserId === managerUserId;
        return {
          organizationId,
          recipientUserId,
          type: content.type,
          title: content.title,
          body: isShiftManager ? content.managerBody : content.ownerBody,
          data: isShiftManager ? withoutFinancialData(content.managerData) : content.ownerData,
        };
      }),
    );
  }

  private async notifyClockOut(
    organizationId: string,
    workerProfileId: string,
    managerUserId: string,
    shiftTitle: string,
    rawDurationMinutes: number,
    refs: { timeEntryId: string; shiftId: string; clockOutAt: string },
  ) {
    const regularMinutes = Math.min(rawDurationMinutes, 540);
    const overtimeMinutes = Math.max(0, rawDurationMinutes - 540);
    const formatHm = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

    const managerBody = `Worker clocked out of "${shiftTitle}".\nTotal: ${formatHm(rawDurationMinutes)}\nRegular: ${formatHm(regularMinutes)}\nOvertime: ${formatHm(overtimeMinutes)}\nApproval is required.`;
    // No money here: this is what the shift's manager (a Field Manager) gets.
    const managerData: NotificationData = {
      ...refs,
      shiftTitle,
      workerProfileId,
      workerName: await loadWorkerName(this.prisma, workerProfileId),
      durationMinutes: rawDurationMinutes,
      regularMinutes,
      overtimeMinutes,
    };

    let ownerBody = managerBody;
    let ownerData: NotificationData = managerData;
    const activeCompensation = await this.prisma.compensationProfile.findFirst({
      where: {
        workerProfileId,
        effectiveStartDate: { lte: new Date() },
        OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: new Date() } }],
      },
      orderBy: { effectiveStartDate: "desc" },
    });
    if (activeCompensation) {
      const estimate = calculateShiftCompensation({
        compensationType: activeCompensation.compensationType,
        approvedMinutes: rawDurationMinutes,
        fullDayCredit: false,
        dailyBaseRateAgorot: activeCompensation.dailyBaseRateAgorot ?? undefined,
        baseHourlyRateAgorot: activeCompensation.baseHourlyRateAgorot ?? undefined,
        overtimeHourlyRateAgorot: activeCompensation.overtimeHourlyRateAgorot,
      });
      const ils = (estimate.totalCompensationAgorot / 100).toFixed(2);
      ownerBody = `Worker clocked out of "${shiftTitle}".\nTotal: ${formatHm(rawDurationMinutes)}\nRegular: ${formatHm(regularMinutes)}\nOvertime: ${formatHm(overtimeMinutes)}\nEstimated cost: ₪${ils}`;
      // Owner-only: the same estimate as the cost line in ownerBody.
      ownerData = { ...managerData, estimatedCostAgorot: estimate.totalCompensationAgorot };
    }

    await this.notifyManagerAndOwners(organizationId, managerUserId, {
      type: NotificationType.WORKER_CLOCKED_OUT,
      title: "Worker clocked out",
      managerBody,
      ownerBody,
      managerData,
      ownerData,
    });
  }
}
