import { Injectable } from "@nestjs/common";
import { NotificationHandledOutcome, NotificationSubjectKind, NotificationType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { scopeOf, shiftScopeWhere } from "../../common/scope/scope-filters";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationSubjectsService } from "../notifications/notification-subjects.service";

/**
 * A temporary supervisor's reports (mobile manager mode): a manager who may
 * see live operations reads one within their projects and marks it resolved
 * with a note. The resolution is the report's notification subject's
 * handled state (shown on every manager's copy of the notification); it is
 * audited and the supervisor is told.
 */
@Injectable()
export class SupervisorIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly subjects: NotificationSubjectsService,
  ) {}

  async get(organizationId: string, id: string, reader: AuthenticatedUser) {
    const report = await this.find(organizationId, id, reader);
    const subject = await this.prisma.notificationSubject.findUnique({
      where: { organizationId_kind_refId: { organizationId, kind: NotificationSubjectKind.SUPERVISOR_ISSUE, refId: report.id } },
      select: { id: true },
    });
    const handled = subject ? ((await this.subjects.views([subject.id])).get(subject.id)?.handled ?? null) : null;
    return {
      id: report.id,
      text: report.text,
      reportedAt: report.createdAt.toISOString(),
      shift: {
        id: report.shift.id,
        title: report.shift.title,
        siteName: report.shift.site?.name ?? null,
        scheduledStart: report.shift.scheduledStart.toISOString(),
        scheduledEnd: report.shift.scheduledEnd.toISOString(),
      },
      supervisor: {
        workerProfileId: report.assignment.worker.id,
        fullLegalName: report.assignment.worker.membership.user.fullLegalName,
        phoneNumber: report.assignment.worker.membership.user.phoneNumber,
      },
      resolved: handled ? { at: handled.at, by: handled.by, note: handled.note ?? "" } : null,
    };
  }

  /** «تم الحل»: settles the report with a note (audited) and tells the supervisor. 409 when it was already resolved. */
  async resolve(organizationId: string, id: string, note: string, reader: AuthenticatedUser, correlationId: string) {
    const report = await this.find(organizationId, id, reader);
    const text = note.trim();
    if (!text) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "A note is required.", { field: "note" });
    const ref = { kind: NotificationSubjectKind.SUPERVISOR_ISSUE, refId: report.id };
    const existing = await this.prisma.notificationSubject.findUnique({
      where: { organizationId_kind_refId: { organizationId, ...ref } },
      select: { handledAt: true },
    });
    if (existing?.handledAt) throw new AppException(409, ErrorCodes.CONFLICT, "This report was already resolved.");
    if (!existing) await this.subjects.open(organizationId, ref);

    await this.prisma.$transaction(async (tx) => {
      await this.subjects.settle(organizationId, ref, reader, NotificationHandledOutcome.RESOLVED, text, correlationId, tx);
      await this.audit.record(
        {
          organizationId,
          actorUserId: reader.sub,
          action: "SUPERVISOR_ISSUE_RESOLVED",
          entityType: "SupervisorIssueReport",
          entityId: report.id,
          note: text,
          correlationId,
        },
        tx,
      );
    });

    const resolverName = (await this.prisma.user.findUnique({ where: { id: reader.sub }, select: { fullLegalName: true } }))?.fullLegalName ?? null;
    await this.notifications.notify({
      organizationId,
      recipientUserId: report.reportedBy,
      type: NotificationType.TEMPORARY_SUPERVISOR_ISSUE_RESOLVED,
      title: "Your report was resolved",
      body: `Your report on "${report.shift.title}" was resolved${resolverName ? ` by ${resolverName}` : ""}: ${text}`,
      data: { issueId: report.id, assignmentId: report.assignmentId, shiftId: report.shiftId, shiftTitle: report.shift.title, resolverName, note: text },
    });
    return this.get(organizationId, id, reader);
  }

  /** The report, within the reader's projects; otherwise 404 (it does not exist for them). */
  private async find(organizationId: string, id: string, reader: AuthenticatedUser) {
    const shiftScope = shiftScopeWhere(scopeOf(reader));
    const report = UUID_PATTERN.test(id)
      ? await this.prisma.supervisorIssueReport.findFirst({
          where: { id, organizationId, ...(shiftScope ? { shift: shiftScope } : {}) },
          include: {
            shift: { select: { id: true, title: true, scheduledStart: true, scheduledEnd: true, site: { select: { name: true } } } },
            assignment: { select: { worker: { select: { id: true, membership: { select: { user: { select: { fullLegalName: true, phoneNumber: true } } } } } } } },
          },
        })
      : null;
    if (!report) throw new AppException(404, ErrorCodes.NOT_FOUND, "Report not found.");
    return report;
  }
}
