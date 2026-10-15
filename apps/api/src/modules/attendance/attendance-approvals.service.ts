import { Injectable } from "@nestjs/common";
import { ApprovalAction, NotificationHandledOutcome, NotificationSubjectKind, NotificationType, TimeEntryStatus } from "@fieldmaster/shared-types";
import { splitWorkedMinutes } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OperationsChangeKind, RealtimeEventsService } from "../notifications/realtime-events";
import type { NotificationData } from "../notifications/notification-data";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { NotificationSubjectsService } from "../notifications/notification-subjects.service";
import { scopeOf, timeEntryScopeWhere } from "../../common/scope/scope-filters";
import { listOrPage, type PageWindow } from "../../common/validation/page-query";

/** The scope filter of a member restricted to some projects, as an extra `where` for a time entry looked up by id. */
const entryScope = (actor: AuthenticatedUser) => timeEntryScopeWhere(scopeOf(actor)) ?? {};

/** What the approvals queue shows of an entry's shift. */
const PENDING_SHIFT_SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  siteId: true,
  title: true,
  shiftType: true,
  status: true,
  businessDate: true,
  scheduledStart: true,
  scheduledEnd: true,
} as const;

@Injectable()
export class AttendanceApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeEventsService,
    private readonly workRules: WorkRulesService,
    private readonly subjects: NotificationSubjectsService,
  ) {}

  /**
   * The entries waiting for approval, oldest clock-out first: all of them, or
   * one page (`?page=` / `?pageSize=`). Each with its shift, summary and
   * corrections, and the worker by name (not their whole user record).
   */
  async listPendingApproval(organizationId: string, viewer?: AuthenticatedUser, window: PageWindow | null = null) {
    const where = { organizationId, status: TimeEntryStatus.PENDING_APPROVAL, ...(viewer ? entryScope(viewer) : {}) };
    return listOrPage(
      window,
      async (range) => {
        // Flat rows, then the shifts (a few for thousands of entries), summaries, corrections and names
        // read once each: nesting them in every row costs several times more to load and to send.
        const entries = await this.prisma.timeEntry.findMany({ where, orderBy: [{ clockOutAt: "asc" }, { id: "asc" }], ...range });
        const entryIds = entries.map((entry) => entry.id);
        const [shifts, summaries, corrections, workers] = await Promise.all([
          this.prisma.shift.findMany({ where: { id: { in: [...new Set(entries.map((entry) => entry.shiftId))] } }, select: PENDING_SHIFT_SELECT }),
          this.prisma.dailySummary.findMany({ where: { timeEntryId: { in: entryIds } } }),
          this.prisma.manualTimeCorrection.findMany({ where: { timeEntryId: { in: entryIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
          this.prisma.workerProfile.findMany({
            where: { id: { in: [...new Set(entries.map((entry) => entry.workerProfileId))] } },
            select: { id: true, membership: { select: { user: { select: { id: true, fullLegalName: true } } } } },
          }),
        ]);
        const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
        const summaryByEntry = new Map(summaries.map((summary) => [summary.timeEntryId, summary]));
        const workerById = new Map(workers.map((worker) => [worker.id, worker]));
        const correctionsByEntry = new Map<string, typeof corrections>();
        for (const correction of corrections) {
          const list = correctionsByEntry.get(correction.timeEntryId);
          if (list) list.push(correction);
          else correctionsByEntry.set(correction.timeEntryId, [correction]);
        }
        return entries.map((entry) => ({
          ...entry,
          shift: shiftById.get(entry.shiftId) ?? null,
          dailySummary: summaryByEntry.get(entry.id) ?? null,
          corrections: correctionsByEntry.get(entry.id) ?? [],
          worker: workerById.get(entry.workerProfileId) ?? null,
        }));
      },
      () => this.prisma.timeEntry.count({ where }),
    );
  }

  async applyFullDayCredit(organizationId: string, timeEntryId: string, reason: string, actor: AuthenticatedUser, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId, ...entryScope(actor) } });
    if (!timeEntry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    if (!timeEntry.clockOutAt || timeEntry.rawDurationMinutes === null) {
      throw new AppException(400, ErrorCodes.FULL_DAY_CREDIT_NOT_ALLOWED, "The shift must have ended before full-day credit can be applied.");
    }
    // A shorter day than the standard day in force on the entry's business date (9 hours by default).
    const rules = await this.workRules.rulesOn(organizationId, timeEntry.businessDate);
    if (timeEntry.rawDurationMinutes >= rules.standardDayMinutes) {
      throw new AppException(400, ErrorCodes.FULL_DAY_CREDIT_NOT_ALLOWED, "Full-day credit only applies to shifts shorter than the standard working day.");
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

    this.realtime.operationsChanged(organizationId, OperationsChangeKind.ATTENDANCE, timeEntry.shiftId);
    return updated;
  }

  async approve(organizationId: string, timeEntryId: string, actor: AuthenticatedUser, notes: string | undefined, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId, ...entryScope(actor) } });
    if (!timeEntry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    if (timeEntry.status !== TimeEntryStatus.PENDING_APPROVAL && timeEntry.status !== TimeEntryStatus.CORRECTION_REQUESTED) {
      throw new AppException(409, ErrorCodes.CONFLICT, "This time entry is not awaiting approval.");
    }
    await this.assertPeriodNotFinalized(organizationId, timeEntry.businessDate);

    // The shared split (also shown by the admin web's correction preview before a correction is saved),
    // with the work rules in force on the entry's business date.
    const { regularMinutes: approvedRegularMinutes, overtimeMinutes: approvedOvertimeMinutes } = splitWorkedMinutes(
      {
        rawDurationMinutes: timeEntry.rawDurationMinutes ?? 0,
        unpaidBreakMinutes: timeEntry.unpaidBreakMinutes,
        fullDayCredit: timeEntry.fullDayCredit,
      },
      await this.workRules.rulesOn(organizationId, timeEntry.businessDate),
    );

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

    // Mobile manager mode: the entry's notifications show as handled for every manager.
    await this.subjects.settle(organizationId, { kind: NotificationSubjectKind.ATTENDANCE, refId: timeEntryId }, actor, NotificationHandledOutcome.APPROVED, notes ?? null, correlationId);
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.ATTENDANCE, timeEntry.shiftId);
    return updated;
  }

  async reject(organizationId: string, timeEntryId: string, reason: string, actor: AuthenticatedUser, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId, ...entryScope(actor) } });
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

    // Mobile manager mode: the entry's notifications show as handled for every manager.
    await this.subjects.settle(organizationId, { kind: NotificationSubjectKind.ATTENDANCE, refId: timeEntryId }, actor, NotificationHandledOutcome.REJECTED, reason, correlationId);
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.ATTENDANCE, timeEntry.shiftId);
    return updated;
  }

  async requestCorrection(organizationId: string, timeEntryId: string, notes: string, actor: AuthenticatedUser, correlationId: string) {
    const timeEntry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId, ...entryScope(actor) } });
    if (!timeEntry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    // Step 7: sending an entry back changes its status (an approved one would leave payroll), so a finalized month refuses it like any other edit.
    await this.assertPeriodNotFinalized(organizationId, timeEntry.businessDate);

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

    // Mobile manager mode: the entry's notifications show as handled for every manager.
    await this.subjects.settle(organizationId, { kind: NotificationSubjectKind.ATTENDANCE, refId: timeEntryId }, actor, NotificationHandledOutcome.CORRECTION_REQUESTED, notes, correlationId);
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.ATTENDANCE, timeEntry.shiftId);
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
