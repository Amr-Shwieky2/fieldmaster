import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { AccountStatus, NotificationType, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { EncryptionService } from "../../common/encryption/encryption.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { RedeemInvitationDto } from "./dto/redeem-invitation.dto";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger("Onboarding");

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async createInvitation(organizationId: string, actor: AuthenticatedUser, prefilledPhoneNumber: string | undefined, correlationId: string) {
    const settings = await this.prisma.organizationSettings.findUnique({ where: { organizationId } });
    const ttlHours = settings?.onboardingInvitationTtlHours ?? 72;

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    const invitation = await this.prisma.onboardingInvitation.create({
      data: {
        id: generateId(),
        organizationId,
        tokenHash,
        prefilledPhoneNumber,
        expiresAt,
        createdBy: actor.sub,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "ONBOARDING_INVITATION_CREATED",
      entityType: "OnboardingInvitation",
      entityId: invitation.id,
      correlationId,
    });

    this.logger.log(`[DEV] Onboarding link token for invitation ${invitation.id}: ${rawToken} (expires ${expiresAt.toISOString()})`);

    return { invitationId: invitation.id, token: rawToken, expiresAt };
  }

  async revokeInvitation(organizationId: string, invitationId: string, actor: AuthenticatedUser, correlationId: string) {
    const invitation = await this.prisma.onboardingInvitation.findFirst({ where: { id: invitationId, organizationId } });
    if (!invitation) throw new AppException(404, ErrorCodes.NOT_FOUND, "Invitation not found.");
    await this.prisma.onboardingInvitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "ONBOARDING_INVITATION_REVOKED",
      entityType: "OnboardingInvitation",
      entityId: invitationId,
      correlationId,
    });
  }

  async listPending(organizationId: string) {
    return this.prisma.organizationMembership.findMany({
      where: { organizationId, role: OrgRole.WORKER, status: AccountStatus.PENDING_APPROVAL, archivedAt: null },
      include: { user: true, workerProfile: true },
    });
  }

  async redeem(dto: RedeemInvitationDto, correlationId: string) {
    const tokenHash = createHash("sha256").update(dto.token).digest("hex");
    const invitation = await this.prisma.onboardingInvitation.findUnique({ where: { tokenHash } });

    if (
      !invitation ||
      invitation.usedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date() ||
      (invitation.prefilledPhoneNumber && invitation.prefilledPhoneNumber !== dto.phoneNumber)
    ) {
      throw new AppException(400, ErrorCodes.INVITATION_INVALID_OR_EXPIRED, "This invitation link is invalid, expired, or already used.");
    }

    const existingUser = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    if (existingUser) {
      const existingMembership = await this.prisma.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: existingUser.id } },
      });
      if (existingMembership) {
        throw new AppException(409, ErrorCodes.CONFLICT, "This phone number already has a membership in this organization.");
      }
    }

    const encryptedBank = await this.encryption.encrypt(
      JSON.stringify({ bankName: dto.bankName, branchNumber: dto.branchNumber, accountNumber: dto.accountNumber, accountHolderName: dto.accountHolderName }),
    );

    const { user, membership, workerProfile } = await this.prisma.$transaction(async (tx) => {
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            id: generateId(),
            phoneNumber: dto.phoneNumber,
            fullLegalName: dto.fullLegalName,
            preferredName: dto.preferredName,
            preferredLanguage: dto.preferredLanguage ?? "en",
            status: AccountStatus.PENDING_APPROVAL,
          },
        }));

      const membership = await tx.organizationMembership.create({
        data: {
          id: generateId(),
          organizationId: invitation.organizationId,
          userId: user.id,
          role: OrgRole.WORKER,
          isTimeTrackable: true,
          status: AccountStatus.PENDING_APPROVAL,
        },
      });

      const workerProfile = await tx.workerProfile.create({
        data: {
          id: generateId(),
          membershipId: membership.id,
          organizationId: invitation.organizationId,
          governmentIdType: dto.governmentIdType,
          consentAcceptedAt: new Date(),
          privacyNoticeVersion: dto.privacyNoticeVersion,
        },
      });

      await tx.encryptedBankAccount.create({
        data: {
          id: generateId(),
          workerProfileId: workerProfile.id,
          ciphertext: encryptedBank.ciphertext,
          iv: encryptedBank.iv,
          authTag: encryptedBank.authTag,
          encryptionKeyId: encryptedBank.encryptionKeyId,
        },
      });

      await tx.onboardingInvitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });

      await this.auditService.record(
        {
          organizationId: invitation.organizationId,
          actorUserId: user.id,
          action: "ONBOARDING_SUBMITTED",
          entityType: "WorkerProfile",
          entityId: workerProfile.id,
          correlationId,
        },
        tx,
      );

      return { user, membership, workerProfile };
    });

    const owners = await this.prisma.organizationMembership.findMany({
      where: { organizationId: invitation.organizationId, role: OrgRole.OWNER, status: AccountStatus.ACTIVE, archivedAt: null },
    });
    await this.notifications.notifyMany(
      owners.map((owner) => ({
        organizationId: invitation.organizationId,
        recipientUserId: owner.userId,
        type: NotificationType.ONBOARDING_SUBMITTED,
        title: "New worker application",
        body: `${dto.fullLegalName} submitted an onboarding application awaiting your review.`,
        data: { workerProfileId: workerProfile.id },
      })),
    );

    return { userId: user.id, membershipId: membership.id, workerProfileId: workerProfile.id };
  }
}
