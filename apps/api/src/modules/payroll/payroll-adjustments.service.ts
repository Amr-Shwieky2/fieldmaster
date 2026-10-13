import { Injectable } from "@nestjs/common";
import { PayrollAdjustmentSource, PayrollAdjustmentType, PayrollPeriodStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { CreateManualAdjustmentDto } from "./dto/manual-adjustment.dto";
import type { PayrollAdjustmentLineDto } from "./payroll.types";

@Injectable()
export class PayrollAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Owner: a manual bonus or deduction for a worker's month, with a reason.
   * Like every other edit, refused once the month's latest version is
   * finalized; it counts from the next calculation of the working version.
   */
  async create(
    organizationId: string,
    yearMonth: string,
    dto: CreateManualAdjustmentDto,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<PayrollAdjustmentLineDto> {
    const worker = UUID_PATTERN.test(dto.workerProfileId)
      ? await this.prisma.workerProfile.findFirst({
          where: { id: dto.workerProfileId, organizationId },
          select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } },
        })
      : null;
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const latest = await this.prisma.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } });
    if (latest?.status === PayrollPeriodStatus.FINALIZED) {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll period is finalized. Reopen it before adding an adjustment.");
    }

    const reason = dto.reason.trim();
    const signedAmount = dto.type === PayrollAdjustmentType.MANUAL_BONUS ? dto.amountAgorot : -dto.amountAgorot;
    const adjustment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payrollAdjustment.create({
        data: {
          id: generateId(),
          organizationId,
          workerProfileId: dto.workerProfileId,
          businessMonth: yearMonth,
          type: dto.type,
          source: PayrollAdjustmentSource.MANUAL,
          amountAgorot: signedAmount,
          reason,
          createdBy: actor.sub,
        },
      });
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "PAYROLL_ADJUSTMENT_CREATED",
          entityType: "PayrollAdjustment",
          entityId: created.id,
          reason,
          newValue: String(signedAmount),
          note: `${dto.type} for ${yearMonth}`,
          correlationId,
        },
        tx,
      );
      return created;
    });
    const creator = await this.prisma.user.findUnique({ where: { id: actor.sub }, select: { fullLegalName: true } });

    return {
      id: adjustment.id,
      workerProfileId: adjustment.workerProfileId,
      fullLegalName: worker.membership.user.fullLegalName,
      type: adjustment.type,
      source: adjustment.source,
      amountAgorot: adjustment.amountAgorot,
      reason: adjustment.reason,
      createdAt: adjustment.createdAt,
      createdByName: creator?.fullLegalName ?? null,
      relatedInfractionId: null,
      timeEntryId: null,
      reversalOfId: null,
      reversedById: null,
    };
  }
}
