import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { OrgRole, PayrollAdjustmentSource, PayrollAdjustmentType } from "@fieldmaster/shared-types";
import { evaluateForgottenStampInfraction } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

/**
 * Every infraction column except the deduction, which is money and Owner-only
 * (spec section 6.2 / 23.5). Field Managers see the infractions they manage,
 * never what they cost the worker.
 */
const INFRACTION_FIELDS_WITHOUT_DEDUCTION = {
  id: true,
  organizationId: true,
  workerProfileId: true,
  timeEntryId: true,
  correctionId: true,
  businessMonth: true,
  monthlySequenceNumber: true,
  reversedAt: true,
  reversedBy: true,
  reversalReason: true,
  reversalAdjustmentId: true,
  createdAt: true,
} satisfies Prisma.ForgottenStampInfractionSelect;

/**
 * Two-strike rule (spec section 14): the first two forgotten clock-stamp
 * infractions in a calendar month are free; the third and every later one
 * deduct a fixed 1000 agorot, recorded as a standing PayrollAdjustment that
 * gets attached to that month's PayrollItem once payroll is calculated.
 */
@Injectable()
export class ForgottenStampService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async recordInfraction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    workerProfileId: string,
    timeEntryId: string,
    correctionId: string,
    /** From `forgottenStampInfractionMonth` (shared with the admin web's correction preview). */
    businessMonth: string,
    actor: AuthenticatedUser,
    correlationId: string,
  ) {
    const existingCount = await tx.forgottenStampInfraction.count({ where: { workerProfileId, businessMonth } });
    const monthlySequenceNumber = existingCount + 1;
    const evaluation = evaluateForgottenStampInfraction(monthlySequenceNumber);

    const infraction = await tx.forgottenStampInfraction.create({
      data: {
        id: generateId(),
        organizationId,
        workerProfileId,
        timeEntryId,
        correctionId,
        businessMonth,
        monthlySequenceNumber,
        deductionAgorot: evaluation.deductionAgorot,
      },
    });

    if (evaluation.deductionAgorot > 0) {
      await tx.payrollAdjustment.create({
        data: {
          id: generateId(),
          organizationId,
          workerProfileId,
          businessMonth,
          type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY,
          source: PayrollAdjustmentSource.SYSTEM,
          amountAgorot: -evaluation.deductionAgorot,
          relatedInfractionId: infraction.id,
          createdBy: actor.sub,
        },
      });
    }

    await this.auditService.record(
      {
        organizationId,
        actorUserId: actor.sub,
        action: "FORGOTTEN_STAMP_INFRACTION_RECORDED",
        entityType: "ForgottenStampInfraction",
        entityId: infraction.id,
        newValue: String(evaluation.deductionAgorot),
        correlationId,
      },
      tx,
    );

    return infraction;
  }

  async reverse(organizationId: string, infractionId: string, reason: string, actor: AuthenticatedUser, correlationId: string) {
    const infraction = await this.prisma.forgottenStampInfraction.findFirst({ where: { id: infractionId, organizationId } });
    if (!infraction) throw new AppException(404, ErrorCodes.NOT_FOUND, "Infraction not found.");
    if (infraction.reversedAt) throw new AppException(409, ErrorCodes.CONFLICT, "This infraction has already been reversed.");
    if (infraction.deductionAgorot === 0) {
      throw new AppException(409, ErrorCodes.CONFLICT, "This infraction has no deduction to reverse.");
    }

    const originalAdjustment = await this.prisma.payrollAdjustment.findFirst({ where: { relatedInfractionId: infraction.id } });
    if (!originalAdjustment) throw new AppException(404, ErrorCodes.NOT_FOUND, "Original payroll adjustment not found.");

    const result = await this.prisma.$transaction(async (tx) => {
      const reversal = await tx.payrollAdjustment.create({
        data: {
          id: generateId(),
          organizationId,
          workerProfileId: infraction.workerProfileId,
          businessMonth: infraction.businessMonth,
          type: PayrollAdjustmentType.FORGOTTEN_STAMP_REVERSAL,
          source: PayrollAdjustmentSource.MANUAL,
          amountAgorot: infraction.deductionAgorot,
          reason,
          relatedInfractionId: infraction.id,
          reversalOfId: originalAdjustment.id,
          createdBy: actor.sub,
        },
      });

      const updatedInfraction = await tx.forgottenStampInfraction.update({
        where: { id: infraction.id },
        data: { reversedAt: new Date(), reversedBy: actor.sub, reversalReason: reason, reversalAdjustmentId: reversal.id },
      });

      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "FORGOTTEN_STAMP_DEDUCTION_REVERSED",
          entityType: "ForgottenStampInfraction",
          entityId: infraction.id,
          reason,
          correlationId,
        },
        tx,
      );

      return updatedInfraction;
    });

    return result;
  }

  /**
   * Infractions for the forgotten-stamp report, newest first, with the
   * worker, the correction that recorded them and the corrected entry's date.
   * An Owner also gets `deductionAgorot`; for anyone else the column is never
   * read (FM: counts and sequence numbers only).
   */
  async listForOrganization(organizationId: string, viewer: AuthenticatedUser, filters: { workerProfileId?: string; month?: string } = {}) {
    const related = {
      worker: { select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } } },
      correction: { select: { id: true, field: true, oldValue: true, newValue: true, reason: true, note: true, editedBy: true, createdAt: true } },
      timeEntry: { select: { id: true, businessDate: true, status: true } },
    } satisfies Prisma.ForgottenStampInfractionSelect;
    const where: Prisma.ForgottenStampInfractionWhereInput = {
      organizationId,
      ...(filters.workerProfileId ? { workerProfileId: filters.workerProfileId } : {}),
      ...(filters.month ? { businessMonth: filters.month } : {}),
    };
    const orderBy: Prisma.ForgottenStampInfractionOrderByWithRelationInput[] = [
      { businessMonth: "desc" },
      { createdAt: "desc" },
      { monthlySequenceNumber: "desc" },
    ];

    const rows =
      viewer.role === OrgRole.OWNER
        ? await this.prisma.forgottenStampInfraction.findMany({
            where,
            orderBy,
            select: { ...INFRACTION_FIELDS_WITHOUT_DEDUCTION, deductionAgorot: true, ...related },
          })
        : await this.prisma.forgottenStampInfraction.findMany({ where, orderBy, select: { ...INFRACTION_FIELDS_WITHOUT_DEDUCTION, ...related } });

    const userIds = [...new Set(rows.flatMap((row) => [row.correction.editedBy, row.reversedBy]).filter((id): id is string => id !== null))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullLegalName: true } }) : [];
    const nameOf = (id: string | null) => (id ? (users.find((user) => user.id === id)?.fullLegalName ?? null) : null);

    return rows.map(({ worker, correction, ...row }) => ({
      ...row,
      reversedByName: nameOf(row.reversedBy),
      worker: { id: worker.id, fullLegalName: worker.membership.user.fullLegalName },
      correction: { ...correction, editedByName: nameOf(correction.editedBy) },
    }));
  }
}
