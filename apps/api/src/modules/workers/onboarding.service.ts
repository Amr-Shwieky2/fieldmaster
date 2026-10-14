import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AccountStatus,
  FileAssetPurpose,
  type OnboardingFilePurpose,
  InvitationStatus,
  MAX_UPLOAD_BYTES,
  NotificationType,
  OrgRole,
  PRIVACY_NOTICE_VERSION,
  UPLOAD_CONTENT_TYPES,
} from "@fieldmaster/shared-types";
import { isValidGovernmentIdNumber } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { EncryptionService } from "../../common/encryption/encryption.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationAudienceService } from "../notifications/notification-audience.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { generateInvitationToken, invitationTokenCandidate, isUsableInvitation } from "./invitation-token";
import { deriveInvitationStatus } from "./invitation-status";
import { normalizeGovernmentIdNumber } from "./government-id";
import type { JoinApplicationDto } from "./dto/join-application.dto";

/** An invitation that passed the public token check, with what the onboarding page shows. */
export type ActiveInvitation = Prisma.OnboardingInvitationGetPayload<{ include: { organization: { select: { name: true } } } }>;

/** `POST /onboarding-invitations`: the only time the raw token leaves the API. */
export interface CreatedInvitation {
  invitationId: string;
  token: string;
  joinPath: string;
  expiresAt: string;
}

/** `GET /onboarding-invitations` row. Never the token or its hash. */
export interface InvitationListItem {
  id: string;
  status: InvitationStatus;
  prefilledPhoneNumber: string | null;
  createdAt: string;
  createdByName: string | null;
  expiresAt: string;
  usedAt: string | null;
  workerProfileId: string | null;
  workerName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
}

/** `GET /onboarding/invitations/:token` (public). */
export interface PublicInvitation {
  organizationName: string;
  prefilledPhoneNumber: string | null;
  expiresAt: string;
  privacyNoticeVersion: string;
  maxUploadBytes: number;
  allowedContentTypes: Record<OnboardingFilePurpose, string[]>;
}

/** The single answer to every unusable token (invalid, unknown, used, expired, revoked): nothing tells them apart. */
function invitationInvalidOrExpired(): AppException {
  return new AppException(404, ErrorCodes.INVITATION_INVALID_OR_EXPIRED, "This invitation link is invalid or has expired.");
}

function uploadNotFound(field: "identityDocumentAssetId" | "profilePhotoAssetId"): AppException {
  return new AppException(400, ErrorCodes.UPLOAD_NOT_FOUND, "The uploaded file was not found for this invitation. Upload it again.", { field });
}

