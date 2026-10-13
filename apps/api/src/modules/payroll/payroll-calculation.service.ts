import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Prisma, type CompensationProfile, type PayrollPeriod, type TimeEntry } from "@prisma/client";
import { PayrollCalculationState, PayrollPeriodStatus } from "@fieldmaster/shared-types";
import {
  calculateWorkerPayroll,
  computeEntryCompensation as computeEntryPay,
  payrollMonthWorkerIds,
  type EntryCompensation,
  type PayrollEntryResult,
  type PayrollWorkerResult,
} from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { QUEUE_NAMES } from "../../common/queue/queue.constants";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { PayrollInputsService, toEngineProfile } from "./payroll-inputs.service";
import { buildPayrollSnapshotResult, PAYROLL_SNAPSHOT_SCHEMA_VERSION } from "./payroll-snapshot";

export type EntryCompensationResult = EntryCompensation;

/** A QUEUED or RUNNING run with no news for this long is taken over by the next "calculate" (its job was lost). */
export const STALE_CALCULATION_MS = 15 * 60_000;

/** Thrown inside the result transaction when the run is no longer ours (taken over as stale). */
class RunSupersededError extends Error {}

const ACTIVE_RUN_STATES: PayrollCalculationState[] = [PayrollCalculationState.QUEUED, PayrollCalculationState.RUNNING];

/**
 * The payroll engine's write side (Step 7). A month has one PayrollPeriod
 * row per VERSION; the latest is the working one. A calculation is a
 * background job (one PayrollCalculationRun) that reads only approved
 * entries, effective-dated compensation profiles and the month's adjustments,
 * and stores an immutable snapshot plus the version's items. Finalizing
 * freezes the version (database triggers refuse any later change); reopening
 * creates the next version and leaves the finalized one as it was.
 *
 * `computeEntryCompensation` is the one place money is computed from an
 * entry; the attendance cost estimates and the PDF report call it too.
 */
@Injectable()
export class PayrollCalculationService {
  private readonly logger = new Logger(PayrollCalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly inputs: PayrollInputsService,
    @InjectQueue(QUEUE_NAMES.PAYROLL_CALCULATION) private readonly queue: Queue,
  ) {}

  computeEntryCompensation(
    entry: Pick<TimeEntry, "approvedRegularMinutes" | "approvedOvertimeMinutes" | "fullDayCredit">,
    profile: CompensationProfile,
  ): EntryCompensationResult {
    return computeEntryPay(entry, toEngineProfile(profile));
  }

