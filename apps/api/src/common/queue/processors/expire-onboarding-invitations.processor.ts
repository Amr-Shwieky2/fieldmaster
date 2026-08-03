import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue.constants";

/** Marks unused onboarding invitations past their expiresAt as revoked, for a clean audit trail (spec section 8.1 / 30). */
@Processor(QUEUE_NAMES.EXPIRE_ONBOARDING_INVITATIONS)
export class ExpireOnboardingInvitationsProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpireOnboardingInvitationsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const result = await this.prisma.onboardingInvitation.updateMany({
      where: { usedAt: null, revokedAt: null, expiresAt: { lt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.log(`Auto-revoked ${result.count} expired onboarding invitation(s).`);
    }
  }
}
