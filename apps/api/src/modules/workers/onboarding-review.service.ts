import { Injectable } from "@nestjs/common";
import type { GovernmentIdType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { EncryptionService } from "../../common/encryption/encryption.service";
import { AuditService } from "../../common/audit/audit.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { isGovernmentIdType } from "./government-id";

export interface UploadedFileSummary {
  fileAssetId: string;
  contentType: string;
  sizeBytes: number;
}

/** `GET /workers/:id/onboarding-review` answer (the contract's `OnboardingReview`). */
export interface OnboardingReview {
  workerProfileId: string;
  membershipStatus: string;
  fullLegalName: string;
  preferredName: string | null;
  phoneNumber: string;
  submittedAt: string;
  governmentIdType: GovernmentIdType | null;
  governmentIdNumber: string | null;
  bankAccount: { bankName: string; branchNumber: string; accountNumber: string; accountHolderName: string } | null;
  consentAcceptedAt: string | null;
  privacyNoticeVersion: string | null;
  identityDocument: UploadedFileSummary | null;
  profilePhoto: UploadedFileSummary | null;
}

function fileSummary(asset: { id: string; contentType: string; sizeBytes: number } | null): UploadedFileSummary | null {
  return asset ? { fileAssetId: asset.id, contentType: asset.contentType, sizeBytes: asset.sizeBytes } : null;
}

function bankAccountFrom(json: string): NonNullable<OnboardingReview["bankAccount"]> {
  const stored = JSON.parse(json) as Record<string, unknown>;
  const text = (key: string) => (typeof stored[key] === "string" ? (stored[key] as string) : "");
  return { bankName: text("bankName"), branchNumber: text("branchNumber"), accountNumber: text("accountNumber"), accountHolderName: text("accountHolderName") };
}

/**
 * The Owner's review of a worker's application (Step 8): the identity
 * document number and bank details decrypted. Owner only (VIEW_BANK_INFO, a
 * financial permission); every view is audited (WORKER_SENSITIVE_DATA_VIEWED,
 * without the values). The files themselves are only reachable through
 * `GET /file-assets/:id/view-url`.
 */
@Injectable()
export class OnboardingReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly auditService: AuditService,
  ) {}

  async getReview(organizationId: string, workerProfileId: string, actor: AuthenticatedUser, correlationId: string): Promise<OnboardingReview> {
    const worker = UUID_PATTERN.test(workerProfileId)
      ? await this.prisma.workerProfile.findFirst({
          where: { id: workerProfileId, organizationId },
          include: {
            membership: { include: { user: true } },
            bankAccount: true,
            identityDocuments: { orderBy: { createdAt: "desc" }, take: 1, include: { fileAsset: true } },
            profilePhotoAsset: true,
          },
        })
      : null;
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const identityDocument = worker.identityDocuments[0] ?? null;
    const governmentIdNumber = identityDocument ? await this.encryption.decrypt(identityDocument) : null;
    const bankAccount = worker.bankAccount ? bankAccountFrom(await this.encryption.decrypt(worker.bankAccount)) : null;

    // Recorded before the values are returned: a view is never unaudited.
    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "WORKER_SENSITIVE_DATA_VIEWED",
      entityType: "WorkerProfile",
      entityId: worker.id,
      correlationId,
    });

    const documentType = identityDocument?.documentType ?? worker.governmentIdType;
    const user = worker.membership.user;
    return {
      workerProfileId: worker.id,
      membershipStatus: worker.membership.status,
      fullLegalName: user.fullLegalName,
      preferredName: user.preferredName,
      phoneNumber: user.phoneNumber,
      submittedAt: worker.membership.createdAt.toISOString(),
      governmentIdType: isGovernmentIdType(documentType) ? documentType : null,
      governmentIdNumber,
      bankAccount,
      consentAcceptedAt: worker.consentAcceptedAt?.toISOString() ?? null,
      privacyNoticeVersion: worker.privacyNoticeVersion,
      identityDocument: fileSummary(identityDocument?.fileAsset ?? null),
      profilePhoto: fileSummary(worker.profilePhotoAsset),
    };
  }
}
