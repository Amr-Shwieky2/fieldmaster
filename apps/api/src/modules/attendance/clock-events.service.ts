import { Injectable } from "@nestjs/common";
import type { Shift } from "@prisma/client";
import {
  CheckInMethod,
  ClockEventType,
  EventOrigin,
  LocationValidationStatus,
  MockLocationState,
  NotificationType,
  ShiftStatus,
  SummarySource,
  TimeEntryStatus,
  NotificationSubjectKind,
} from "@fieldmaster/shared-types";
import { calculateShiftCompensation, rawDurationMinutes as minutesBetween, toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { GeofenceValidationService } from "../sites/geofence-validation.service";
import { TemporaryCheckInPointsService } from "../shifts/temporary-check-in-points.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationAudienceService } from "../notifications/notification-audience.service";
import { OperationsChangeKind, RealtimeEventsService } from "../notifications/realtime-events";
import { loadWorkerName, withoutFinancialData, type NotificationData } from "../notifications/notification-data";
import { OrganizationSettingsService } from "../../common/settings/organization-settings.service";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { LocationValidationService } from "./location-validation.service";
import { RejectedClockAttemptsService, type RejectedClockAttemptInput } from "./rejected-clock-attempts.service";
import { AttendanceAttachmentsService } from "./attendance-attachments.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { ClockInDto } from "./dto/clock-in.dto";
import type { ClockOutDto } from "./dto/clock-out.dto";
import type { SubjectRef } from "../notifications/notification-subjects.service";

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
    private readonly rejectedAttempts: RejectedClockAttemptsService,
    private readonly settings: OrganizationSettingsService,
    private readonly notificationAudience: NotificationAudienceService,
    private readonly realtime: RealtimeEventsService,
    private readonly attachments: AttendanceAttachmentsService,
    private readonly workRules: WorkRulesService,
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
    const mockSuspected = isMockLocationSuspected(dto);

    // The organization's limits (settings), read on every clock event.
    const settings = await this.settings.get(organizationId);
    const timeValidation = this.locationValidation.validateTime({
      deviceTimestamp,
      mockLocationSuspected: mockSuspected,
      origin,
      deviationLimitSeconds: settings.deviceTimeDeviationSeconds,
    });

    /** Stores the refused attempt as evidence (Step 5), then hands back the same error to throw. */
    const refuse = async (error: AppException, evidence: Partial<RejectedClockAttemptInput> = {}) => {
      await this.rejectedAttempts.record({
        organizationId,
        workerProfileId: actor.workerProfileId!,
        shiftId: shift.id,
        timeEntryId: null,
        eventType: ClockEventType.CLOCK_IN,
        origin,
        code: error.code,
        deviceTimestamp,
        deviationSeconds: timeValidation.deviationSeconds,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyMeters: dto.accuracyMeters,
        mockLocationSuspected: mockSuspected,
        mockLocationState: dto.mockLocationState ?? null,
        ...evidence,
      });
      return error;
    };

    if (timeValidation.rejectOnlineDeviation) {
      throw await refuse(
        new AppException(400, ErrorCodes.DEVICE_TIME_DEVIATION_EXCEEDED, "Your device clock appears out of sync. Please check your device time and try again.", {
          deviationSeconds: timeValidation.deviationSeconds,
        }),
      );
    }

    const locationValidationStatus = this.locationValidation.determineStatus(
      { deviceTimestamp, mockLocationSuspected: mockSuspected, origin },
      timeValidation,
    );
    if (locationValidationStatus === LocationValidationStatus.BLOCKED) {
      throw await refuse(
        new AppException(403, ErrorCodes.MOCK_LOCATION_BLOCKED, "Location could not be verified as genuine. Please disable mock-location tools and try again."),
      );
    }

    // The clock-in window of the work rules in force on the shift's business date: not earlier than
    // that many minutes before the shift starts (an offline event counts at the time it happened).
    const rules = await this.workRules.rulesOn(organizationId, shift.businessDate);
    const clockInOpensAt = new Date(shift.scheduledStart.getTime() - rules.clockInEarlyWindowMinutes * 60_000);
    const eventAt = origin === EventOrigin.OFFLINE ? deviceTimestamp : new Date();
    if (eventAt.getTime() < clockInOpensAt.getTime()) {
      throw await refuse(
        new AppException(409, ErrorCodes.CLOCK_IN_TOO_EARLY, "This shift is not open for clock-in yet.", {
          opensAt: clockInOpensAt.toISOString(),
          windowMinutes: rules.clockInEarlyWindowMinutes,
        }),
      );
    }

    let distanceFromSiteMeters: number | null = null;
    let temporaryCheckInPointId: string | null = null;

    if (shift.checkInMethod === CheckInMethod.GEOFENCED) {
      let center: { lat: number; lng: number; radius: number; minAccuracy: number };

      if (dto.temporaryCheckInPointId) {
        const point = await this.prisma.temporaryCheckInPoint.findFirst({
          where: { id: dto.temporaryCheckInPointId, organizationId, shiftId: dto.shiftId },
        });
        if (!point || !this.temporaryCheckInPoints.isCurrentlyActive(point)) {
          throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "This temporary check-in point is not currently active.");
        }
        center = { lat: point.latitude, lng: point.longitude, radius: point.radiusMeters, minAccuracy: settings.temporaryPointMinAccuracyMeters };
        temporaryCheckInPointId = point.id;
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
        throw await refuse(
          new AppException(400, ErrorCodes.GPS_ACCURACY_TOO_LOW, "Your location accuracy is too low to verify your position. Move to an open area and try again.", {
            accuracyMeters: dto.accuracyMeters,
            requiredMeters: center.minAccuracy,
          }),
          { requiredAccuracyMeters: center.minAccuracy, temporaryCheckInPointId },
        );
      }

      const geofenceCheck = await this.geofenceValidation.check(dto.latitude, dto.longitude, center.lat, center.lng, center.radius);
      distanceFromSiteMeters = geofenceCheck.distanceMeters;
      if (!geofenceCheck.withinRadius) {
        throw await refuse(
          new AppException(400, ErrorCodes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS, "You are outside the permitted check-in area.", {
            distanceMeters: geofenceCheck.distanceMeters,
            allowedRadiusMeters: geofenceCheck.allowedRadiusMeters,
          }),
          { distanceMeters: geofenceCheck.distanceMeters, allowedRadiusMeters: geofenceCheck.allowedRadiusMeters, temporaryCheckInPointId },
        );
      }
    } else if (shift.site) {
      const distanceCheck = await this.geofenceValidation.check(dto.latitude, dto.longitude, shift.site.latitude, shift.site.longitude, shift.site.defaultGeofenceRadiusMeters);
      distanceFromSiteMeters = distanceCheck.distanceMeters;
    }

    // Step 9: the photos must be the worker's own, unused uploads (400 UPLOAD_NOT_FOUND otherwise).
    const attachmentOwner = { organizationId, workerProfileId: actor.workerProfileId };
    const attachments = { photoAssetIds: dto.photoAssetIds };
    await this.attachments.assertUsable(attachmentOwner, attachments);

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
          mockLocationState: dto.mockLocationState ?? null,
          locationSignals: dto.locationSignals ?? [],
          distanceFromSiteMeters,
          locationValidationStatus,
          temporaryCheckInPointId,
          appVersion: dto.appVersion,
        },
      });

      await this.rejectedAttempts.linkToNewEntry(tx, timeEntry);
      await this.attachments.attach(tx, attachmentOwner, timeEntry.id, attachments);

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
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.CLOCK_IN, shift.id);
    await this.notifyManagerAndOwners(organizationId, shift.managerId, shift.id, {
      type: NotificationType.WORKER_CLOCKED_IN,
      title: "Worker clocked in",
      managerBody: `A worker clocked in for "${shift.title}".`,
      ownerBody: `A worker clocked in for "${shift.title}".`,
      managerData: clockInData,
      ownerData: clockInData,
    });

    // The receipt (Step 9): the clock event (its id is the reference, with the server and device times), the entry and its shift.
    return { status: 201, body: { timeEntry: { ...timeEntry, shift: shiftColumns(shift) }, clockEvent } };
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

    // The mandatory summary (spec 21): typed text, or a voice note (Step 9: an uploaded VOICE_SUMMARY; the
    // legacy voiceNoteUrl still counts for older clients).
    const hasText = (dto.summaryText?.trim().length ?? 0) > 0;
    const hasVoiceNote = Boolean(dto.voiceNoteAssetId) || (dto.voiceNoteUrl?.trim().length ?? 0) > 0;
    if (!hasText && !hasVoiceNote) {
      throw new AppException(400, ErrorCodes.SUMMARY_REQUIRED, "A task summary (text or voice note) is required to clock out.");
    }

    const deviceTimestamp = new Date(dto.deviceTimestamp);
    const origin = dto.origin ?? EventOrigin.ONLINE;
    const mockSuspected = isMockLocationSuspected(dto);

    // The organization's limits (settings), read on every clock event.
    const settings = await this.settings.get(organizationId);
    const timeValidation = this.locationValidation.validateTime({
      deviceTimestamp,
      mockLocationSuspected: mockSuspected,
      origin,
      deviationLimitSeconds: settings.deviceTimeDeviationSeconds,
    });

    /** Stores the refused clock-out as evidence on the open entry (Step 5), then hands back the same error to throw. */
    const refuse = async (error: AppException) => {
      await this.rejectedAttempts.record({
        organizationId,
        workerProfileId: actor.workerProfileId!,
        shiftId: timeEntry.shiftId,
        timeEntryId: timeEntry.id,
        eventType: ClockEventType.CLOCK_OUT,
        origin,
        code: error.code,
        deviceTimestamp,
        deviationSeconds: timeValidation.deviationSeconds,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyMeters: dto.accuracyMeters,
        mockLocationSuspected: mockSuspected,
        mockLocationState: dto.mockLocationState ?? null,
      });
      return error;
    };

    if (timeValidation.rejectOnlineDeviation) {
      throw await refuse(
        new AppException(400, ErrorCodes.DEVICE_TIME_DEVIATION_EXCEEDED, "Your device clock appears out of sync. Please check your device time and try again.", {
          deviationSeconds: timeValidation.deviationSeconds,
        }),
      );
    }
    const locationValidationStatus = this.locationValidation.determineStatus(
      { deviceTimestamp, mockLocationSuspected: mockSuspected, origin },
      timeValidation,
    );
    if (locationValidationStatus === LocationValidationStatus.BLOCKED) {
      throw await refuse(
        new AppException(403, ErrorCodes.MOCK_LOCATION_BLOCKED, "Location could not be verified as genuine. Please disable mock-location tools and try again."),
      );
    }

    const serverReceivedAt = new Date();
    const effectiveAt = origin === EventOrigin.OFFLINE ? deviceTimestamp : serverReceivedAt;
    if (effectiveAt.getTime() <= timeEntry.clockInAt!.getTime()) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Clock-out must be after clock-in.");
    }
    const rawDurationMinutes = minutesBetween(timeEntry.clockInAt!, effectiveAt);

    // Step 9: the photos and the voice note must be the worker's own, unused uploads (400 UPLOAD_NOT_FOUND otherwise).
    const attachmentOwner = { organizationId, workerProfileId: actor.workerProfileId };
    const attachments = { photoAssetIds: dto.photoAssetIds, voiceNoteAssetId: dto.voiceNoteAssetId };
    await this.attachments.assertUsable(attachmentOwner, attachments);

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
          mockLocationState: dto.mockLocationState ?? null,
          locationSignals: dto.locationSignals ?? [],
          locationValidationStatus,
          appVersion: dto.appVersion,
        },
      });

      await this.attachments.attach(tx, attachmentOwner, timeEntry.id, attachments);

      await tx.dailySummary.create({
        data: {
          id: generateId(),
          timeEntryId: timeEntry.id,
          text: dto.summaryText,
          voiceNoteUrl: dto.voiceNoteUrl,
          voiceNoteAssetId: dto.voiceNoteAssetId ?? null,
          summarySource: dto.summarySource ?? (dto.voiceNoteAssetId ? SummarySource.VOICE : SummarySource.TYPED),
          transcription: dto.transcription ?? null,
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

    this.realtime.operationsChanged(organizationId, OperationsChangeKind.CLOCK_OUT, timeEntry.shiftId);
    await this.notifyClockOut(organizationId, actor.workerProfileId, timeEntry.shift.managerId, timeEntry.shift.title, rawDurationMinutes, {
      timeEntryId: timeEntry.id,
      shiftId: timeEntry.shiftId,
      clockOutAt: effectiveAt.toISOString(),
    }, timeEntry.businessDate);

    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntry.id }, include: { dailySummary: true } });
    // The public response is the closed entry, as before, plus (Step 9) what the app's receipt shows: the
    // clock-out event (its id is the reference, with the server and device times) and the shift.
    // `clockEvent` is also exposed beside `body` for internal callers (offline sync reads its status and id).
    return { status: 200, body: { ...updated, shift: shiftColumns(timeEntry.shift), clockEvent }, clockEvent };
  }

  /**
   * The shift's manager gets `managerBody` / `managerData`; every other
   * recipient who may see money (VIEW_FINANCIALS) gets `ownerBody` /
   * `ownerData`, and one who may not gets the manager copy. Only `ownerData`
   * may carry money (`*Agorot`): it is the counterpart of `ownerBody`'s cost
   * line. Who receives it follows the organization's notification settings,
   * the members' roles, and the projects a restricted member is limited to.
   */
  private async notifyManagerAndOwners(
    organizationId: string,
    managerUserId: string,
    shiftId: string,
    content: {
      type: typeof NotificationType.WORKER_CLOCKED_IN | typeof NotificationType.WORKER_CLOCKED_OUT;
      title: string;
      managerBody: string;
      ownerBody: string;
      managerData: NotificationData;
      ownerData: NotificationData;
      /** Mobile manager mode: what the notification asks the managers to settle (a clock-out: the entry to review). */
      subject?: SubjectRef;
    },
  ) {
    const recipients = await this.notificationAudience.recipients(organizationId, content.type, {
      managerUserId,
      context: await this.notificationAudience.contextOfShift(shiftId),
    });
    await this.notifications.notifyMany(
      recipients.map((recipient) => {
        const withMoney = recipient.financial && !recipient.isShiftManager;
        return {
          organizationId,
          recipientUserId: recipient.userId,
          type: content.type,
          title: content.title,
          body: withMoney ? content.ownerBody : content.managerBody,
          data: withMoney ? content.ownerData : withoutFinancialData(content.managerData),
          subject: content.subject,
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
    businessDate: string,
  ) {
    // The overtime threshold in force on the entry's business date (9 hours by default).
    const rules = await this.workRules.rulesOn(organizationId, businessDate);
    const regularMinutes = Math.min(rawDurationMinutes, rules.overtimeThresholdMinutes);
    const overtimeMinutes = Math.max(0, rawDurationMinutes - rules.overtimeThresholdMinutes);
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
      }, rules);
      const ils = (estimate.totalCompensationAgorot / 100).toFixed(2);
      ownerBody = `Worker clocked out of "${shiftTitle}".\nTotal: ${formatHm(rawDurationMinutes)}\nRegular: ${formatHm(regularMinutes)}\nOvertime: ${formatHm(overtimeMinutes)}\nEstimated cost: ₪${ils}`;
      // Owner-only: the same estimate as the cost line in ownerBody.
      ownerData = { ...managerData, estimatedCostAgorot: estimate.totalCompensationAgorot };
    }

    await this.notifyManagerAndOwners(organizationId, managerUserId, refs.shiftId, {
      type: NotificationType.WORKER_CLOCKED_OUT,
      title: "Worker clocked out",
      managerBody,
      ownerBody,
      managerData,
      ownerData,
      subject: { kind: NotificationSubjectKind.ATTENDANCE, refId: refs.timeEntryId },
    });
  }
}

/**
 * The phone's mock-location verdict. Step 9: `mockLocationState: DETECTED`
 * is refused exactly like `mockLocationSuspected: true` (the existing rule);
 * NOT_DETECTED and UNAVAILABLE never refuse anything on their own.
 */
function isMockLocationSuspected(dto: { mockLocationSuspected?: boolean; mockLocationState?: string }): boolean {
  return (dto.mockLocationSuspected ?? false) || dto.mockLocationState === MockLocationState.DETECTED;
}

/** The shift's own columns for the receipt, without the geofence and site loaded with it. */
function shiftColumns(shift: Shift & { geofence?: unknown; site?: unknown }): Shift {
  const { geofence: _geofence, site: _site, ...columns } = shift;
  return columns;
}
