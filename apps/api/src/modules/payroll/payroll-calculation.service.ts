import { Injectable } from "@nestjs/common";
import type { CompensationProfile, TimeEntry } from "@prisma/client";
import { PayrollPeriodStatus, TimeEntryStatus } from "@fieldmaster/shared-types";
import { calculateDailyCompensation, calculateHourlyCompensation } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

export interface EntryCompensationResult {
  standardDayCredited: boolean;
  regularMinutes: number;
  overtimeMinutes: number;
  baseAgorot: number;
  overtimeAgorot: number;
}

/**
 * The one place that turns approved time entries + effective-dated
 * compensation profiles into money. Both the monthly calculation and the
 * financial dashboard call `computeEntryCompensation` so their numbers can
 * never drift apart.
 */
@Injectable()
export class PayrollCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  computeEntryCompensation(entry: TimeEntry, profile: CompensationProfile): EntryCompensationResult {
    const approvedMinutes = (entry.approvedRegularMinutes ?? 0) + (entry.approvedOvertimeMinutes ?? 0);

    if (profile.compensationType === "DAILY") {
      const result = calculateDailyCompensation({
        dailyBaseRateAgorot: profile.dailyBaseRateAgorot ?? 0,
        overtimeHourlyRateAgorot: profile.overtimeHourlyRateAgorot,
        approvedMinutes,
        fullDayCredit: entry.fullDayCredit,
      });
      return {
        standardDayCredited: result.standardDaysCredited === 1,
        regularMinutes: entry.approvedRegularMinutes ?? 0,
        overtimeMinutes: result.overtimeMinutes,
        baseAgorot: result.baseCompensationAgorot,
        overtimeAgorot: result.overtimeCompensationAgorot,
      };
    }

    const result = calculateHourlyCompensation({
      baseHourlyRateAgorot: profile.baseHourlyRateAgorot ?? 0,
      overtimeHourlyRateAgorot: profile.overtimeHourlyRateAgorot,
      approvedMinutes,
      fullDayCredit: entry.fullDayCredit,
    });
    return {
      standardDayCredited: false,
      regularMinutes: result.regularMinutes,
      overtimeMinutes: result.overtimeMinutes,
      baseAgorot: result.regularCompensationAgorot,
      overtimeAgorot: result.overtimeCompensationAgorot,
    };
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

