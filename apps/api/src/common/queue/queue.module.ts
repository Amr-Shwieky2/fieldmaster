import { Global, Module, OnModuleInit } from "@nestjs/common";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ExpireTemporaryCheckInPointsProcessor } from "./processors/expire-temporary-check-in-points.processor";
import { ExpireOnboardingInvitationsProcessor } from "./processors/expire-onboarding-invitations.processor";
import { QUEUE_NAMES } from "./queue.constants";

export { QUEUE_NAMES };

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || 6379) };
}

/**
 * Real BullMQ job infrastructure against the Redis instance started by
 * docker-compose (previously unused despite being in the stack). Jobs are
 * idempotent sweeps: they scan for rows past their expiry and flip status,
 * so a missed or duplicate run is harmless (spec section 30).
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: parseRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EXPIRE_TEMPORARY_CHECK_IN_POINTS },
      { name: QUEUE_NAMES.EXPIRE_ONBOARDING_INVITATIONS },
    ),
  ],
  providers: [ExpireTemporaryCheckInPointsProcessor, ExpireOnboardingInvitationsProcessor],
  exports: [BullModule],
})
export class QueueModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_NAMES.EXPIRE_TEMPORARY_CHECK_IN_POINTS) private readonly checkInPointsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EXPIRE_ONBOARDING_INVITATIONS) private readonly invitationsQueue: Queue,
  ) {}

  async onModuleInit() {
    // Repeatable jobs are deduped by BullMQ on (name, repeat options), so
    // this is safe to call on every app boot.
    await this.checkInPointsQueue.add(
      "sweep",
      {},
      { repeat: { every: 60_000 }, removeOnComplete: 10, removeOnFail: 10 },
    );
    await this.invitationsQueue.add(
      "sweep",
      {},
      { repeat: { every: 5 * 60_000 }, removeOnComplete: 10, removeOnFail: 10 },
    );
  }
}
