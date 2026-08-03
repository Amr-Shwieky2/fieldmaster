import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CorrectionReason, PayrollPeriodStatus, TimeEntryStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { ForgottenStampService } from "./forgotten-stamp.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { CorrectionField, type CreateManualCorrectionDto } from "./dto/manual-correction.dto";

export interface CorrectionRequestMeta {
  requestIp?: string;
  userAgent?: string;
  correlationId: string;
}

const FORGOTTEN_STAMP_REASONS: CorrectionReason[] = [CorrectionReason.FORGOTTEN_CLOCK_IN, CorrectionReason.FORGOTTEN_CLOCK_OUT];

@Injectable()
export class ManualCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly forgottenStampService: ForgottenStampService,
  ) {}

  async create(organizationId: string, dto: CreateManualCorrectionDto, actor: AuthenticatedUser, meta: CorrectionRequestMeta) {
    if (dto.reason === CorrectionReason.OTHER && !dto.note) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "A note is required when reason is OTHER.");
    }

    return this.prisma.$transaction(async (tx) => {
      let timeEntry = dto.timeEntryId
        ? await tx.timeEntry.findFirst({ where: { id: dto.timeEntryId, organizationId } })
        : null;

      if (timeEntry) {
        await this.assertPeriodNotFinalized(tx, organizationId, timeEntry.businessDate);
      }

      if (!timeEntry) {
        if (dto.timeEntryId) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
        if (dto.field !== CorrectionField.CLOCK_IN || !dto.shiftId || !dto.workerProfileId) {
          throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "shiftId and workerProfileId are required to create a missing clock-in.");
        }
        const shift = await tx.shift.findFirst({ where: { id: dto.shiftId, organizationId } });
        if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

        const clockInAt = new Date(dto.newValue);
        await this.assertPeriodNotFinalized(tx, organizationId, toBusinessDate(clockInAt));
        timeEntry = await tx.timeEntry.create({
          data: {
            id: generateId(),
            organizationId,
            workerProfileId: dto.workerProfileId,
            shiftId: dto.shiftId,
            status: TimeEntryStatus.ACTIVE,
            businessDate: toBusinessDate(clockInAt),
            clockInAt,
            checkInMethod: shift.checkInMethod,
          },
        });

        const correction = await tx.manualTimeCorrection.create({
          data: {
            id: generateId(),
            timeEntryId: timeEntry.id,
            field: "clockInAt",
            oldValue: null,
            newValue: clockInAt.toISOString(),
            reason: dto.reason,
            note: dto.note,
            editedBy: actor.sub,
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
            correlationId: meta.correlationId,
          },
        });

        if (FORGOTTEN_STAMP_REASONS.includes(dto.reason)) {
          await this.forgottenStampService.recordInfraction(
            tx,
            organizationId,
            dto.workerProfileId,
            timeEntry.id,
            correction.id,
            clockInAt,
            actor,
            meta.correlationId,
          );
        }

        await this.auditService.record(
          {
            organizationId,
            actorUserId: actor.sub,
            action: "MANUAL_TIME_CORRECTION",
            entityType: "TimeEntry",
            entityId: timeEntry.id,
            field: "clockInAt",
            newValue: clockInAt.toISOString(),
            reason: dto.reason,
            note: dto.note,
            correlationId: meta.correlationId,
          },
          tx,
        );

        return { timeEntry, correction };
      }

      let field: string;
      let oldValue: string | null;
      let newValueForAudit: string;
      const updateData: Record<string, unknown> = {};

      if (dto.field === CorrectionField.CLOCK_IN) {
        field = "clockInAt";
        oldValue = timeEntry.clockInAt?.toISOString() ?? null;
        const newDate = new Date(dto.newValue);
        updateData.clockInAt = newDate;
        newValueForAudit = newDate.toISOString();
        if (timeEntry.clockOutAt) {
          if (timeEntry.clockOutAt.getTime() <= newDate.getTime()) {
            throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Clock-in must be before clock-out.");
          }
          updateData.rawDurationMinutes = Math.round((timeEntry.clockOutAt.getTime() - newDate.getTime()) / 60_000);
        }
      } else if (dto.field === CorrectionField.CLOCK_OUT) {
        field = "clockOutAt";
        oldValue = timeEntry.clockOutAt?.toISOString() ?? null;
        const newDate = new Date(dto.newValue);
        updateData.clockOutAt = newDate;
        newValueForAudit = newDate.toISOString();
        if (timeEntry.clockInAt) {
          if (newDate.getTime() <= timeEntry.clockInAt.getTime()) {
            throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Clock-out must be after clock-in.");
          }
          updateData.rawDurationMinutes = Math.round((newDate.getTime() - timeEntry.clockInAt.getTime()) / 60_000);
        }
        if (timeEntry.status === TimeEntryStatus.ACTIVE) {
          updateData.status = TimeEntryStatus.PENDING_APPROVAL;
        }
      } else {
        field = "unpaidBreakMinutes";
        oldValue = String(timeEntry.unpaidBreakMinutes);
        const minutes = Number(dto.newValue);
        if (!Number.isInteger(minutes) || minutes < 0) {
          throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "newValue must be a non-negative integer for UNPAID_BREAK_MINUTES.");
        }
        updateData.unpaidBreakMinutes = minutes;
        newValueForAudit = String(minutes);
      }

      const updatedEntry = await tx.timeEntry.update({ where: { id: timeEntry.id }, data: updateData });

      const correction = await tx.manualTimeCorrection.create({
        data: {
          id: generateId(),
          timeEntryId: timeEntry.id,
          field,
          oldValue,
          newValue: newValueForAudit,
          reason: dto.reason,
          note: dto.note,
          editedBy: actor.sub,
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
          correlationId: meta.correlationId,
        },
      });

      if (FORGOTTEN_STAMP_REASONS.includes(dto.reason)) {
        await this.forgottenStampService.recordInfraction(
          tx,
          organizationId,
          timeEntry.workerProfileId,
          timeEntry.id,
          correction.id,
          new Date(),
          actor,
          meta.correlationId,
        );
      }

      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "MANUAL_TIME_CORRECTION",
          entityType: "TimeEntry",
          entityId: timeEntry.id,
          field,
          oldValue: oldValue ?? undefined,
          newValue: newValueForAudit,
          reason: dto.reason,
          note: dto.note,
          correlationId: meta.correlationId,
        },
        tx,
      );

      return { timeEntry: updatedEntry, correction };
    });
  }

  private async assertPeriodNotFinalized(tx: Prisma.TransactionClient, organizationId: string, businessDate: string) {
    const yearMonth = businessDate.slice(0, 7);
    const period = await tx.payrollPeriod.findFirst({ where: { organizationId, yearMonth }, orderBy: { version: "desc" } });
    if (period?.status === PayrollPeriodStatus.FINALIZED) {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll period has been finalized and can no longer be edited.");
    }
  }
}