  async findEffectiveCompensationProfile(workerProfileId: string, onDate: string): Promise<CompensationProfile | null> {
    const date = new Date(onDate);
    return this.prisma.compensationProfile.findFirst({
      where: {
        workerProfileId,
        effectiveStartDate: { lte: date },
        OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: date } }],
      },
      orderBy: { effectiveStartDate: "desc" },
    });
  }

  /** The month's latest version (the working one, or the last finalized one). */
  latestVersion(organizationId: string, yearMonth: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    return client.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } });
  }

  /**
   * Starts a background calculation of the month's latest version and answers
   * its run id. The same Idempotency-Key always answers the same run; a second
   * calculation while one is QUEUED or RUNNING is refused (409), and so is a
   * finalized version.
   */
  async requestCalculation(organizationId: string, yearMonth: string, actor: AuthenticatedUser, idempotencyKey: string | undefined, correlationId: string) {
    const { body } = await this.idempotencyService.withIdempotency(idempotencyKey, "payroll-calculate", { organizationId, yearMonth }, async () => {
      const run = await this.createRun(organizationId, yearMonth, actor, idempotencyKey as string);

      await this.auditService.record({
        organizationId,
        actorUserId: actor.sub,
        action: "PAYROLL_CALCULATION_REQUESTED",
        entityType: "PayrollPeriod",
        entityId: run.payrollPeriodId,
        note: `Calculation run ${run.id}`,
        correlationId,
      });

      try {
        await this.queue.add("calculate", { runId: run.id }, { jobId: run.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
      } catch (error) {
        // Redis unreachable: fail the run at once so the version is not left "calculating".
        this.logger.error(`Could not queue payroll calculation run ${run.id}: ${(error as Error).message}`);
        await this.failRun(run.id, run.payrollPeriodId, "The calculation could not be queued.");
      }
      return { status: 202, body: { runId: run.id } };
    });
    return body.runId;
  }

  private async createRun(organizationId: string, yearMonth: string, actor: AuthenticatedUser, idempotencyKey: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        let period = await this.latestVersion(organizationId, yearMonth, tx);
        if (!period) {
          period = await tx.payrollPeriod.create({
            data: { id: generateId(), organizationId, yearMonth, version: 1, status: PayrollPeriodStatus.OPEN, createdBy: actor.sub },
          });
        }
        if (period.status === PayrollPeriodStatus.FINALIZED) {
          throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll version is finalized. Reopen it to calculate a new version.");
        }

        const active = await tx.payrollCalculationRun.findFirst({ where: { payrollPeriodId: period.id, state: { in: ACTIVE_RUN_STATES } } });
        if (active) {
          const lastNews = (active.startedAt ?? active.requestedAt).getTime();
          if (Date.now() - lastNews < STALE_CALCULATION_MS) {
            throw new AppException(409, ErrorCodes.PAYROLL_CALCULATION_IN_PROGRESS, "A calculation of this payroll version is already running.");
          }
          await tx.payrollCalculationRun.update({
            where: { id: active.id },
            data: {
              state: PayrollCalculationState.FAILED,
              finishedAt: new Date(),
              errorCode: ErrorCodes.PAYROLL_CALCULATION_STALE,
              errorMessage: "Stopped without finishing; replaced by a new calculation.",
            },
          });
        }

        const run = await tx.payrollCalculationRun.create({
          data: { id: generateId(), organizationId, payrollPeriodId: period.id, idempotencyKey, requestedBy: actor.sub },
        });
        await tx.payrollPeriod.update({ where: { id: period.id }, data: { status: PayrollPeriodStatus.CALCULATING } });
        return run;
      });
    } catch (error) {
      // Two requests at once: the partial unique index (one active run per
      // version) or the version's own unique key refuses the second.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppException(409, ErrorCodes.PAYROLL_CALCULATION_IN_PROGRESS, "A calculation of this payroll version is already running.");
      }
      throw error;
    }
  }

  /**
   * The job: calculates the run's version from the current inputs, then, in
   * one transaction, stores the snapshot, replaces the version's items and
   * moves the version to REVIEW. Any error marks the run FAILED (with its
   * code) and leaves the previous results of the version untouched.
   */
  async processRun(runId: string, onProgress?: (progress: number) => Promise<void> | void): Promise<void> {
    const run = await this.prisma.payrollCalculationRun.findUnique({ where: { id: runId }, include: { payrollPeriod: true } });
    if (!run || !ACTIVE_RUN_STATES.includes(run.state)) return;
    const period = run.payrollPeriod;

    // Conditional, so a run taken over as stale meanwhile is left alone.
    const started = await this.prisma.payrollCalculationRun.updateMany({
      where: { id: run.id, state: { in: ACTIVE_RUN_STATES } },
      data: { state: PayrollCalculationState.RUNNING, startedAt: run.startedAt ?? new Date(), progress: 5 },
    });
    if (started.count === 0) return;

    try {
      const { inputs, inputsHash } = await this.inputs.load(period.organizationId, period.yearMonth);
      const workerIds = payrollMonthWorkerIds(inputs.entries, inputs.adjustments);
      await this.setProgress(run.id, 10, 0, workerIds.length, onProgress);

      const workers: PayrollWorkerResult[] = [];
      const entryResults: PayrollEntryResult[] = [];
      let lastProgress = 10;
      for (const [index, workerProfileId] of workerIds.entries()) {
        const result = calculateWorkerPayroll(workerProfileId, inputs.entries, inputs.compensationProfiles, inputs.adjustments);
        workers.push(result.worker);
        entryResults.push(...result.entries);
        const progress = 10 + Math.floor((80 * (index + 1)) / workerIds.length);
        if (progress !== lastProgress) {
          lastProgress = progress;
          await this.setProgress(run.id, progress, index + 1, workerIds.length, onProgress);
        }
      }

      const { result, totals } = buildPayrollSnapshotResult(inputs, workers, entryResults);
      await this.prisma.$transaction(
        async (tx) => {
          const claimed = await tx.payrollCalculationRun.updateMany({
            where: { id: run.id, state: PayrollCalculationState.RUNNING },
            data: { state: PayrollCalculationState.SUCCEEDED, progress: 100, processedWorkers: workerIds.length, finishedAt: new Date() },
          });
          if (claimed.count === 0) throw new RunSupersededError();

          const snapshot = await tx.payrollCalculationSnapshot.create({
            data: {
              id: generateId(),
              payrollPeriodId: period.id,
              version: period.version,
              schemaVersion: PAYROLL_SNAPSHOT_SCHEMA_VERSION,
              inputsJson: inputs as unknown as Prisma.InputJsonValue,
              resultJson: result as unknown as Prisma.InputJsonValue,
              totalsJson: totals as unknown as Prisma.InputJsonValue,
              inputsHash,
              calculatedBy: run.requestedBy,
              calculationRunId: run.id,
            },
          });

          // The version's items mirror the snapshot (one per worker), for the statements and the dashboard.
          await tx.payrollItem.deleteMany({ where: { payrollPeriodId: period.id, workerProfileId: { notIn: workerIds } } });
          for (const worker of result.workers) {
            const values = {
              approvedShifts: worker.approvedShifts,
              standardDaysCredited: worker.standardDaysCredited,
              regularMinutes: worker.regularMinutes,
              overtimeMinutes: worker.overtimeMinutes,
              emergencyRetroactiveMinutes: worker.emergencyRetroactiveMinutes,
              emergencyReturnMinutes: worker.emergencyReturnMinutes,
              grossBaseAgorot: worker.grossBaseAgorot,
              overtimeAgorot: worker.overtimeAgorot,
              positiveAdjustmentsAgorot: worker.positiveAdjustmentsAgorot,
              forgottenStampPenaltiesAgorot: worker.forgottenStampPenaltiesAgorot,
              reversalsAgorot: worker.reversalsAgorot,
              otherDeductionsAgorot: worker.otherDeductionsAgorot,
              deductionsAgorot: worker.deductionsAgorot,
              netPayableAgorot: worker.netPayableAgorot,
            };
            const item = await tx.payrollItem.upsert({
              where: { payrollPeriodId_workerProfileId: { payrollPeriodId: period.id, workerProfileId: worker.workerProfileId } },
              create: { id: generateId(), payrollPeriodId: period.id, workerProfileId: worker.workerProfileId, ...values },
              update: values,
            });
            // An adjustment stays linked to the first item that included it (the snapshot records every version's own list).
            await tx.payrollAdjustment.updateMany({
              where: { id: { in: inputs.adjustments.filter((a) => a.workerProfileId === worker.workerProfileId).map((a) => a.id) }, payrollItemId: null },
              data: { payrollItemId: item.id },
            });
          }

          await tx.payrollPeriod.update({ where: { id: period.id }, data: { status: PayrollPeriodStatus.REVIEW, currentSnapshotId: snapshot.id } });
          await this.auditService.record(
            {
              organizationId: period.organizationId,
              actorUserId: run.requestedBy,
              action: "PAYROLL_CALCULATED",
              entityType: "PayrollPeriod",
              entityId: period.id,
              note: `Version ${period.version}: ${totals.workers} worker(s), ${totals.approvedShifts} approved shift(s), ${inputs.pending.entries} pending entr(ies) not included; snapshot ${snapshot.id}`,
              correlationId: run.id,
            },
            tx,
          );
        },
        { timeout: 60_000 },
      );
      await onProgress?.(100);
    } catch (error) {
      if (error instanceof RunSupersededError) return;
      this.logger.error(`Payroll calculation run ${run.id} failed: ${(error as Error).stack ?? error}`);
      await this.failRun(run.id, period.id, (error as Error).message ?? String(error));
      await this.auditService.record({
        organizationId: period.organizationId,
        actorUserId: run.requestedBy,
        action: "PAYROLL_CALCULATION_FAILED",
        entityType: "PayrollPeriod",
        entityId: period.id,
        note: `Calculation run ${run.id}`,
        correlationId: run.id,
      });
    }
  }

  private async setProgress(
    runId: string,
    progress: number,
    processedWorkers: number,
    totalWorkers: number,
    onProgress?: (progress: number) => Promise<void> | void,
  ) {
    await this.prisma.payrollCalculationRun.updateMany({
      where: { id: runId, state: PayrollCalculationState.RUNNING },
      data: { progress, processedWorkers, totalWorkers },
    });
    await onProgress?.(progress);
  }

  /** Marks a run FAILED and, unless another run took over, gives the version back the status it had. */
  private async failRun(runId: string, payrollPeriodId: string, message: string) {
    await this.prisma.payrollCalculationRun.updateMany({
      where: { id: runId, state: { in: ACTIVE_RUN_STATES } },
      data: {
        state: PayrollCalculationState.FAILED,
        finishedAt: new Date(),
        errorCode: ErrorCodes.PAYROLL_CALCULATION_FAILED,
        errorMessage: message.slice(0, 500),
      },
    });
    const otherActive = await this.prisma.payrollCalculationRun.count({ where: { payrollPeriodId, state: { in: ACTIVE_RUN_STATES } } });
    if (otherActive > 0) return;
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: payrollPeriodId } });
    if (!period || period.status !== PayrollPeriodStatus.CALCULATING) return;
    await this.prisma.payrollPeriod.updateMany({
      where: { id: payrollPeriodId, status: PayrollPeriodStatus.CALCULATING },
      data: { status: restingStatus(period) },
    });
  }

  /** Freezes the latest version (REVIEW, calculated). After this nothing about it can change; reopen creates the next version. */
  async finalize(organizationId: string, yearMonth: string, actor: AuthenticatedUser, correlationId: string): Promise<PayrollPeriod> {
    const period = await this.latestVersion(organizationId, yearMonth);
    if (!period) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll period not found. Calculate it first.");
    if (period.status === PayrollPeriodStatus.FINALIZED) {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll version is already finalized.");
    }
    if (period.status === PayrollPeriodStatus.CALCULATING) {
      throw new AppException(409, ErrorCodes.PAYROLL_CALCULATION_IN_PROGRESS, "Wait for the running calculation to finish before finalizing.");
    }
    if (period.status !== PayrollPeriodStatus.REVIEW || !period.currentSnapshotId) {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_NOT_READY, "Calculate this payroll version and review it before finalizing.");
    }

    const finalized = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollPeriod.updateMany({
        where: { id: period.id, status: PayrollPeriodStatus.REVIEW, currentSnapshotId: period.currentSnapshotId },
        data: { status: PayrollPeriodStatus.FINALIZED, finalizedAt: new Date(), finalizedBy: actor.sub },
      });
      if (updated.count === 0)
        throw new AppException(409, ErrorCodes.CONFLICT, "The payroll version changed while it was being finalized. Refresh and try again.");
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "PAYROLL_FINALIZED",
          entityType: "PayrollPeriod",
          entityId: period.id,
          note: `Version ${period.version}, snapshot ${period.currentSnapshotId}`,
          correlationId,
        },
        tx,
      );
      return tx.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } });
    });
    return finalized;
  }

  /**
   * Owner only, with a reason: creates the next version (REOPENED, nothing
   * calculated yet) from the finalized latest one. The finalized version is
   * not touched and stays readable.
   */
  async reopen(organizationId: string, yearMonth: string, reason: string, actor: AuthenticatedUser, correlationId: string): Promise<PayrollPeriod> {
    const period = await this.latestVersion(organizationId, yearMonth);
    if (!period) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll period not found.");
    if (period.status !== PayrollPeriodStatus.FINALIZED) {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_NOT_FINALIZED, "Only a finalized payroll version can be reopened.");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const next = await tx.payrollPeriod.create({
          data: {
            id: generateId(),
            organizationId,
            yearMonth,
            version: period.version + 1,
            status: PayrollPeriodStatus.REOPENED,
            previousVersionId: period.id,
            createdBy: actor.sub,
            reopenedAt: now,
            reopenedBy: actor.sub,
            reopenReason: reason,
          },
        });
        await this.auditService.record(
          {
            organizationId,
            actorUserId: actor.sub,
            action: "PAYROLL_PERIOD_REOPENED",
            entityType: "PayrollPeriod",
            entityId: period.id,
            field: "version",
            oldValue: String(period.version),
            newValue: String(next.version),
            reason,
            note: `New version ${next.id}`,
            correlationId,
          },
          tx,
        );
        return next;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppException(409, ErrorCodes.CONFLICT, "This payroll version was already reopened.");
      }
      throw error;
    }
  }
}

/** The status a version rests in when no calculation is running. */
export function restingStatus(period: Pick<PayrollPeriod, "currentSnapshotId" | "version">): PayrollPeriodStatus {
  if (period.currentSnapshotId) return PayrollPeriodStatus.REVIEW;
  return period.version > 1 ? PayrollPeriodStatus.REOPENED : PayrollPeriodStatus.OPEN;
}
