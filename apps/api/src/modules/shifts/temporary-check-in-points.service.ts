import { Injectable } from "@nestjs/common";
import { TemporaryPointStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { TemporarySupervisorsService } from "./temporary-supervisors.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { CreateTemporaryCheckInPointDto } from "./dto/temporary-check-in-point.dto";

/**
 * Temporary check-in points auto-expire (spec section 18) via two layers:
 * eager expiry when the parent shift closes (ShiftsService.close) and a
 * lazy `isCurrentlyActive` check here applied at every read/use path, so no
 * background sweep job is required for correctness -- points past their
 * expiresAt are simply never treated as usable, even if their DB `status`
 * column hasn't been flipped yet.
 */
@Injectable()
export class TemporaryCheckInPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly temporarySupervisors: TemporarySupervisorsService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateTemporaryCheckInPointDto,
    actor: AuthenticatedUser,
    correlationId: string,
  ) {
    const shift = await this.prisma.shift.findFirst({ where: { id: dto.shiftId, organizationId } });
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

    const isManager = actor.role === "OWNER" || actor.role === "FIELD_MANAGER";
    const isTempSupervisor =
      actor.workerProfileId !== null &&
      (await this.temporarySupervisors.isActiveSupervisorForShift(dto.shiftId, actor.workerProfileId));

    if (!isManager && !isTempSupervisor) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You are not authorized to open a check-in point for this shift.");
    }

    const point = await this.prisma.temporaryCheckInPoint.create({
      data: {
        id: generateId(),
        organizationId,
        shiftId: dto.shiftId,
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters ?? 100,
        createdBy: actor.sub,
        managerAuthorizedBy: isManager ? actor.sub : shift.managerId,
        expiresAt: shift.scheduledEnd,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TEMPORARY_CHECK_IN_POINT_CREATED",
      entityType: "TemporaryCheckInPoint",
      entityId: point.id,
      correlationId,
    });

    return point;
  }

  async revoke(organizationId: string, id: string, actor: AuthenticatedUser, correlationId: string) {
    const point = await this.prisma.temporaryCheckInPoint.findFirst({ where: { id, organizationId } });
    if (!point) throw new AppException(404, ErrorCodes.NOT_FOUND, "Check-in point not found.");

    const updated = await this.prisma.temporaryCheckInPoint.update({
      where: { id },
      data: { status: TemporaryPointStatus.REVOKED, revokedAt: new Date(), revokedBy: actor.sub },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TEMPORARY_CHECK_IN_POINT_REVOKED",
      entityType: "TemporaryCheckInPoint",
      entityId: id,
      correlationId,
    });

    return updated;
  }

  async listForShift(organizationId: string, shiftId: string) {
    return this.prisma.temporaryCheckInPoint.findMany({ where: { organizationId, shiftId }, orderBy: { createdAt: "desc" } });
  }

  isCurrentlyActive(point: { status: string; expiresAt: Date; revokedAt: Date | null }): boolean {
    return point.status === TemporaryPointStatus.ACTIVE && point.revokedAt === null && point.expiresAt > new Date();
  }
}
