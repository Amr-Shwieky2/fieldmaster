import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AccountStatus, NotificationType, ShiftStatus, ShiftType, TemporaryPointStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AssignmentKind } from "../notifications/notification-data";
import { generateId } from "../../common/ids";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { OrganizationSettingsService } from "../../common/settings/organization-settings.service";
import { OperationsChangeKind, RealtimeEventsService } from "../notifications/realtime-events";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { scopeOf, shiftInScope, shiftScopeWhere, workerScopeWhere } from "../../common/scope/scope-filters";
import { projectSelectFor } from "../sites/project-fields";
import type { CreateShiftDto } from "./dto/create-shift.dto";
import { listOrPage, type PageWindow } from "../../common/validation/page-query";

const LONG_RUNNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: OrganizationSettingsService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /**
   * Mobile manager mode: the workers a new shift from `start` to `end` can
   * have (those of the caller's projects when restricted), each with their
   * shifts overlapping that time -- the API refuses those assignments.
   */
  async assignableWorkers(organizationId: string, startText: string | undefined, endText: string | undefined, viewer: AuthenticatedUser) {
    const start = startText ? new Date(startText) : null;
    const end = endText ? new Date(endText) : null;
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime()) || end <= start) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "start and end must be ISO instants, end after start.", { field: "start" });
    }
    const workers = await this.prisma.workerProfile.findMany({
      where: {
        organizationId,
        archivedAt: null,
        membership: { status: AccountStatus.ACTIVE, isTimeTrackable: true, archivedAt: null },
        ...(workerScopeWhere(scopeOf(viewer)) ?? {}),
      },
      select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } },
    });
    const conflicts = await this.overlapping(this.prisma, workers.map((worker) => worker.id), start, end);
    return workers
      .map((worker) => ({ workerProfileId: worker.id, fullLegalName: worker.membership.user.fullLegalName, conflicts: conflicts.get(worker.id) ?? [] }))
      .sort((a, b) => a.fullLegalName.localeCompare(b.fullLegalName, "ar"));
  }

  /** Each worker's assigned shifts overlapping [start, end) (not cancelled or closed; emergency call-outs never conflict). */
  private async overlapping(client: Pick<Prisma.TransactionClient, "shiftAssignment">, workerProfileIds: readonly string[], start: Date, end: Date) {
    if (workerProfileIds.length === 0) return new Map<string, { shiftId: string; title: string; scheduledStart: string; scheduledEnd: string }[]>();
    const rows = await client.shiftAssignment.findMany({
      where: {
        workerProfileId: { in: [...workerProfileIds] },
        removedAt: null,
        shift: {
          shiftType: { not: ShiftType.EMERGENCY_CALLOUT },
          status: { notIn: [ShiftStatus.CANCELLED, ShiftStatus.CLOSED] },
          scheduledStart: { lt: end },
          scheduledEnd: { gt: start },
        },
      },
      select: { workerProfileId: true, shift: { select: { id: true, title: true, scheduledStart: true, scheduledEnd: true } } },
    });
    const byWorker = new Map<string, { shiftId: string; title: string; scheduledStart: string; scheduledEnd: string }[]>();
    for (const row of rows) {
      const list = byWorker.get(row.workerProfileId) ?? [];
      list.push({ shiftId: row.shift.id, title: row.shift.title, scheduledStart: row.shift.scheduledStart.toISOString(), scheduledEnd: row.shift.scheduledEnd.toISOString() });
      byWorker.set(row.workerProfileId, list);
    }
    return byWorker;
  }

  async create(organizationId: string, dto: CreateShiftDto, actor: AuthenticatedUser, correlationId: string) {
    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    if (end <= start) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "scheduledEnd must be after scheduledStart.");
    }
    if (dto.workerProfileIds) return this.createWithWorkers(organizationId, dto, start, end, actor, correlationId);
    const settings = await this.settings.get(organizationId);
    // A member restricted to some projects creates shifts in those projects only.
    if (!shiftInScope(scopeOf(actor), { projectId: dto.projectId ?? null, siteId: dto.siteId ?? null })) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "This project or site is outside the projects you are restricted to.");
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
        // The organization's default (settings) unless the shift sets its own.
        graceMinutes: dto.graceMinutes ?? settings.defaultGraceMinutes,
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
    viewer: AuthenticatedUser,
    scope?: { workerProfileId: string },
    window: PageWindow | null = null,
  ) {
    const where = {
      organizationId,
      ...(scope ? {} : (shiftScopeWhere(scopeOf(viewer)) ?? {})),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.businessDate ? { businessDate: filters.businessDate } : {}),
      ...(filters.shiftType ? { shiftType: filters.shiftType } : {}),
      // Workers (no MANAGE_SHIFTS permission) only ever see shifts
      // they're actually assigned to -- managers see the full org list.
      ...(scope ? { assignments: { some: { workerProfileId: scope.workerProfileId, removedAt: null } } } : {}),
    };
    // The 200 latest, or one page of all of them (`?page=` / `?pageSize=`).
    return listOrPage(
      window,
      (range) =>
        this.prisma.shift.findMany({
          where,
          // The project budget is Owner-only: everyone else's query never reads it.
          // A worker sees only their own assignment, never who else is on the shift (Step 9: no other worker's data).
          include: {
            assignments: { where: { removedAt: null, ...(scope ? { workerProfileId: scope.workerProfileId } : {}) } },
            site: true,
            project: { select: projectSelectFor(viewer) },
          },
          orderBy: [{ scheduledStart: "desc" }, { id: "desc" }],
          skip: range.skip,
          take: range.take ?? 200,
        }),
      () => this.prisma.shift.count({ where }),
    );
  }

  /**
   * One shift. Step 9 adds, for everyone, `managerName` (the shift manager's
   * full name). A Worker (only for a shift they are assigned to) gets what the
   * app's shift screen shows: the project's name (never its budget), the site
   * with its instructions and position, the geofence (center, radius, required
   * GPS accuracy), the check-in method, and only the temporary check-in points
   * usable right now (active, not revoked, not expired). Managers keep every
   * point, as before.
   */
  async getById(organizationId: string, id: string, viewer: AuthenticatedUser, scope?: { workerProfileId: string }) {
    // A malformed id is simply not found (a @db.Uuid column would make Prisma throw a 500).
    if (!UUID_PATTERN.test(id)) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");
    const now = new Date();
    const shift = await this.prisma.shift.findFirst({
      where: {
        id,
        organizationId,
        ...(scope ? { assignments: { some: { workerProfileId: scope.workerProfileId, removedAt: null } } } : (shiftScopeWhere(scopeOf(viewer)) ?? {})),
      },
      include: {
        // Managers get every assignment with the worker's name and phone. A worker gets only their own assignment,
        // without user details: co-workers' names and phone numbers are not theirs to see (Step 9).
        assignments: scope
          ? { where: { removedAt: null, workerProfileId: scope.workerProfileId } }
          : { where: { removedAt: null }, include: { worker: { include: { membership: { include: { user: true } } } } } },
        site: true,
        project: { select: projectSelectFor(viewer) },
        geofence: true,
        temporaryCheckInPoints: scope
          ? { where: { status: TemporaryPointStatus.ACTIVE, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "asc" } }
          : true,
      },
    });
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");
    const manager = await this.prisma.user.findUnique({ where: { id: shift.managerId }, select: { fullLegalName: true } });
    return { ...shift, managerName: manager?.fullLegalName ?? null };
  }

  /**
   * Mobile manager mode: a shift and its workers in one transaction -- the
   * shift (its project and current geofence taken from the site), every
   * assignment and their audit rows are saved together, or nothing is (409
   * SHIFT_ASSIGNMENT_CONFLICT with `details.conflicts` when a worker already
   * has an overlapping shift). Concurrent creations in the organization are
   * checked one after the other. Each worker is told, as for one assignment.
   */
  private async createWithWorkers(organizationId: string, dto: CreateShiftDto, start: Date, end: Date, actor: AuthenticatedUser, correlationId: string) {
    const workerProfileIds = [...new Set(dto.workerProfileIds ?? [])];
    const site = dto.siteId && UUID_PATTERN.test(dto.siteId)
      ? await this.prisma.site.findFirst({
          where: { id: dto.siteId, organizationId, archivedAt: null },
          select: { id: true, projectId: true, geofences: { orderBy: { version: "desc" }, take: 1, select: { id: true } } },
        })
      : null;
    if (!site) throw new AppException(404, ErrorCodes.NOT_FOUND, "Site not found.");
    if (!shiftInScope(scopeOf(actor), { projectId: site.projectId, siteId: site.id })) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "This project or site is outside the projects you are restricted to.");
    }
    const workers = await this.prisma.workerProfile.findMany({ where: { id: { in: workerProfileIds }, organizationId, archivedAt: null }, select: { id: true, membershipId: true } });
    if (workers.length !== workerProfileIds.length) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");
    const settings = await this.settings.get(organizationId);

    const shift = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`shift_assignments:${organizationId}`}, 0))`;
      if (dto.shiftType !== ShiftType.EMERGENCY_CALLOUT) {
        const conflicts = await this.overlapping(tx, workerProfileIds, start, end);
        if (conflicts.size > 0) {
          throw new AppException(409, ErrorCodes.SHIFT_ASSIGNMENT_CONFLICT, "Some workers already have an overlapping shift.", {
            conflicts: [...conflicts.entries()].map(([workerProfileId, shifts]) => ({ workerProfileId, shifts })),
          });
        }
      }
      const created = await tx.shift.create({
        data: {
          id: generateId(),
          organizationId,
          projectId: site.projectId,
          siteId: site.id,
          geofenceId: dto.geofenceId ?? site.geofences[0]?.id ?? null,
          shiftType: dto.shiftType,
          title: dto.title,
          description: dto.description,
          scheduledStart: start,
          scheduledEnd: end,
          checkInMethod: dto.checkInMethod ?? "GEOFENCED",
          graceMinutes: dto.graceMinutes ?? settings.defaultGraceMinutes,
          businessDate: toBusinessDate(start),
          managerId: dto.managerId ?? actor.sub,
          status: ShiftStatus.PUBLISHED,
          flaggedLongRunning: end.getTime() - start.getTime() > LONG_RUNNING_THRESHOLD_MS,
          createdBy: actor.sub,
        },
      });
      await this.auditService.record({ organizationId, actorUserId: actor.sub, action: "SHIFT_CREATED", entityType: "Shift", entityId: created.id, correlationId }, tx);
      for (const workerProfileId of workerProfileIds) {
        const assignment = await tx.shiftAssignment.create({ data: { id: generateId(), shiftId: created.id, workerProfileId, assignedBy: actor.sub } });
        await this.auditService.record({ organizationId, actorUserId: actor.sub, action: "SHIFT_WORKER_ASSIGNED", entityType: "ShiftAssignment", entityId: assignment.id, correlationId }, tx);
      }
      return created;
    });

    const memberships = await this.prisma.organizationMembership.findMany({ where: { id: { in: workers.map((worker) => worker.membershipId) } }, select: { userId: true } });
    await this.notifications.notifyMany(
      memberships.map((membership) => ({
        organizationId,
        recipientUserId: membership.userId,
        type: NotificationType.TURAN_ASSIGNMENT_CREATED,
        title: "New shift assignment",
        body: `You've been assigned to "${shift.title}" starting ${shift.scheduledStart.toISOString()}.`,
        // Sent with the TURAN_ASSIGNMENT_CREATED type; assignmentKind tells clients it is a shift.
        data: { assignmentKind: AssignmentKind.SHIFT, shiftId: shift.id, shiftTitle: shift.title, startAt: shift.scheduledStart.toISOString(), endAt: shift.scheduledEnd.toISOString() },
      })),
    );
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.SHIFT, shift.id);
    return shift;
  }

  async assignWorker(organizationId: string, shiftId: string, workerProfileId: string, actor: AuthenticatedUser, correlationId: string) {
    const shift = UUID_PATTERN.test(shiftId)
      ? await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId, ...(shiftScopeWhere(scopeOf(actor)) ?? {}) } })
      : null;
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
    const shift = UUID_PATTERN.test(shiftId)
      ? await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId, ...(shiftScopeWhere(scopeOf(actor)) ?? {}) } })
      : null;
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");
    // Step 6 fix: closing again would overwrite closedAt/closedBy and audit twice; a cancelled shift stays cancelled.
    if (shift.status === ShiftStatus.CLOSED || shift.status === ShiftStatus.CANCELLED) {
      throw new AppException(409, ErrorCodes.SHIFT_NOT_OPEN, "This shift is already closed or cancelled.");
    }

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
    // Its temporary points expired and its temporary supervisors lost access (checked live).
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.SHIFT, shiftId);

    return updated;
  }
}
