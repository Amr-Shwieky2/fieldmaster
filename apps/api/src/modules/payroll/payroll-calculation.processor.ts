import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { QUEUE_NAMES } from "../../common/queue/queue.constants";
import { PayrollCalculationService } from "./payroll-calculation.service";

/** Runs one payroll calculation (Step 7). The run row is the source of truth; the job's own progress mirrors it. */
@Processor(QUEUE_NAMES.PAYROLL_CALCULATION)
export class PayrollCalculationProcessor extends WorkerHost {
  constructor(private readonly payrollCalculation: PayrollCalculationService) {
    super();
  }

  async process(job: Job<{ runId: string }>): Promise<void> {
    await this.payrollCalculation.processRun(job.data.runId, (progress) => job.updateProgress(progress));
  }
}
