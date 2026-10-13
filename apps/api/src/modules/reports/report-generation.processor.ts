import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { QUEUE_NAMES } from "../../common/queue/queue.constants";
import { ReportGenerationService } from "./report-generation.service";

/**
 * Generates one report per job (Step 8). The report row is the source of
 * truth; the job's progress mirrors it. A job BullMQ gives up on (stalled
 * too often, or an error outside the generation's own handling) still
 * leaves its report FAILED, never RUNNING.
 */
@Processor(QUEUE_NAMES.REPORT_GENERATION)
export class ReportGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportGenerationProcessor.name);

  constructor(private readonly generation: ReportGenerationService) {
    super();
  }

  async process(job: Job<{ reportId: string }>): Promise<void> {
    await this.generation.processReport(job.data.reportId, (progress) => job.updateProgress(progress));
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<{ reportId: string }> | undefined, error: Error): Promise<void> {
    if (!job?.data?.reportId) return;
    try {
      await this.generation.failReport(job.data.reportId, error?.message ?? "The report job failed.");
    } catch (failure) {
      this.logger.error(`Could not mark report ${job.data.reportId} as failed: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }
}
