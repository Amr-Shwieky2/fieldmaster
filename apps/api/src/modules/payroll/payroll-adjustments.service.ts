import { Injectable } from "@nestjs/common";
import { PayrollAdjustmentSource, PayrollAdjustmentType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { CreateManualAdjustmentDto } from "./dto/manual-adjustment.dto";

@Injectable()
export class PayrollAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, yearMonth: string, dto: CreateManualAdjustmentDto, actor: AuthenticatedUser, correlationId: string) {
    const worker = await this.prisma.workerProfile.findFirst({ where: { id: dto.workerProfileId, organizationId } });
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");

    const signedAmount = dto.type === PayrollAdjustmentType.MANUAL_BONUS ? dto.amountAgorot : -dto.amountAgorot;

    const adjustment = await this.prisma.payrollAdjustment.create({
      data: {
        id: generateId(),
        organizationId,
        workerProfileId: dto.workerProfileId,
        businessMonth: yearMonth,
        type: dto.type,
        source: PayrollAdjustmentSource.MANUAL,
        amountAgorot: signedAmount,
        reason: dto.reason,
        createdBy: actor.sub,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "PAYROLL_ADJUSTMENT_CREATED",
      entityType: "PayrollAdjustment",
      entityId: adjustment.id,
      reason: dto.reason,
      newValue: String(signedAmount),
      correlationId,
    });

    return adjustment;
  }

  async listForWorkerMonth(organizationId: string, workerProfileId: string, yearMonth: string) {
    return this.prisma.payrollAdjustment.findMany({ where: { organizationId, workerProfileId, businessMonth: yearMonth } });
  }
}
