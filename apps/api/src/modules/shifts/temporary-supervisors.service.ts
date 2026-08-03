import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { AssignTemporarySupervisorDto } from "./dto/temporary-supervisor.dto";

@Injectable()
export class TemporarySupervisorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async assign(organizationId: string, shiftId: string, dto: AssignTemporarySupervisorDto, actor: AuthenticatedUser, correlationId: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

    const worker = await this.prisma.workerProfile.findFirst({ where: { id: dto.workerProfileId, organizationId } });
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const assignment = await this.prisma.temporarySupervisorAssignment.create({
      data: {
        id: generateId(),
        shiftId,
        workerProfileId: dto.workerProfileId,
        activatedAt: dto.activatedAt ? new Date(dto.activatedAt) : new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : shift.scheduledEnd,
        assignedBy: actor.sub,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TEMPORARY_SUPERVISOR_ASSIGNED",
      entityType: "TemporarySupervisorAssignment",
      entityId: assignment.id,
      correlationId,
    });

    return assignment;
  }

  async revoke(organizationId: string, id: string, actor: AuthenticatedUser, correlationId: string) {
    const assignment = await this.prisma.temporarySupervisorAssignment.findFirst({
      where: { id, shift: { organizationId } },
    });
    if (!assignment) throw new AppException(404, ErrorCodes.NOT_FOUND, "Assignment not found.");

    const updated = await this.prisma.temporarySupervisorAssignment.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy: actor.sub },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TEMPORARY_SUPERVISOR_REVOKED",
      entityType: "TemporarySupervisorAssignment",
      entityId: id,
      correlationId,
    });

    return updated;
  }

  /** True capability check: active only within its window, and not revoked. */
  async isActiveSupervisorForShift(shiftId: string, workerProfileId: string): Promise<boolean> {
    const now = new Date();
    const assignment = await this.prisma.temporarySupervisorAssignment.findFirst({
      where: { shiftId, workerProfileId, revokedAt: null, activatedAt: { lte: now }, expiresAt: { gt: now } },
    });
    return assignment !== null;
  }
}
