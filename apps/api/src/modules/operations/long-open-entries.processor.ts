import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { QUEUE_NAMES } from "../../common/queue/queue.constants";
import { LongOpenEntriesService } from "./long-open-entries.service";

/** Runs the "open for more than 9 hours" sweep (scheduled every minute by QueueModule). */
@Processor(QUEUE_NAMES.LONG_OPEN_ENTRIES)
export class LongOpenEntriesProcessor extends WorkerHost {
  constructor(private readonly longOpenEntries: LongOpenEntriesService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.longOpenEntries.sweep();
  }
}