function phoneAlreadyMember(): AppException {
  return new AppException(409, ErrorCodes.CONFLICT, "This phone number already has a membership in this organization.");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Worker onboarding (Step 8). Managers create single-use invitation links
 * (only the token's SHA-256 is stored); a worker opens the link on the
 * public page, uploads an identity document (and optionally a photo) and
 * submits an application, which waits for an Owner's approval. Tokens, ID
 * numbers, bank details and file names are never logged, audited or put in
 * a notification.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger("Onboarding");

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly notificationAudience: NotificationAudienceService,
  ) {}

  async createInvitation(
    organizationId: string,
    actor: AuthenticatedUser,
    prefilledPhoneNumber: string | undefined,
    correlationId: string,
  ): Promise<CreatedInvitation> {
    const settings = await this.prisma.organizationSettings.findUnique({ where: { organizationId } });
    const ttlHours = settings?.onboardingInvitationTtlHours ?? 72;

    const { token, tokenHash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    const invitation = await this.prisma.onboardingInvitation.create({
      data: {
        id: generateId(),
        organizationId,
        tokenHash,
        prefilledPhoneNumber: prefilledPhoneNumber ?? null,
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

    return { invitationId: invitation.id, token, joinPath: `/join/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async listInvitations(organizationId: string): Promise<InvitationListItem[]> {
    const invitations = await this.prisma.onboardingInvitation.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });

    const userIds = [
      ...new Set(invitations.flatMap((invitation) => (invitation.revokedBy ? [invitation.createdBy, invitation.revokedBy] : [invitation.createdBy]))),
    ];
    const workerProfileIds = [
      ...new Set(invitations.flatMap((invitation) => (invitation.redeemedWorkerProfileId ? [invitation.redeemedWorkerProfileId] : []))),
    ];
    const [users, workers] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullLegalName: true } }),
      this.prisma.workerProfile.findMany({
        where: { id: { in: workerProfileIds }, organizationId },
        select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } },
      }),
    ]);
    const userNames = new Map(users.map((user) => [user.id, user.fullLegalName]));
    const workerNames = new Map(workers.map((worker) => [worker.id, worker.membership.user.fullLegalName]));

    const now = new Date();
    return invitations.map((invitation) => {
      const status = deriveInvitationStatus(invitation, now);
      // An expired invitation the background sweep marked as revoked is shown as expired, without a revocation.
      const revoked = status === InvitationStatus.REVOKED;
      return {
        id: invitation.id,
        status,
        prefilledPhoneNumber: invitation.prefilledPhoneNumber,
        createdAt: invitation.createdAt.toISOString(),
        createdByName: userNames.get(invitation.createdBy) ?? null,
        expiresAt: invitation.expiresAt.toISOString(),
        usedAt: invitation.usedAt?.toISOString() ?? null,
        workerProfileId: invitation.redeemedWorkerProfileId,
        workerName: invitation.redeemedWorkerProfileId ? (workerNames.get(invitation.redeemedWorkerProfileId) ?? null) : null,
        revokedAt: revoked ? (invitation.revokedAt?.toISOString() ?? null) : null,
        revokedByName: revoked && invitation.revokedBy ? (userNames.get(invitation.revokedBy) ?? null) : null,
      };
    });
  }

  async revokeInvitation(organizationId: string, invitationId: string, actor: AuthenticatedUser, correlationId: string): Promise<void> {
    const invitation = UUID_PATTERN.test(invitationId)
      ? await this.prisma.onboardingInvitation.findFirst({ where: { id: invitationId, organizationId } })
      : null;
    if (!invitation) throw new AppException(404, ErrorCodes.NOT_FOUND, "Invitation not found.");
    if (invitation.usedAt) throw this.alreadyUsed();
    // Already revoked (by a manager, or by the expiry sweep): nothing changes.
    if (invitation.revokedAt) return;

    const revoked = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.onboardingInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: actor.sub },
      });
      if (updated.count === 0) return false;
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "ONBOARDING_INVITATION_REVOKED",
          entityType: "OnboardingInvitation",
          entityId: invitation.id,
          correlationId,
        },
        tx,
      );
      return true;
    });
    if (!revoked) {
      // Used (or revoked) between the read and the update.
      const current = await this.prisma.onboardingInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      if (current.usedAt) throw this.alreadyUsed();
    }
  }

  /**
   * The token check shared by the three public routes (through
   * ActiveInvitationGuard). The same work runs whatever the token: it is
   * hashed (a placeholder when it is malformed), looked up by its hash,
   * compared with the stored hash in constant time, and the invitation's
   * status derived. Every failure is the same 404, with no data.
   */
  async resolveActiveInvitation(rawToken: unknown): Promise<ActiveInvitation> {
    const candidate = invitationTokenCandidate(rawToken);
    const invitation = await this.prisma.onboardingInvitation.findUnique({
      where: { tokenHash: candidate.tokenHash },
      include: { organization: { select: { name: true } } },
    });
    if (!isUsableInvitation(candidate, invitation, new Date())) throw invitationInvalidOrExpired();
    return invitation;
  }

  publicInvitation(invitation: ActiveInvitation): PublicInvitation {
    return {
      organizationName: invitation.organization.name,
      prefilledPhoneNumber: invitation.prefilledPhoneNumber,
      expiresAt: invitation.expiresAt.toISOString(),
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      allowedContentTypes: {
        IDENTITY_DOCUMENT: [...UPLOAD_CONTENT_TYPES.IDENTITY_DOCUMENT],
        PROFILE_PHOTO: [...UPLOAD_CONTENT_TYPES.PROFILE_PHOTO],
      },
    };
  }

  /**
   * The worker's application: one transaction creates the user (or reuses
   * the existing user of that phone number), a PENDING_APPROVAL Worker
   * membership and worker profile, the identity document with its number
   * encrypted, the encrypted bank account; it links the uploads to the
   * worker profile and marks the invitation used. The answer says only that
   * it was submitted.
   */
  async submitApplication(invitation: ActiveInvitation, dto: JoinApplicationDto, correlationId: string): Promise<{ submitted: true }> {
    if (!isValidGovernmentIdNumber(dto.governmentIdType, dto.governmentIdNumber)) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "governmentIdNumber is not a valid number for the selected document type.", {
        field: "governmentIdNumber",
      });
    }
    if (invitation.prefilledPhoneNumber && invitation.prefilledPhoneNumber !== dto.phoneNumber) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "phoneNumber must be the phone number the invitation was created for.", {
        field: "phoneNumber",
      });
    }
    const uploads = await this.applicationUploads(invitation.id, dto);

    const existingUser = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    if (existingUser) {
      const existingMembership = await this.prisma.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: existingUser.id } },
      });
      if (existingMembership) throw phoneAlreadyMember();
    }

    const [encryptedIdNumber, encryptedBank] = await Promise.all([
      this.encryption.encrypt(normalizeGovernmentIdNumber(dto.governmentIdType, dto.governmentIdNumber)),
      this.encryption.encrypt(
        JSON.stringify({ bankName: dto.bankName, branchNumber: dto.branchNumber, accountNumber: dto.accountNumber, accountHolderName: dto.accountHolderName }),
      ),
    ]);

    const workerProfileId = generateId();
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Single use even under concurrent submissions: only one transaction claims the invitation.
        const claimed = await tx.onboardingInvitation.updateMany({
          where: { id: invitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now, redeemedWorkerProfileId: workerProfileId },
        });
        if (claimed.count !== 1) throw invitationInvalidOrExpired();

        const user =
          existingUser ??
          (await tx.user.create({
            data: {
              id: generateId(),
              phoneNumber: dto.phoneNumber,
              fullLegalName: dto.fullLegalName,
              preferredName: dto.preferredName ?? null,
              preferredLanguage: "ar",
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

        await tx.workerProfile.create({
          data: {
            id: workerProfileId,
            membershipId: membership.id,
            organizationId: invitation.organizationId,
            governmentIdType: dto.governmentIdType,
            consentAcceptedAt: now,
            privacyNoticeVersion: dto.privacyNoticeVersion,
            profilePhotoAssetId: uploads.profilePhotoId,
          },
        });

        await tx.identityDocument.create({
          data: {
            id: generateId(),
            workerProfileId,
            documentType: dto.governmentIdType,
            ciphertext: encryptedIdNumber.ciphertext,
            iv: encryptedIdNumber.iv,
            authTag: encryptedIdNumber.authTag,
            encryptionKeyId: encryptedIdNumber.encryptionKeyId,
            fileAssetId: uploads.identityDocumentId,
          },
        });

        await tx.encryptedBankAccount.create({
          data: {
            id: generateId(),
            workerProfileId,
            ciphertext: encryptedBank.ciphertext,
            iv: encryptedBank.iv,
            authTag: encryptedBank.authTag,
            encryptionKeyId: encryptedBank.encryptionKeyId,
          },
        });

        // The uploads now belong to the worker profile; no other application can use them.
        const assetIds = uploads.profilePhotoId ? [uploads.identityDocumentId, uploads.profilePhotoId] : [uploads.identityDocumentId];
        const linked = await tx.fileAsset.updateMany({
          where: { id: { in: assetIds }, invitationId: invitation.id, workerProfileId: null },
          data: { workerProfileId },
        });
        if (linked.count !== assetIds.length) throw uploadNotFound("identityDocumentAssetId");

        await this.auditService.record(
          {
            organizationId: invitation.organizationId,
            actorUserId: user.id,
            action: "ONBOARDING_SUBMITTED",
            entityType: "WorkerProfile",
            entityId: workerProfileId,
            correlationId,
          },
          tx,
        );
      });
    } catch (error) {
      // A concurrent application with the same phone number won the race.
      if (isUniqueViolation(error)) throw phoneAlreadyMember();
      throw error;
    }

    await this.notifyManagers(invitation.organizationId, workerProfileId, dto.fullLegalName);
    return { submitted: true };
  }

  /** The application's uploads: this invitation's, of the right purpose, not used by an application yet. */
  private async applicationUploads(invitationId: string, dto: JoinApplicationDto): Promise<{ identityDocumentId: string; profilePhotoId: string | null }> {
    const requested = dto.profilePhotoAssetId ? [dto.identityDocumentAssetId, dto.profilePhotoAssetId] : [dto.identityDocumentAssetId];
    const assets = await this.prisma.fileAsset.findMany({ where: { id: { in: requested }, invitationId, workerProfileId: null } });
    const usable = (id: string, purpose: FileAssetPurpose) => assets.some((asset) => asset.id === id && asset.purpose === purpose);

    if (!usable(dto.identityDocumentAssetId, FileAssetPurpose.IDENTITY_DOCUMENT)) throw uploadNotFound("identityDocumentAssetId");
    if (dto.profilePhotoAssetId && !usable(dto.profilePhotoAssetId, FileAssetPurpose.PROFILE_PHOTO)) throw uploadNotFound("profilePhotoAssetId");
    return { identityDocumentId: dto.identityDocumentAssetId, profilePhotoId: dto.profilePhotoAssetId ?? null };
  }

  /** Owners by default; Field Managers too when the organization's notification settings say so. Names only: never an ID number or bank detail. */
  private async notifyManagers(organizationId: string, workerProfileId: string, workerName: string) {
    try {
      const recipients = await this.notificationAudience.recipients(organizationId, NotificationType.ONBOARDING_SUBMITTED);
      await this.notifications.notifyMany(
        recipients.map((recipient) => ({
          organizationId,
          recipientUserId: recipient.userId,
          type: NotificationType.ONBOARDING_SUBMITTED,
          title: "New worker application",
          body: `${workerName} submitted an onboarding application awaiting your review.`,
          data: { workerProfileId, workerName },
        })),
      );
    } catch {
      // The application is saved; a failed notification must not answer the worker with an error.
      this.logger.error(`Could not notify managers about the onboarding application of worker profile ${workerProfileId}.`);
    }
  }

  private alreadyUsed(): AppException {
    return new AppException(409, ErrorCodes.INVITATION_ALREADY_USED, "This invitation was already used, so it cannot be revoked.");
  }
}
