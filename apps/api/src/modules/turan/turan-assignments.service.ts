import { Injectable } from "@nestjs/common";
import { NotificationType, TuranStatus, TuranType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { CreateTuranAssignmentDto } from "./dto/create-turan-assignment.dto";

@Injectable()
export class TuranAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(organizationId: string, dto: CreateTuranAssignmentDto, actor: AuthenticatedUser, correlationId: string) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "endAt must be after startAt.");

    const worker = await this.prisma.workerProfile.findFirst({ where: { id: dto.assignedWorkerProfileId, organizationId }, include: { membership: true } });
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    if (!dto.confirmOverlap) {
      const overlap = await this.prisma.turanAssignment.findFirst({
        where: {
          assignedWorkerProfileId: dto.assignedWorkerProfileId,
          status: { in: [TuranStatus.SCHEDULED, TuranStatus.ACTIVE] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });
      if (overlap) {
        throw new AppException(409, ErrorCodes.CONFLICT, "This worker already has an overlapping Turan assignment. Set confirmOverlap to proceed anyway.", {
          conflictingAssignmentId: overlap.id,
        });
      }
    }

    const assignment = await this.prisma.turanAssignment.create({
      data: {
        id: generateId(),
        organizationId,
        turanType: dto.turanType,
        startAt,
        endAt,
        notes: dto.notes,
        assignedWorkerProfileId: dto.assignedWorkerProfileId,
        backupWorkerProfileId: dto.backupWorkerProfileId,
        createdBy: actor.sub,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TURAN_ASSIGNMENT_CREATED",
      entityType: "TuranAssignment",
      entityId: assignment.id,
      correlationId,
    });

    await this.notifications.notify({
      organizationId,
      recipientUserId: worker.membership.userId,
      type: NotificationType.TURAN_ASSIGNMENT_CREATED,
      title: `${dto.turanType === TuranType.NIGHT_TURAN ? "Night" : "Day"} Turan assignment`,
      body: `You've been scheduled for ${dto.turanType.replace("_", " ").toLowerCase()} from ${startAt.toISOString()} to ${endAt.toISOString()}.`,
    });

    return assignment;
  }

  async cancel(organizationId: string, id: string, actor: AuthenticatedUser, correlationId: string) {
    const assignment = await this.prisma.turanAssignment.findFirst({ where: { id, organizationId }, include: { assignedWorker: { include: { membership: true } } } });
    if (!assignment) throw new AppException(404, ErrorCodes.NOT_FOUND, "Turan assignment not found.");

    const updated = await this.prisma.turanAssignment.update({ where: { id }, data: { status: TuranStatus.CANCELLED } });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TURAN_ASSIGNMENT_CANCELLED",
      entityType: "TuranAssignment",
      entityId: id,
      correlationId,
    });

    await this.notifications.notify({
      organizationId,
      recipientUserId: assignment.assignedWorker.membership.userId,
      type: NotificationType.TURAN_ASSIGNMENT_CHANGED,
      title: "Turan assignment cancelled",
      body: "One of your scheduled Turan assignments was cancelled.",
    });

    return updated;
  }

  async list(organizationId: string, filters: { turanType?: TuranType; from?: string; to?: string; workerProfileId?: string }) {
    return this.prisma.turanAssignment.findMany({
      where: {
        organizationId,
        ...(filters.turanType ? { turanType: filters.turanType } : {}),
        ...(filters.workerProfileId ? { assignedWorkerProfileId: filters.workerProfileId } : {}),
        ...(filters.from ? { endAt: { gte: new Date(filters.from) } } : {}),
        ...(filters.to ? { startAt: { lte: new Date(filters.to) } } : {}),
      },
      orderBy: { startAt: "asc" },
    });
  }

  /** True when this worker has an active/scheduled Night Turan assignment covering `at`. */
  async isEligibleForEmergency(workerProfileId: string, at: Date): Promise<string | null> {
    const assignment = await this.prisma.turanAssignment.findFirst({
      where: {
        assignedWorkerProfileId: workerProfileId,
        turanType: TuranType.NIGHT_TURAN,
        status: { in: [TuranStatus.SCHEDULED, TuranStatus.ACTIVE] },
        startAt: { lte: at },
        endAt: { gte: at },
      },
    });
    return assignment?.id ?? null;
  }
}
