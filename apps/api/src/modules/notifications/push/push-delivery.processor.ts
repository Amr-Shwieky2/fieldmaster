import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { QUEUE_NAMES } from "../../../common/queue/queue.constants";
import { PushDeliveryService } from "./push-delivery.service";

/** Sends one notification's push (Step 9); queued by NotificationsService for every notification it creates. */
@Processor(QUEUE_NAMES.PUSH_DELIVERY)
export class PushDeliveryProcessor extends WorkerHost {
  constructor(private readonly push: PushDeliveryService) {
    super();
  }

  async process(job: Job<{ notificationId: string }>): Promise<void> {
    await this.push.deliver(job.data.notificationId);
  }
}
