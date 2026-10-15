import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AccountStatus, NotificationType, OrgRole, Permission, NotificationHandledOutcome, NotificationSubjectKind } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { serializeWorker } from "./worker-response.mapper";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { hasPermission } from "../../common/auth/permissions";
import { scopeOf, workerScopeWhere } from "../../common/scope/scope-filters";
import type { ApproveWorkerDto, RejectWorkerDto } from "./dto/approve-worker.dto";
import type { CreateCompensationProfileDto } from "./dto/create-compensation-profile.dto";
import { listOrPage, mapRows, type PageWindow } from "../../common/validation/page-query";
import { NotificationSubjectsService } from "../notifications/notification-subjects.service";

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly subjects: NotificationSubjectsService,
  ) {}

  /**
   * Every worker (of the viewer's projects, when restricted), or one page of
   * them (`?page=` / `?pageSize=`), oldest first; each one's pay only for
   * someone who may see compensation (and for the worker themself).
   */
  async list(organizationId: string, viewer: AuthenticatedUser, window: PageWindow | null = null) {
    const where = { organizationId, archivedAt: null, ...(workerScopeWhere(scopeOf(viewer)) ?? {}) };
    const list = await listOrPage(
      window,
      (range) => this.prisma.workerProfile.findMany({ where, include: { membership: { include: { user: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...range }),
      () => this.prisma.workerProfile.count({ where }),
    );

    return mapRows(list, async (workerProfiles) => {
      // One query for every visible worker's current compensation profile (not one per worker).
      const canSeeCompensation = hasPermission(viewer, Permission.VIEW_COMPENSATION);
      const visibleIds = workerProfiles.filter((wp) => canSeeCompensation || viewer.workerProfileId === wp.id).map((wp) => wp.id);
      const activeByWorker = await this.getActiveCompensationProfiles(visibleIds);
      return workerProfiles.map((wp) => serializeWorker({ workerProfile: wp, activeCompensationProfile: activeByWorker.get(wp.id) ?? null }, viewer));
    });
  }

  async getById(organizationId: string, workerProfileId: string, viewer: AuthenticatedUser) {
    const wp = await this.prisma.workerProfile.findFirst({
      where: { id: workerProfileId, organizationId, archivedAt: null, ...(workerScopeWhere(scopeOf(viewer)) ?? {}) },
      include: { membership: { include: { user: true } } },
    });
    if (!wp) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const activeCompensationProfile =
      hasPermission(viewer, Permission.VIEW_COMPENSATION) || viewer.workerProfileId === wp.id
        ? await this.getActiveCompensationProfile(wp.id)
        : null;

    return serializeWorker({ workerProfile: wp, activeCompensationProfile }, viewer);
  }

  async listPendingApproval(organizationId: string, window: PageWindow | null = null) {
    const where = { organizationId, role: OrgRole.WORKER, status: AccountStatus.PENDING_APPROVAL, archivedAt: null };
    const list = await listOrPage(
      window,
      (range) => this.prisma.organizationMembership.findMany({ where, include: { user: true, workerProfile: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...range }),
      () => this.prisma.organizationMembership.count({ where }),
    );
    return mapRows(list, (memberships) =>
      memberships.map((m) => ({
        membershipId: m.id,
        workerProfileId: m.workerProfile?.id,
        fullLegalName: m.user.fullLegalName,
        phoneNumber: m.user.phoneNumber,
        submittedAt: m.createdAt,
      })),
    );
  }

  async approve(organizationId: string, workerProfileId: string, dto: ApproveWorkerDto, actor: AuthenticatedUser, correlationId: string) {
    const wp = UUID_PATTERN.test(workerProfileId)
      ? await this.prisma.workerProfile.findFirst({
          where: { id: workerProfileId, organizationId },
          include: { membership: { include: { user: true } } },
        })
      : null;
    if (!wp) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");
    if (wp.membership.status !== AccountStatus.PENDING_APPROVAL) {
      throw new AppException(409, ErrorCodes.CONFLICT, "This worker is not pending approval.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({ where: { id: wp.membershipId }, data: { status: AccountStatus.ACTIVE } });
      await tx.user.update({ where: { id: wp.membership.userId }, data: { status: AccountStatus.ACTIVE } });

      const profile = dto.compensationProfile;
      const compensationProfile = await this.createCompensationProfileInTx(tx, workerProfileId, profile, actor.sub);

      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "WORKER_APPROVED",
          entityType: "WorkerProfile",
          entityId: workerProfileId,
          correlationId,
        },
        tx,
      );

      return compensationProfile;
    });

    await this.notifications.notify({
      organizationId,
      recipientUserId: wp.membership.userId,
      type: NotificationType.WORKER_APPROVED,
      title: "Your application was approved",
      body: "Welcome to the team. You can now clock in for assigned shifts.",
      // Never the new compensation profile: Workers do not see compensation in notifications.
      data: { workerProfileId },
    });

    // Mobile manager mode: the application's notifications show as handled for every manager.
    await this.subjects.settle(organizationId, { kind: NotificationSubjectKind.ONBOARDING, refId: workerProfileId }, actor, NotificationHandledOutcome.WORKER_APPROVED, null, correlationId);
    return { workerProfileId, compensationProfile: result };
  }

  async reject(organizationId: string, workerProfileId: string, dto: RejectWorkerDto, actor: AuthenticatedUser, correlationId: string) {
    const wp = UUID_PATTERN.test(workerProfileId)
      ? await this.prisma.workerProfile.findFirst({ where: { id: workerProfileId, organizationId }, include: { membership: { select: { status: true } } } })
      : null;
    if (!wp) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");
    // Like approving: only an application still waiting (a second manager's late tap must not reject an active worker).
    if (wp.membership.status !== AccountStatus.PENDING_APPROVAL) {
      throw new AppException(409, ErrorCodes.CONFLICT, "This worker is not pending approval.");
    }

    await this.prisma.$transaction(async (tx) => {
      const rejected = await tx.organizationMembership.updateMany({ where: { id: wp.membershipId, status: AccountStatus.PENDING_APPROVAL }, data: { status: AccountStatus.REJECTED } });
      if (rejected.count === 0) throw new AppException(409, ErrorCodes.CONFLICT, "This worker is not pending approval.");
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "WORKER_REJECTED",
          entityType: "WorkerProfile",
          entityId: workerProfileId,
          reason: dto.reason,
          correlationId,
        },
        tx,
      );
    });

    await this.subjects.settle(organizationId, { kind: NotificationSubjectKind.ONBOARDING, refId: workerProfileId }, actor, NotificationHandledOutcome.WORKER_REJECTED, dto.reason, correlationId);
    return { workerProfileId, status: AccountStatus.REJECTED };
  }

  async listCompensationProfiles(organizationId: string, workerProfileId: string, viewer: AuthenticatedUser) {
    await this.assertWorkerInOrg(organizationId, workerProfileId, viewer);
    if (!hasPermission(viewer, Permission.VIEW_COMPENSATION) && viewer.workerProfileId !== workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You cannot view this worker's compensation.");
    }
    return this.prisma.compensationProfile.findMany({
      where: { workerProfileId },
      orderBy: { effectiveStartDate: "desc" },
    });
  }

  async addCompensationProfile(
    organizationId: string,
    workerProfileId: string,
    dto: CreateCompensationProfileDto,
    actor: AuthenticatedUser,
    correlationId: string,
  ) {
    await this.assertWorkerInOrg(organizationId, workerProfileId, actor);
    try {
      const profile = await this.prisma.$transaction(async (tx) => {
        const created = await this.createCompensationProfileInTx(tx, workerProfileId, dto, actor.sub);
        await this.auditService.record(
          {
            organizationId,
            actorUserId: actor.sub,
            action: "COMPENSATION_PROFILE_CREATED",
            entityType: "CompensationProfile",
            entityId: created.id,
            reason: dto.changeReason,
            correlationId,
          },
          tx,
        );
        return created;
      });
      return profile;
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new AppException(
          409,
          ErrorCodes.OVERLAPPING_COMPENSATION_PROFILE,
          "This worker already has a compensation profile covering part of the requested date range.",
        );
      }
      throw error;
    }
  }

  /** The compensation profile in effect today of each of the workers, in one query (the latest start wins). */
  private async getActiveCompensationProfiles(workerProfileIds: string[]) {
    const result = new Map<string, Awaited<ReturnType<WorkersService["getActiveCompensationProfile"]>> & object>();
    if (workerProfileIds.length === 0) return result;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const profiles = await this.prisma.compensationProfile.findMany({
      where: {
        workerProfileId: { in: workerProfileIds },
        effectiveStartDate: { lte: today },
        OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: today } }],
      },
      orderBy: { effectiveStartDate: "desc" },
    });
    for (const profile of profiles) if (!result.has(profile.workerProfileId)) result.set(profile.workerProfileId, profile);
    return result;
  }

  private async getActiveCompensationProfile(workerProfileId: string) {
    const today = new Date().toISOString().slice(0, 10);
    return this.prisma.compensationProfile.findFirst({
      where: {
        workerProfileId,
        effectiveStartDate: { lte: new Date(today) },
        OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: new Date(today) } }],
      },
      orderBy: { effectiveStartDate: "desc" },
    });
  }

  private async createCompensationProfileInTx(
    tx: Prisma.TransactionClient,
    workerProfileId: string,
    dto: CreateCompensationProfileDto,
    createdBy: string,
  ) {
    return tx.compensationProfile.create({
      data: {
        id: generateId(),
        workerProfileId,
        compensationType: dto.compensationType,
        dailyBaseRateAgorot: dto.dailyBaseRateAgorot,
        baseHourlyRateAgorot: dto.baseHourlyRateAgorot,
        overtimeHourlyRateAgorot: dto.overtimeHourlyRateAgorot,
        effectiveStartDate: new Date(dto.effectiveStartDate),
        effectiveEndDate: dto.effectiveEndDate ? new Date(dto.effectiveEndDate) : null,
        changeReason: dto.changeReason,
        createdBy,
      },
    });
  }

  private async assertWorkerInOrg(organizationId: string, workerProfileId: string, viewer: AuthenticatedUser) {
    const wp = await this.prisma.workerProfile.findFirst({ where: { id: workerProfileId, organizationId, ...(workerScopeWhere(scopeOf(viewer)) ?? {}) } });
    if (!wp) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");
    return wp;
  }
}

function isExclusionViolation(error: unknown): boolean {
  return error instanceof Error && /compensation_profiles_no_overlap|23P01/.test(error.message);
}
