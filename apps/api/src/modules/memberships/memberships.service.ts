import { Injectable } from "@nestjs/common";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { OwnerLimitService } from "../organizations/owner-limit.service";
import { generateId } from "../../common/ids";
import type { CreateMembershipDto } from "./dto/create-membership.dto";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ownerLimitService: OwnerLimitService,
  ) {}

  async create(organizationId: string, dto: CreateMembershipDto, actor: AuthenticatedUser, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.role === OrgRole.OWNER) {
        await this.ownerLimitService.assertCanAddOwner(organizationId, undefined, tx);
      }

      let user = await tx.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
      if (!user) {
        if (!dto.fullLegalName) {
          throw new Error("fullLegalName is required when creating a new user.");
        }
        user = await tx.user.create({
          data: { id: generateId(), phoneNumber: dto.phoneNumber, fullLegalName: dto.fullLegalName, status: AccountStatus.ACTIVE },
        });
      }

      const membership = await tx.organizationMembership.create({
        data: {
          id: generateId(),
          organizationId,
          userId: user.id,
          role: dto.role,
          isTimeTrackable: dto.isTimeTrackable ?? false,
          status: AccountStatus.ACTIVE,
        },
      });

      if (membership.isTimeTrackable) {
        await tx.workerProfile.create({
          data: { id: generateId(), membershipId: membership.id, organizationId },
        });
      }

      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "MEMBERSHIP_CREATED",
          entityType: "OrganizationMembership",
          entityId: membership.id,
          newValue: dto.role,
          correlationId,
        },
        tx,
      );

      return { ...membership, user };
    });
  }

  async list(organizationId: string) {
    return this.prisma.organizationMembership.findMany({
      where: { organizationId, archivedAt: null },
      include: { user: true, workerProfile: true },
      orderBy: { createdAt: "asc" },
    });
  }
}