  async getOrCreatePeriod(organizationId: string, yearMonth: string) {
    const existing = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth },
      orderBy: { version: "desc" },
    });
    if (existing) return existing;
    return this.prisma.payrollPeriod.create({
      data: { id: generateId(), organizationId, yearMonth, status: PayrollPeriodStatus.OPEN },
    });
  }

  async calculate(organizationId: string, yearMonth: string, actor: AuthenticatedUser, idempotencyKey: string | undefined, correlationId: string) {
    const result = await this.idempotencyService.withIdempotency(idempotencyKey, "payroll-calculate", { organizationId, yearMonth }, async () => {
      const period = await this.getOrCreatePeriod(organizationId, yearMonth);
      if (period.status === PayrollPeriodStatus.FINALIZED) {
        throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll period is finalized. Reopen it before recalculating.");
      }

      await this.prisma.payrollPeriod.update({ where: { id: period.id }, data: { status: PayrollPeriodStatus.CALCULATING } });

      const entries = await this.prisma.timeEntry.findMany({
        where: { organizationId, status: TimeEntryStatus.APPROVED, businessDate: { startsWith: yearMonth } },
      });

      const entriesByWorker = new Map<string, TimeEntry[]>();
      for (const entry of entries) {
        const list = entriesByWorker.get(entry.workerProfileId) ?? [];
        list.push(entry);
        entriesByWorker.set(entry.workerProfileId, list);
      }

      const itemsResult: Array<{ workerProfileId: string; netPayableAgorot: number }> = [];

      for (const [workerProfileId, workerEntries] of entriesByWorker) {
        let standardDaysCredited = 0;
        let regularMinutes = 0;
        let overtimeMinutes = 0;
        let emergencyRetroactiveMinutes = 0;
        let emergencyReturnMinutes = 0;
        let grossBaseAgorot = 0;
        let overtimeAgorot = 0;

        for (const entry of workerEntries) {
          const profile = await this.findEffectiveCompensationProfile(workerProfileId, entry.businessDate);
          if (!profile) continue; // no rate on file for this date -- excluded from money, still an operational record

          const comp = this.computeEntryCompensation(entry, profile);
          if (comp.standardDayCredited) standardDaysCredited += 1;
          regularMinutes += comp.regularMinutes;
          overtimeMinutes += comp.overtimeMinutes;
          grossBaseAgorot += comp.baseAgorot;
          overtimeAgorot += comp.overtimeAgorot;

          if (entry.isEmergency) {
            emergencyRetroactiveMinutes += 60;
            emergencyReturnMinutes += 15;
          }
        }

        const adjustments = await this.prisma.payrollAdjustment.findMany({
          where: { organizationId, workerProfileId, businessMonth: yearMonth },
        });
        const positiveAdjustmentsAgorot = adjustments.filter((a) => a.amountAgorot > 0).reduce((sum, a) => sum + a.amountAgorot, 0);
        const deductionsAgorot = adjustments.filter((a) => a.amountAgorot < 0).reduce((sum, a) => sum - a.amountAgorot, 0);

        const netPayableAgorot = grossBaseAgorot + overtimeAgorot + positiveAdjustmentsAgorot - deductionsAgorot;

        const item = await this.prisma.payrollItem.upsert({
          where: { payrollPeriodId_workerProfileId: { payrollPeriodId: period.id, workerProfileId } },
          create: {
            id: generateId(),
            payrollPeriodId: period.id,
            workerProfileId,
            standardDaysCredited,
            regularMinutes,
            overtimeMinutes,
            emergencyRetroactiveMinutes,
            emergencyReturnMinutes,
            grossBaseAgorot,
            overtimeAgorot,
            positiveAdjustmentsAgorot,
            deductionsAgorot,
            netPayableAgorot,
          },
          update: {
            standardDaysCredited,
            regularMinutes,
            overtimeMinutes,
            emergencyRetroactiveMinutes,
            emergencyReturnMinutes,
            grossBaseAgorot,
            overtimeAgorot,
            positiveAdjustmentsAgorot,
            deductionsAgorot,
            netPayableAgorot,
          },
        });

        await this.prisma.payrollAdjustment.updateMany({
          where: { organizationId, workerProfileId, businessMonth: yearMonth, payrollItemId: null },
          data: { payrollItemId: item.id },
        });

        itemsResult.push({ workerProfileId, netPayableAgorot });
      }

      const updatedPeriod = await this.prisma.payrollPeriod.update({
        where: { id: period.id },
        data: { status: PayrollPeriodStatus.REVIEW },
      });

      await this.prisma.payrollCalculationSnapshot.create({
        data: {
          id: generateId(),
          payrollPeriodId: period.id,
          version: period.version,
          inputsJson: { timeEntryIds: entries.map((e) => e.id) },
          resultJson: { items: itemsResult },
          calculatedBy: actor.sub,
        },
      });

      await this.auditService.record({
        organizationId,
        actorUserId: actor.sub,
        action: "PAYROLL_CALCULATED",
        entityType: "PayrollPeriod",
        entityId: period.id,
        correlationId,
      });

      return { status: 200, body: updatedPeriod };
    });

    return result.body;
  }

  async finalize(organizationId: string, yearMonth: string, actor: AuthenticatedUser, correlationId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } });
    if (!period) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll period not found. Calculate it first.");
    if (period.status !== PayrollPeriodStatus.REVIEW) {
      throw new AppException(409, ErrorCodes.CONFLICT, "The period must be calculated (status REVIEW) before it can be finalized.");
    }

    const updated = await this.prisma.payrollPeriod.update({
      where: { id: period.id },
      data: { status: PayrollPeriodStatus.FINALIZED, finalizedAt: new Date(), finalizedBy: actor.sub },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "PAYROLL_FINALIZED",
      entityType: "PayrollPeriod",
      entityId: period.id,
      correlationId,
    });

    return updated;
  }

  async reopen(organizationId: string, yearMonth: string, reason: string, actor: AuthenticatedUser, correlationId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } });
    if (!period) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll period not found.");
    if (period.status !== PayrollPeriodStatus.FINALIZED) {
      throw new AppException(409, ErrorCodes.CONFLICT, "Only a finalized period can be reopened.");
    }

    const updated = await this.prisma.payrollPeriod.update({
      where: { id: period.id },
      data: {
        status: PayrollPeriodStatus.REOPENED,
        version: { increment: 1 },
        reopenedAt: new Date(),
        reopenedBy: actor.sub,
        reopenReason: reason,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "PAYROLL_PERIOD_REOPENED",
      entityType: "PayrollPeriod",
      entityId: period.id,
      reason,
      correlationId,
    });

    return updated;
  }

  async getPeriodDetail(organizationId: string, yearMonth: string) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth },
      orderBy: { version: "desc" },
      include: { items: { include: { adjustments: true, worker: { include: { membership: { include: { user: true } } } } } } },
    });
    if (!period) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll period not found.");
    return period;
  }

  async listPeriods(organizationId: string) {
    return this.prisma.payrollPeriod.findMany({ where: { organizationId }, orderBy: [{ yearMonth: "desc" }, { version: "desc" }] });
  }
}
