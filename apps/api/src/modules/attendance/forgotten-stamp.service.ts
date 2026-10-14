import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PayrollAdjustmentSource, PayrollAdjustmentType, PayrollPeriodStatus } from "@fieldmaster/shared-types";
import { evaluateForgottenStampInfraction } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { canViewFinancials } from "../../common/auth/permissions";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { timeEntryScopeWhere } from "../../common/scope/scope-filters";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { listOrPage, mapRows, type PageWindow } from "../../common/validation/page-query";

/**
 * Every infraction column except the deduction, which is money (spec section
 * 6.2 / 23.5): only a member who may see financials gets it. Everyone else
 * sees the infractions they manage, never what they cost the worker.
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
 * Two-strike rule (spec section 14): the first forgotten clock-stamp
 * infractions in a calendar month are free (two by default); every later one
 * deducts the penalty (1000 agorot by default), recorded as a standing
 * PayrollAdjustment that gets attached to that month's PayrollItem once
 * payroll is calculated. How many are free and how much the penalty is come
 * from the work rules in force on the day of the infraction; an adjustment
 * already recorded keeps the amount it was created with.
 */
@Injectable()
export class ForgottenStampService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly workRules: WorkRulesService,
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
    /** The day the infraction happens on (the added clock-in's date, or today for a correction to an existing entry): picks the work rules. */
    ruleDate?: string,
  ) {
    const existingCount = await tx.forgottenStampInfraction.count({ where: { workerProfileId, businessMonth } });
    const monthlySequenceNumber = existingCount + 1;
    // The work rules in force on the day of the infraction (a month's first day when the caller gives none).
    const rules = await this.workRules.rulesOn(organizationId, ruleDate ?? `${businessMonth}-01`, tx);
    const evaluation = evaluateForgottenStampInfraction(monthlySequenceNumber, rules);

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

    // Step 7: a finalized month's payroll never changes; reopen it first (the reversal then counts in the new version).
    const latestVersion = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth: infraction.businessMonth },
      orderBy: { version: "desc" },
      select: { status: true },
    });
    if (latestVersion?.status === PayrollPeriodStatus.FINALIZED) {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll period has been finalized. Reopen it before reversing a deduction.");
    }

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
   * A member who may see financials also gets `deductionAgorot`; for anyone
   * else the column is never read (counts and sequence numbers only). A member
   * restricted to some projects sees the infractions of entries in those
   * projects only.
   */
  async listForOrganization(
    organizationId: string,
    viewer: AuthenticatedUser,
    filters: { workerProfileId?: string; month?: string } = {},
    window: PageWindow | null = null,
  ) {
    const related = {
      worker: { select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } } },
      correction: { select: { id: true, field: true, oldValue: true, newValue: true, reason: true, note: true, editedBy: true, createdAt: true } },
      timeEntry: { select: { id: true, businessDate: true, status: true } },
    } satisfies Prisma.ForgottenStampInfractionSelect;
    const entryScope = timeEntryScopeWhere(viewer.scope ?? { restricted: false });
    const where: Prisma.ForgottenStampInfractionWhereInput = {
      organizationId,
      ...(entryScope ? { timeEntry: entryScope } : {}),
      ...(filters.workerProfileId ? { workerProfileId: filters.workerProfileId } : {}),
      ...(filters.month ? { businessMonth: filters.month } : {}),
    };
    const orderBy: Prisma.ForgottenStampInfractionOrderByWithRelationInput[] = [
      { businessMonth: "desc" },
      { createdAt: "desc" },
      { monthlySequenceNumber: "desc" },
    ];

    // Every infraction, or one page of them (`?page=` / `?pageSize=`).
    const list = await listOrPage(
      window,
      (range) =>
        canViewFinancials(viewer)
          ? this.prisma.forgottenStampInfraction.findMany({
              where,
              orderBy: [...orderBy, { id: "desc" }],
              select: { ...INFRACTION_FIELDS_WITHOUT_DEDUCTION, deductionAgorot: true, ...related },
              ...range,
            })
          : this.prisma.forgottenStampInfraction.findMany({
              where,
              orderBy: [...orderBy, { id: "desc" }],
              select: { ...INFRACTION_FIELDS_WITHOUT_DEDUCTION, ...related },
              ...range,
            }),
      () => this.prisma.forgottenStampInfraction.count({ where }),
    );

    return mapRows(list, async (rows) => {
      const userIds = [...new Set(rows.flatMap((row) => [row.correction.editedBy, row.reversedBy]).filter((id): id is string => id !== null))];
      const users = userIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullLegalName: true } }) : [];
      const names = new Map(users.map((user) => [user.id, user.fullLegalName]));
      const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
      return rows.map(({ worker, correction, ...row }) => ({
        ...row,
        reversedByName: nameOf(row.reversedBy),
        worker: { id: worker.id, fullLegalName: worker.membership.user.fullLegalName },
        correction: { ...correction, editedByName: nameOf(correction.editedBy) },
      }));
    });
  }
}
