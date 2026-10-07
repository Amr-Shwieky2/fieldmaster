import { Injectable } from "@nestjs/common";
import {
  CheckInMethod,
  ClockEventType,
  EmergencyAuthorizationSource,
  EventOrigin,
  LocationValidationStatus,
  NotificationType,
  OrgRole,
  ShiftStatus,
  ShiftType,
  TimeEntryStatus,
  TuranStatus,
} from "@fieldmaster/shared-types";
import { calculateShiftCompensation, computeEmergencyCompensation, toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { NotificationsService } from "../notifications/notifications.service";
import { loadWorkerName, withoutFinancialData, type NotificationData } from "../notifications/notification-data";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { TuranAssignmentsService } from "./turan-assignments.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { StartEmergencyCalloutDto, EndEmergencyCalloutDto } from "./dto/emergency-callout.dto";

const PLACEHOLDER_SHIFT_DURATION_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class EmergencyCalloutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly turanAssignments: TuranAssignmentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async start(organizationId: string, dto: StartEmergencyCalloutDto, actor: AuthenticatedUser, idempotencyKey: string | undefined, correlationId: string) {
    const result = await this.idempotencyService.withIdempotency(idempotencyKey, "emergency-start", dto, async () => {
      const isManager = actor.role === OrgRole.OWNER || actor.role === OrgRole.FIELD_MANAGER;
      const workerProfileId = dto.workerProfileId && isManager ? dto.workerProfileId : actor.workerProfileId;
      if (!workerProfileId) throw new AppException(403, ErrorCodes.FORBIDDEN, "No worker profile to start an emergency call-out for.");

      const worker = await this.prisma.workerProfile.findFirst({ where: { id: workerProfileId, organizationId }, include: { membership: true } });
      if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

      const existingActive = await this.prisma.timeEntry.findFirst({ where: { workerProfileId, status: TimeEntryStatus.ACTIVE } });
      if (existingActive) {
        throw new AppException(409, ErrorCodes.ACTIVE_TIME_ENTRY_EXISTS, "This worker already has an open clock-in or emergency call-out.");
      }

      let authorizationSource: EmergencyAuthorizationSource;
      let authorizedBy: string | null = null;
      let turanAssignmentId: string | null = null;

      const actualStartClick = new Date();

      if (dto.workerProfileId && isManager) {
        authorizationSource = EmergencyAuthorizationSource.MANUAL_MANAGER_AUTHORIZATION;
        authorizedBy = actor.sub;
      } else {
        const eligibleAssignmentId = await this.turanAssignments.isEligibleForEmergency(workerProfileId, actualStartClick);
        if (!eligibleAssignmentId) {
          throw new AppException(403, ErrorCodes.EMERGENCY_NOT_ELIGIBLE, "You do not have an active Night Turan assignment authorizing an emergency call-out.");
        }
        authorizationSource = EmergencyAuthorizationSource.NIGHT_TURAN_ASSIGNMENT;
        turanAssignmentId = eligibleAssignmentId;
      }

      const compensatedStart = new Date(actualStartClick.getTime() - 60 * 60_000);

      const { timeEntry, callout } = await this.prisma.$transaction(async (tx) => {
        const shift = await tx.shift.create({
          data: {
            id: generateId(),
            organizationId,
            shiftType: ShiftType.EMERGENCY_CALLOUT,
            title: "Emergency Call-out",
            scheduledStart: compensatedStart,
            scheduledEnd: new Date(actualStartClick.getTime() + PLACEHOLDER_SHIFT_DURATION_MS),
            checkInMethod: CheckInMethod.FLEXI_CHECK,
            businessDate: toBusinessDate(compensatedStart),
            managerId: authorizedBy ?? actor.sub,
            status: ShiftStatus.ACTIVE,
            createdBy: actor.sub,
          },
        });

        await tx.shiftAssignment.create({
          data: { id: generateId(), shiftId: shift.id, workerProfileId, assignedBy: actor.sub },
        });

        const timeEntry = await tx.timeEntry.create({
          data: {
            id: generateId(),
            organizationId,
            workerProfileId,
            shiftId: shift.id,
            status: TimeEntryStatus.ACTIVE,
            businessDate: toBusinessDate(compensatedStart),
            clockInAt: compensatedStart,
            checkInMethod: CheckInMethod.FLEXI_CHECK,
            isEmergency: true,
          },
        });

        await tx.clockEvent.create({
          data: {
            id: generateId(),
            timeEntryId: timeEntry.id,
            eventType: ClockEventType.CLOCK_IN,
            origin: EventOrigin.ONLINE,
            idempotencyKey: idempotencyKey ?? "none",
            deviceId: dto.deviceId,
            clientEventId: dto.clientEventId,
            deviceTimestamp: new Date(dto.deviceTimestamp),
            serverReceivedAt: actualStartClick,
            deviceTimeDeviationSeconds: Math.round(Math.abs(actualStartClick.getTime() - new Date(dto.deviceTimestamp).getTime()) / 1000),
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracyMeters: dto.accuracyMeters,
            locationValidationStatus: LocationValidationStatus.PASSED,
          },
        });

        const callout = await tx.emergencyCallout.create({
          data: {
            id: generateId(),
            organizationId,
            turanAssignmentId,
            workerProfileId,
            timeEntryId: timeEntry.id,
            authorizationSource,
            authorizedBy,
            actualStartClick,
            compensatedStart,
            startLatitude: dto.latitude,
            startLongitude: dto.longitude,
          },
        });

        if (turanAssignmentId) {
          await tx.turanAssignment.update({ where: { id: turanAssignmentId }, data: { status: TuranStatus.ACTIVE } });
        }

        return { timeEntry, callout };
      });

      await this.auditService.record({
        organizationId,
        actorUserId: actor.sub,
        action: "EMERGENCY_CALLOUT_STARTED",
        entityType: "EmergencyCallout",
        entityId: callout.id,
        correlationId,
      });

      await this.notifyOwnersAndManagers(organizationId, NotificationType.EMERGENCY_SHIFT_STARTED, "Emergency call-out started", "A worker started a Night Turan emergency call-out.", {
        timeEntryId: timeEntry.id,
        calloutId: callout.id,
        workerProfileId,
        workerName: await loadWorkerName(this.prisma, workerProfileId),
        startedAt: actualStartClick.toISOString(),
        compensatedStartAt: compensatedStart.toISOString(),
        authorizationSource,
      });

      return {
        status: 201,
        body: {
          timeEntryId: timeEntry.id,
          calloutId: callout.id,
          actualStartClick,
          compensatedStart,
          retroactiveMinutes: 60,
          explanation: "Your compensated start time is set to 60 minutes before you pressed Start, per policy.",
        },
      };
    });

    return result.body;
  }

  async end(organizationId: string, dto: EndEmergencyCalloutDto, actor: AuthenticatedUser, idempotencyKey: string | undefined, correlationId: string) {
    const result = await this.idempotencyService.withIdempotency(idempotencyKey, "emergency-end", dto, async () => {
      if (!actor.workerProfileId) throw new AppException(403, ErrorCodes.FORBIDDEN, "Only time-trackable workers can end a call-out.");

      const timeEntry = await this.prisma.timeEntry.findFirst({
        where: { workerProfileId: actor.workerProfileId, status: TimeEntryStatus.ACTIVE, isEmergency: true },
        include: { emergencyCallout: true },
      });
      if (!timeEntry || !timeEntry.emergencyCallout) {
        throw new AppException(409, ErrorCodes.NO_ACTIVE_TIME_ENTRY, "You do not have an active emergency call-out to end.");
      }

      const hasSummary = (dto.summaryText && dto.summaryText.trim().length > 0) || (dto.voiceNoteUrl && dto.voiceNoteUrl.trim().length > 0);
      if (!hasSummary) {
        throw new AppException(400, ErrorCodes.SUMMARY_REQUIRED, "A task or emergency repair summary is required to end the call-out.");
      }

      const actualEndClick = new Date();
      const compensation = computeEmergencyCompensation(timeEntry.emergencyCallout.actualStartClick, actualEndClick);

      await this.prisma.$transaction(async (tx) => {
        await tx.clockEvent.create({
          data: {
            id: generateId(),
            timeEntryId: timeEntry.id,
            eventType: ClockEventType.CLOCK_OUT,
            origin: EventOrigin.ONLINE,
            idempotencyKey: idempotencyKey ?? "none",
            deviceId: dto.deviceId,
            clientEventId: dto.clientEventId,
            deviceTimestamp: new Date(dto.deviceTimestamp),
            serverReceivedAt: actualEndClick,
            deviceTimeDeviationSeconds: Math.round(Math.abs(actualEndClick.getTime() - new Date(dto.deviceTimestamp).getTime()) / 1000),
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracyMeters: dto.accuracyMeters,
            locationValidationStatus: LocationValidationStatus.PASSED,
          },
        });

        await tx.dailySummary.create({
          data: {
            id: generateId(),
            timeEntryId: timeEntry.id,
            text: dto.summaryText,
            voiceNoteUrl: dto.voiceNoteUrl,
            taskCategory: dto.taskCategory,
          },
        });

        await tx.timeEntry.update({
          where: { id: timeEntry.id },
          data: { clockOutAt: compensation.compensatedEnd, rawDurationMinutes: compensation.compensatedDurationMinutes, status: TimeEntryStatus.PENDING_APPROVAL },
        });

        await tx.emergencyCallout.update({
          where: { id: timeEntry.emergencyCallout!.id },
          data: {
            actualEndClick,
            compensatedEnd: compensation.compensatedEnd,
            actualWorkedMinutes: compensation.actualWorkedMinutes,
            returnBufferMinutes: compensation.returnBufferMinutes,
            compensatedDurationMinutes: compensation.compensatedDurationMinutes,
            endLatitude: dto.latitude,
            endLongitude: dto.longitude,
          },
        });

        if (timeEntry.emergencyCallout!.turanAssignmentId) {
          await tx.turanAssignment.update({
            where: { id: timeEntry.emergencyCallout!.turanAssignmentId! },
            data: { status: TuranStatus.COMPLETED },
          });
        }
      });

      await this.auditService.record({
        organizationId,
        actorUserId: actor.sub,
        action: "EMERGENCY_CALLOUT_ENDED",
        entityType: "EmergencyCallout",
        entityId: timeEntry.emergencyCallout.id,
        correlationId,
      });

      await this.notifyEmergencyEnd(organizationId, actor.workerProfileId, compensation.compensatedDurationMinutes, {
        timeEntryId: timeEntry.id,
        calloutId: timeEntry.emergencyCallout.id,
        endedAt: actualEndClick.toISOString(),
      });

      return {
        status: 200,
        body: {
          timeEntryId: timeEntry.id,
          actualEndClick,
          compensatedEnd: compensation.compensatedEnd,
          actualWorkedMinutes: compensation.actualWorkedMinutes,
          retroactiveMinutes: compensation.retroactiveMinutes,
          returnBufferMinutes: compensation.returnBufferMinutes,
          compensatedDurationMinutes: compensation.compensatedDurationMinutes,
        },
      };
    });

    return result.body;
  }

  /** Same text and data for Owners and Field Managers, so `data` must never carry money. */
  private async notifyOwnersAndManagers(organizationId: string, type: NotificationType, title: string, body: string, data: NotificationData) {
    const recipients = await this.prisma.organizationMembership.findMany({
      where: { organizationId, role: { in: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] }, status: "ACTIVE", archivedAt: null },
    });
    const sharedData = withoutFinancialData(data);
    await this.notifications.notifyMany(recipients.map((r) => ({ organizationId, recipientUserId: r.userId, type, title, body, data: sharedData })));
  }

  private async notifyEmergencyEnd(
    organizationId: string,
    workerProfileId: string,
    compensatedDurationMinutes: number,
    refs: { timeEntryId: string; calloutId: string; endedAt: string },
  ) {
    const formatHm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
    const owners = await this.prisma.organizationMembership.findMany({ where: { organizationId, role: OrgRole.OWNER, status: "ACTIVE", archivedAt: null } });
    const managers = await this.prisma.organizationMembership.findMany({ where: { organizationId, role: OrgRole.FIELD_MANAGER, status: "ACTIVE", archivedAt: null } });

    const managerBody = `Emergency call-out ended. Compensated duration: ${formatHm(compensatedDurationMinutes)}. Approval is required.`;
    // No money here: this is what Field Managers get.
    const managerData: NotificationData = {
      ...refs,
      workerProfileId,
      workerName: await loadWorkerName(this.prisma, workerProfileId),
      compensatedDurationMinutes,
    };
    let ownerBody = managerBody;
    let ownerData: NotificationData = managerData;

    const activeCompensation = await this.prisma.compensationProfile.findFirst({
      where: { workerProfileId, effectiveStartDate: { lte: new Date() }, OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: new Date() } }] },
      orderBy: { effectiveStartDate: "desc" },
    });
    if (activeCompensation) {
      const estimate = calculateShiftCompensation({
        compensationType: activeCompensation.compensationType,
        approvedMinutes: compensatedDurationMinutes,
        fullDayCredit: false,
        dailyBaseRateAgorot: activeCompensation.dailyBaseRateAgorot ?? undefined,
        baseHourlyRateAgorot: activeCompensation.baseHourlyRateAgorot ?? undefined,
        overtimeHourlyRateAgorot: activeCompensation.overtimeHourlyRateAgorot,
      });
      ownerBody = `Emergency call-out ended. Compensated duration: ${formatHm(compensatedDurationMinutes)}. Estimated cost: ₪${(estimate.totalCompensationAgorot / 100).toFixed(2)}`;
      // Owner-only: the same estimate as the cost line in ownerBody.
      ownerData = { ...managerData, estimatedCostAgorot: estimate.totalCompensationAgorot };
    }

    await this.notifications.notifyMany([
      ...owners.map((o) => ({ organizationId, recipientUserId: o.userId, type: NotificationType.EMERGENCY_SHIFT_ENDED, title: "Emergency call-out ended", body: ownerBody, data: ownerData })),
      ...managers.map((m) => ({
        organizationId,
        recipientUserId: m.userId,
        type: NotificationType.EMERGENCY_SHIFT_ENDED,
        title: "Emergency call-out ended",
        body: managerBody,
        data: withoutFinancialData(managerData),
      })),
    ]);
  }
}
