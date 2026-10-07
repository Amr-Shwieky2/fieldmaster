import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AccountStatus, NotificationType, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { serializeWorker } from "./worker-response.mapper";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { ApproveWorkerDto, RejectWorkerDto } from "./dto/approve-worker.dto";
import type { CreateCompensationProfileDto } from "./dto/create-compensation-profile.dto";

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(organizationId: string, viewer: AuthenticatedUser) {
    const workerProfiles = await this.prisma.workerProfile.findMany({
      where: { organizationId, archivedAt: null },
      include: { membership: { include: { user: true } } },
      orderBy: { createdAt: "asc" },
    });

    return Promise.all(
      workerProfiles.map(async (wp) => {
        const activeCompensationProfile =
          viewer.role === OrgRole.OWNER || viewer.workerProfileId === wp.id
            ? await this.getActiveCompensationProfile(wp.id)
            : null;
        return serializeWorker({ workerProfile: wp, activeCompensationProfile }, viewer);
      }),
    );
  }

  async getById(organizationId: string, workerProfileId: string, viewer: AuthenticatedUser) {
    const wp = await this.prisma.workerProfile.findFirst({
      where: { id: workerProfileId, organizationId, archivedAt: null },
      include: { membership: { include: { user: true } } },
    });
    if (!wp) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const activeCompensationProfile =
      viewer.role === OrgRole.OWNER || viewer.workerProfileId === wp.id
        ? await this.getActiveCompensationProfile(wp.id)
        : null;

    return serializeWorker({ workerProfile: wp, activeCompensationProfile }, viewer);
  }

  async listPendingApproval(organizationId: string) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { organizationId, role: OrgRole.WORKER, status: AccountStatus.PENDING_APPROVAL, archivedAt: null },
      include: { user: true, workerProfile: true },
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      workerProfileId: m.workerProfile?.id,
      fullLegalName: m.user.fullLegalName,
      phoneNumber: m.user.phoneNumber,
      submittedAt: m.createdAt,
    }));
  }

  async approve(organizationId: string, workerProfileId: string, dto: ApproveWorkerDto, actor: AuthenticatedUser, correlationId: string) {
    const wp = await this.prisma.workerProfile.findFirst({
      where: { id: workerProfileId, organizationId },
      include: { membership: { include: { user: true } } },
    });
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

    return { workerProfileId, compensationProfile: result };
  }

  async reject(organizationId: string, workerProfileId: string, dto: RejectWorkerDto, actor: AuthenticatedUser, correlationId: string) {
    const wp = await this.prisma.workerProfile.findFirst({ where: { id: workerProfileId, organizationId } });
    if (!wp) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({ where: { id: wp.membershipId }, data: { status: AccountStatus.REJECTED } });
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

    return { workerProfileId, status: AccountStatus.REJECTED };
  }

  async listCompensationProfiles(organizationId: string, workerProfileId: string, viewer: AuthenticatedUser) {
    await this.assertWorkerInOrg(organizationId, workerProfileId);
    if (viewer.role !== OrgRole.OWNER && viewer.workerProfileId !== workerProfileId) {
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
    await this.assertWorkerInOrg(organizationId, workerProfileId);
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

  private async assertWorkerInOrg(organizationId: string, workerProfileId: string) {
    const wp = await this.prisma.workerProfile.findFirst({ where: { id: workerProfileId, organizationId } });
    if (!wp) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");
    return wp;
  }
}

function isExclusionViolation(error: unknown): boolean {
  return error instanceof Error && /compensation_profiles_no_overlap|23P01/.test(error.message);
}
