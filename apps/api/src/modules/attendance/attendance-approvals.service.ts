import { Injectable } from "@nestjs/common";
import { ApprovalAction, NotificationType, STANDARD_DAY_MINUTES, TimeEntryStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { NotificationData } from "../notifications/notification-data";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

@Injectable()
export class AttendanceApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async listPendingApproval(organizationId: string) {
    return this.prisma.timeEntry.findMany({
      where: { organizationId, status: TimeEntryStatus.PENDING_APPROVAL },
      include: { shift: true, dailySummary: true, corrections: true, worker: { include: { membership: { include: { user: true } } } } },
      orderBy: { clockOutAt: "asc" },
    });
  }

  async applyFullDayCredit(organizationId: string, timeEntryId: string, reason: string, actor: AuthenticatedUser, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId } });
    if (!timeEntry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    if (!timeEntry.clockOutAt || timeEntry.rawDurationMinutes === null) {
      throw new AppException(400, ErrorCodes.FULL_DAY_CREDIT_NOT_ALLOWED, "The shift must have ended before full-day credit can be applied.");
    }
    if (timeEntry.rawDurationMinutes >= STANDARD_DAY_MINUTES) {
      throw new AppException(400, ErrorCodes.FULL_DAY_CREDIT_NOT_ALLOWED, "Full-day credit only applies to shifts under 9 approved hours.");
    }
    await this.assertPeriodNotFinalized(organizationId, timeEntry.businessDate);

    const updated = await this.prisma.timeEntry.update({
      where: { id: timeEntryId },
      data: { fullDayCredit: true, fullDayCreditReason: reason, fullDayCreditBy: actor.sub, fullDayCreditAt: new Date() },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "FULL_DAY_CREDIT_APPLIED",
      entityType: "TimeEntry",
      entityId: timeEntryId,
      field: "fullDayCredit",
      oldValue: "false",
      newValue: "true",
      reason,
      correlationId,
    });

    return updated;
  }

  async approve(organizationId: string, timeEntryId: string, actor: AuthenticatedUser, notes: string | undefined, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId } });
    if (!timeEntry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    if (timeEntry.status !== TimeEntryStatus.PENDING_APPROVAL && timeEntry.status !== TimeEntryStatus.CORRECTION_REQUESTED) {
      throw new AppException(409, ErrorCodes.CONFLICT, "This time entry is not awaiting approval.");
    }
    await this.assertPeriodNotFinalized(organizationId, timeEntry.businessDate);

    const rawMinutes = timeEntry.rawDurationMinutes ?? 0;
    const netMinutes = Math.max(0, rawMinutes - timeEntry.unpaidBreakMinutes);

    let approvedRegularMinutes: number;
    let approvedOvertimeMinutes: number;
    if (timeEntry.fullDayCredit && netMinutes < STANDARD_DAY_MINUTES) {
      approvedRegularMinutes = STANDARD_DAY_MINUTES;
      approvedOvertimeMinutes = 0;
    } else {
      approvedRegularMinutes = Math.min(netMinutes, STANDARD_DAY_MINUTES);
      approvedOvertimeMinutes = Math.max(0, netMinutes - STANDARD_DAY_MINUTES);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.update({
        where: { id: timeEntryId },
        data: {
          status: TimeEntryStatus.APPROVED,
          approvedRegularMinutes,
          approvedOvertimeMinutes,
          approvedBy: actor.sub,
          approvedAt: new Date(),
        },
      });
      await tx.attendanceApproval.create({
        data: { id: generateId(), timeEntryId, action: ApprovalAction.APPROVE, actedBy: actor.sub, notes },
      });
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "TIME_ENTRY_APPROVED",
          entityType: "TimeEntry",
          entityId: timeEntryId,
          note: notes,
          correlationId,
        },
        tx,
      );
      return entry;
    });

    await this.notifyWorker(organizationId, timeEntry.workerProfileId, NotificationType.SHIFT_APPROVED, "Attendance approved", "Your clocked shift has been approved.", {
      timeEntryId,
      shiftId: timeEntry.shiftId,
      shiftTitle: await this.shiftTitle(timeEntry.shiftId),
      businessDate: timeEntry.businessDate,
      approvedRegularMinutes,
      approvedOvertimeMinutes,
    });

    return updated;
  }

  async reject(organizationId: string, timeEntryId: string, reason: string, actor: AuthenticatedUser, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId } });
    if (!timeEntry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    if (timeEntry.status !== TimeEntryStatus.PENDING_APPROVAL && timeEntry.status !== TimeEntryStatus.CORRECTION_REQUESTED) {
      throw new AppException(409, ErrorCodes.CONFLICT, "This time entry is not awaiting approval.");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.update({
        where: { id: timeEntryId },
        data: { status: TimeEntryStatus.REJECTED, rejectedReason: reason },
      });
      await tx.attendanceApproval.create({
        data: { id: generateId(), timeEntryId, action: ApprovalAction.REJECT, actedBy: actor.sub, notes: reason },
      });
      await this.auditService.record(
        { organizationId, actorUserId: actor.sub, action: "TIME_ENTRY_REJECTED", entityType: "TimeEntry", entityId: timeEntryId, reason, correlationId },
        tx,
      );
      return entry;
    });

    await this.notifyWorker(organizationId, timeEntry.workerProfileId, NotificationType.SHIFT_REJECTED, "Attendance rejected", reason, {
      timeEntryId,
      shiftId: timeEntry.shiftId,
      shiftTitle: await this.shiftTitle(timeEntry.shiftId),
      businessDate: timeEntry.businessDate,
      reason,
    });

    return updated;
  }

  async requestCorrection(organizationId: string, timeEntryId: string, notes: string, actor: AuthenticatedUser, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId } });
    if (!timeEntry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");

    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.update({ where: { id: timeEntryId }, data: { status: TimeEntryStatus.CORRECTION_REQUESTED } });
      await tx.attendanceApproval.create({
        data: { id: generateId(), timeEntryId, action: ApprovalAction.REQUEST_CORRECTION, actedBy: actor.sub, notes },
      });
      await this.auditService.record(
        { organizationId, actorUserId: actor.sub, action: "TIME_ENTRY_CORRECTION_REQUESTED", entityType: "TimeEntry", entityId: timeEntryId, note: notes, correlationId },
        tx,
      );
      return entry;
    });

    return updated;
  }

  private async assertPeriodNotFinalized(organizationId: string, businessDate: string) {
    const yearMonth = businessDate.slice(0, 7);
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth },
      orderBy: { version: "desc" },
    });
    if (period?.status === "FINALIZED") {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll period has been finalized and can no longer be edited.");
    }
  }

  /** Notifies the worker. `data` never carries money (Workers do not see compensation). */
  private async notifyWorker(organizationId: string, workerProfileId: string, type: NotificationType, title: string, body: string, data: NotificationData) {
    const worker = await this.prisma.workerProfile.findUnique({ where: { id: workerProfileId }, include: { membership: true } });
    if (!worker) return;
    await this.notifications.notify({ organizationId, recipientUserId: worker.membership.userId, type, title, body, data });
  }

  private async shiftTitle(shiftId: string): Promise<string | null> {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId }, select: { title: true } });
    return shift?.title ?? null;
  }
}
