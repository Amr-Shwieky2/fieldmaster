import { Global, Module, OnModuleInit } from "@nestjs/common";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ExpireTemporaryCheckInPointsProcessor } from "./processors/expire-temporary-check-in-points.processor";
import { ExpireOnboardingInvitationsProcessor } from "./processors/expire-onboarding-invitations.processor";
import { QUEUE_NAMES, queuePrefix } from "./queue.constants";

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
    // Async so the environment is read after ConfigModule has loaded apps/api/.env.
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: parseRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
        prefix: queuePrefix(),
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EXPIRE_TEMPORARY_CHECK_IN_POINTS },
      { name: QUEUE_NAMES.EXPIRE_ONBOARDING_INVITATIONS },
      { name: QUEUE_NAMES.LONG_OPEN_ENTRIES },
      { name: QUEUE_NAMES.PAYROLL_CALCULATION },
      { name: QUEUE_NAMES.REPORT_GENERATION },
    ),
  ],
  providers: [ExpireTemporaryCheckInPointsProcessor, ExpireOnboardingInvitationsProcessor],
  exports: [BullModule],
})
export class QueueModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_NAMES.EXPIRE_TEMPORARY_CHECK_IN_POINTS) private readonly checkInPointsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EXPIRE_ONBOARDING_INVITATIONS) private readonly invitationsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.LONG_OPEN_ENTRIES) private readonly longOpenEntriesQueue: Queue,
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
    // "Open for more than 9 hours" alerts (Step 6; processor in OperationsModule).
    await this.longOpenEntriesQueue.add("sweep", {}, { repeat: { every: 60_000 }, removeOnComplete: 10, removeOnFail: 10 });
  }
}
