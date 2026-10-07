import { Injectable } from "@nestjs/common";
import { NotificationType, ShiftStatus, ShiftType } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AssignmentKind } from "../notifications/notification-data";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { CreateShiftDto } from "./dto/create-shift.dto";

const LONG_RUNNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(organizationId: string, dto: CreateShiftDto, actor: AuthenticatedUser, correlationId: string) {
    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    if (end <= start) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "scheduledEnd must be after scheduledStart.");
    }

    const shift = await this.prisma.shift.create({
      data: {
        id: generateId(),
        organizationId,
        projectId: dto.projectId,
        siteId: dto.siteId,
        geofenceId: dto.geofenceId,
        shiftType: dto.shiftType,
        title: dto.title,
        description: dto.description,
        scheduledStart: start,
        scheduledEnd: end,
        checkInMethod: dto.checkInMethod ?? "GEOFENCED",
        graceMinutes: dto.graceMinutes ?? 10,
        businessDate: toBusinessDate(start),
        managerId: dto.managerId ?? actor.sub,
        status: ShiftStatus.PUBLISHED,
        flaggedLongRunning: end.getTime() - start.getTime() > LONG_RUNNING_THRESHOLD_MS,
        createdBy: actor.sub,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "SHIFT_CREATED",
      entityType: "Shift",
      entityId: shift.id,
      correlationId,
    });

    return shift;
  }

  async list(
    organizationId: string,
    filters: { status?: ShiftStatus; businessDate?: string; shiftType?: ShiftType },
    scope?: { workerProfileId: string },
  ) {
    return this.prisma.shift.findMany({
      where: {
        organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.businessDate ? { businessDate: filters.businessDate } : {}),
        ...(filters.shiftType ? { shiftType: filters.shiftType } : {}),
        // Workers (no MANAGE_SHIFTS permission) only ever see shifts
        // they're actually assigned to -- managers see the full org list.
        ...(scope ? { assignments: { some: { workerProfileId: scope.workerProfileId, removedAt: null } } } : {}),
      },
      include: { assignments: { where: { removedAt: null } }, site: true, project: true },
      orderBy: { scheduledStart: "desc" },
      take: 200,
    });
  }

  async getById(organizationId: string, id: string, scope?: { workerProfileId: string }) {
    const shift = await this.prisma.shift.findFirst({
      where: {
        id,
        organizationId,
        ...(scope ? { assignments: { some: { workerProfileId: scope.workerProfileId, removedAt: null } } } : {}),
      },
      include: {
        assignments: { where: { removedAt: null }, include: { worker: { include: { membership: { include: { user: true } } } } } },
        site: true,
        project: true,
        geofence: true,
        temporaryCheckInPoints: true,
      },
    });
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");
    return shift;
  }

  async assignWorker(organizationId: string, shiftId: string, workerProfileId: string, actor: AuthenticatedUser, correlationId: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

    const worker = await this.prisma.workerProfile.findFirst({ where: { id: workerProfileId, organizationId } });
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    if (shift.shiftType !== ShiftType.EMERGENCY_CALLOUT) {
      const overlapping = await this.prisma.shiftAssignment.findFirst({
        where: {
          workerProfileId,
          removedAt: null,
          shift: {
            id: { not: shiftId },
            shiftType: { not: ShiftType.EMERGENCY_CALLOUT },
            status: { notIn: [ShiftStatus.CANCELLED, ShiftStatus.CLOSED] },
            scheduledStart: { lt: shift.scheduledEnd },
            scheduledEnd: { gt: shift.scheduledStart },
          },
        },
      });
      if (overlapping) {
        throw new AppException(409, ErrorCodes.CONFLICT, "This worker is already assigned to an overlapping shift.");
      }
    }

    const assignment = await this.prisma.shiftAssignment.upsert({
      where: { shiftId_workerProfileId: { shiftId, workerProfileId } },
      create: { id: generateId(), shiftId, workerProfileId, assignedBy: actor.sub },
      update: { removedAt: null, assignedBy: actor.sub },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "SHIFT_WORKER_ASSIGNED",
      entityType: "ShiftAssignment",
      entityId: assignment.id,
      correlationId,
    });

    const membership = await this.prisma.organizationMembership.findUnique({ where: { id: worker.membershipId } });
    if (membership) {
      const userId = membership.userId;
      await this.notifications.notify({
        organizationId,
        recipientUserId: userId,
        type: NotificationType.TURAN_ASSIGNMENT_CREATED,
        title: "New shift assignment",
        body: `You've been assigned to "${shift.title}" starting ${shift.scheduledStart.toISOString()}.`,
        // Sent with the TURAN_ASSIGNMENT_CREATED type; assignmentKind tells clients it is a shift.
        data: {
          assignmentKind: AssignmentKind.SHIFT,
          shiftId: shift.id,
          shiftTitle: shift.title,
          startAt: shift.scheduledStart.toISOString(),
          endAt: shift.scheduledEnd.toISOString(),
        },
      });
    }

    return assignment;
  }

  async close(organizationId: string, shiftId: string, actor: AuthenticatedUser, correlationId: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

    const updated = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.shift.update({
        where: { id: shiftId },
        data: { status: ShiftStatus.CLOSED, closedAt: new Date(), closedBy: actor.sub },
      });
      await tx.temporaryCheckInPoint.updateMany({
        where: { shiftId, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
      return closed;
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "SHIFT_CLOSED",
      entityType: "Shift",
      entityId: shiftId,
      correlationId,
    });

    return updated;
  }
}
