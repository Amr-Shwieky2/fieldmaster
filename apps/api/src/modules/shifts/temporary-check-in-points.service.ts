import { Injectable } from "@nestjs/common";
import { ShiftStatus, TemporaryPointStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { Permission, hasPermission } from "../../common/auth/permissions";
import { scopeOf, shiftScopeWhere } from "../../common/scope/scope-filters";
import { OrganizationSettingsService } from "../../common/settings/organization-settings.service";
import { OperationsChangeKind, RealtimeEventsService } from "../notifications/realtime-events";
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
 *
 * Who may open or close one: a manager (Owner / Field Manager), or a
 * temporary supervisor of that shift whose assignment is ACTIVE right now
 * and allows it (`canOpenCheckInPoints`, Step 6) -- checked live each time.
 */
@Injectable()
export class TemporaryCheckInPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly temporarySupervisors: TemporarySupervisorsService,
    private readonly settings: OrganizationSettingsService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  async create(organizationId: string, dto: CreateTemporaryCheckInPointDto, actor: AuthenticatedUser, correlationId: string) {
    const isManager = hasPermission(actor, Permission.MANAGE_TEMP_SUPERVISORS);
    // A manager restricted to some projects reaches only those projects' shifts; a temporary supervisor reaches the shift they supervise.
    const shift = UUID_PATTERN.test(dto.shiftId)
      ? await this.prisma.shift.findFirst({ where: { id: dto.shiftId, organizationId, ...(isManager ? (shiftScopeWhere(scopeOf(actor)) ?? {}) : {}) } })
      : null;
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

    if (!isManager) await this.assertSupervisorMayManagePoints(dto.shiftId, actor);
    if (shift.status === ShiftStatus.CLOSED || shift.status === ShiftStatus.CANCELLED) {
      throw new AppException(409, ErrorCodes.SHIFT_NOT_OPEN, "This shift is closed or cancelled.");
    }
    const settings = await this.settings.get(organizationId);

    const point = await this.prisma.temporaryCheckInPoint.create({
      data: {
        id: generateId(),
        organizationId,
        shiftId: dto.shiftId,
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters ?? settings.temporaryPointRadiusMeters,
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
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.TEMPORARY_POINT, dto.shiftId);

    return point;
  }

  async revoke(organizationId: string, id: string, actor: AuthenticatedUser, correlationId: string) {
    const isManager = hasPermission(actor, Permission.MANAGE_TEMP_SUPERVISORS);
    const point = UUID_PATTERN.test(id)
      ? await this.prisma.temporaryCheckInPoint.findFirst({ where: { id, organizationId, ...(isManager ? { shift: shiftScopeWhere(scopeOf(actor)) ?? {} } : {}) } })
      : null;
    if (!point) throw new AppException(404, ErrorCodes.NOT_FOUND, "Check-in point not found.");
    if (!isManager) await this.assertSupervisorMayManagePoints(point.shiftId, actor);
    if (!this.isCurrentlyActive(point)) throw new AppException(409, ErrorCodes.CONFLICT, "This check-in point is already closed or expired.");

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
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.TEMPORARY_POINT, point.shiftId);

    return updated;
  }

  async listForShift(organizationId: string, shiftId: string) {
    return this.prisma.temporaryCheckInPoint.findMany({ where: { organizationId, shiftId }, orderBy: { createdAt: "desc" } });
  }

  isCurrentlyActive(point: { status: string; expiresAt: Date; revokedAt: Date | null }): boolean {
    return point.status === TemporaryPointStatus.ACTIVE && point.revokedAt === null && point.expiresAt > new Date();
  }

  /** A non-manager needs an ACTIVE supervisor assignment for this shift that allows managing points. */
  private async assertSupervisorMayManagePoints(shiftId: string, actor: AuthenticatedUser): Promise<void> {
    const assignment = actor.workerProfileId ? await this.temporarySupervisors.findActiveAssignmentForShift(shiftId, actor.workerProfileId) : null;
    if (!assignment) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You are not authorized to manage check-in points for this shift.");
    }
    if (!assignment.canOpenCheckInPoints) {
      throw new AppException(403, ErrorCodes.TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS, "This temporary supervisor may not open or close check-in points.");
    }
  }
}
