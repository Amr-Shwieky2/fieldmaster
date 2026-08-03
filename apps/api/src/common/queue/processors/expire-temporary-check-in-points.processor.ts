import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { TemporaryPointStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue.constants";

/** Sweeps ACTIVE temporary check-in points past their expiresAt and marks them EXPIRED (spec section 18). */
@Processor(QUEUE_NAMES.EXPIRE_TEMPORARY_CHECK_IN_POINTS)
export class ExpireTemporaryCheckInPointsProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpireTemporaryCheckInPointsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const result = await this.prisma.temporaryCheckInPoint.updateMany({
      where: { status: TemporaryPointStatus.ACTIVE, expiresAt: { lt: new Date() } },
      data: { status: TemporaryPointStatus.EXPIRED },
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} temporary check-in point(s).`);
    }
  }
}
