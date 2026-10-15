import { Injectable } from "@nestjs/common";
import type { NotificationSubject as NotificationSubjectRow, Prisma } from "@prisma/client";
import { AccountStatus, NotificationHandledOutcome, NotificationSubjectKind, NotificationType, Permission, TimeEntryStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { generateId } from "../../common/ids";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { hasPermission } from "../../common/auth/permissions";
import { scopeOf, shiftScopeWhere, timeEntryScopeWhere, workerScopeWhere } from "../../common/scope/scope-filters";

type Client = Pick<Prisma.TransactionClient, "notificationSubject"> | PrismaService;

/** What a subject is about: its kind and the record (a time entry, a worker profile, an issue report). */
export interface SubjectRef {
  kind: NotificationSubjectKind;
  refId: string;
}

/** Shared by every manager's copy of a notification: who settled its subject, and when. */
export interface HandledView {
  at: string;
  by: { userId: string; fullLegalName: string };
  outcome: NotificationHandledOutcome;
  note: string | null;
}

export interface SubjectView {
  id: string;
  kind: NotificationSubjectKind;
  refId: string;
  handled: HandledView | null;
}

/** What a notification asks its reader to do (null: only for information). */
export interface NotificationActionView {
  kind: "REVIEW_ATTENDANCE" | "OPEN_ENTRY" | "REVIEW_OFFLINE" | "REVIEW_ONBOARDING" | "RESOLVE_SUPERVISOR_ISSUE";
  timeEntryId?: string;
  workerProfileId?: string;
  issueId?: string;
}

function idIn(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

/**
 * The action a notification asks for, for this reader: from its type and the
 * ids of its subject (or, for a notification older than subjects, of its
 * data). Only when the reader may open the screen where it is settled;
 * otherwise it is information for them.
 */
export function actionOf(
  notification: { type: string; dataJson: unknown },
  subject: Pick<SubjectView, "kind" | "refId"> | null,
  reader: Pick<AuthenticatedUser, "permissions" | "role">,
): NotificationActionView | null {
  const data = notification.dataJson !== null && typeof notification.dataJson === "object" && !Array.isArray(notification.dataJson) ? (notification.dataJson as Record<string, unknown>) : {};
  const refOf = (kind: NotificationSubjectKind, key: string) => (subject?.kind === kind ? subject.refId : idIn(data, key));
  switch (notification.type) {
    case NotificationType.WORKER_CLOCKED_OUT:
    case NotificationType.EMERGENCY_SHIFT_ENDED: {
      const timeEntryId = refOf(NotificationSubjectKind.ATTENDANCE, "timeEntryId");
      return timeEntryId && hasPermission(reader, Permission.VIEW_ATTENDANCE) ? { kind: "REVIEW_ATTENDANCE", timeEntryId, workerProfileId: idIn(data, "workerProfileId") } : null;
    }
    case NotificationType.OVERTIME_THRESHOLD_CROSSED: {
      const timeEntryId = refOf(NotificationSubjectKind.ATTENDANCE, "timeEntryId");
      return timeEntryId && hasPermission(reader, Permission.VIEW_ATTENDANCE) ? { kind: "OPEN_ENTRY", timeEntryId, workerProfileId: idIn(data, "workerProfileId") } : null;
    }
    case NotificationType.OFFLINE_EVENT_REJECTED:
    case NotificationType.SUSPICIOUS_LOCATION_DETECTED: {
      const workerProfileId = refOf(NotificationSubjectKind.OFFLINE_REVIEW, "workerProfileId");
      return workerProfileId && hasPermission(reader, Permission.VIEW_ATTENDANCE) ? { kind: "REVIEW_OFFLINE", workerProfileId } : null;
    }
    case NotificationType.ONBOARDING_SUBMITTED: {
      const workerProfileId = refOf(NotificationSubjectKind.ONBOARDING, "workerProfileId");
      return workerProfileId && hasPermission(reader, Permission.APPROVE_ONBOARDING) ? { kind: "REVIEW_ONBOARDING", workerProfileId } : null;
    }
    case NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED: {
      const issueId = refOf(NotificationSubjectKind.SUPERVISOR_ISSUE, "issueId");
      return issueId && hasPermission(reader, Permission.VIEW_OPERATIONS) ? { kind: "RESOLVE_SUPERVISOR_ISSUE", issueId } : null;
    }
    default:
      return null;
  }
}

/**
 * Notification subjects (mobile manager mode): the thing notifications are
 * about. Every manager's notification about one entry, one worker's offline
 * records, one application or one supervisor report points at the same
 * subject, so it is settled once for all of them -- by the action that
 * solves it (an approval, a decision, a resolution), or explicitly when
 * nothing else settles it. A new notification about a settled subject opens
 * it again. Settling is audited.
 */
@Injectable()
export class NotificationSubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The subject's id: created when missing, opened again when it was settled (a new notification about it). */
  async open(organizationId: string, ref: SubjectRef, client: Client = this.prisma): Promise<string> {
    const subject = await client.notificationSubject.upsert({
      where: { organizationId_kind_refId: { organizationId, kind: ref.kind, refId: ref.refId } },
      create: { id: generateId(), organizationId, kind: ref.kind, refId: ref.refId },
      update: { handledAt: null, handledBy: null, handledOutcome: null, handledNote: null },
      select: { id: true },
    });
    return subject.id;
  }

  /**
   * Settles the subject of `ref`, if there is one and it is still open (the
   * first to settle it is the one shown; a concurrent second does nothing).
   * Called by the actions that solve it, inside their transaction when they
   * have one. Audited.
   */
  async settle(
    organizationId: string,
    ref: SubjectRef,
    actor: Pick<AuthenticatedUser, "sub">,
    outcome: NotificationHandledOutcome,
    note: string | null,
    correlationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const subject = await client.notificationSubject.findUnique({
      where: { organizationId_kind_refId: { organizationId, kind: ref.kind, refId: ref.refId } },
      select: { id: true },
    });
    if (!subject) return;
    const settled = await client.notificationSubject.updateMany({
      where: { id: subject.id, handledAt: null },
      data: { handledAt: new Date(), handledBy: actor.sub, handledOutcome: outcome, handledNote: note },
    });
    if (settled.count === 0) return;
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.sub,
        action: "NOTIFICATION_SUBJECT_HANDLED",
        entityType: "NotificationSubject",
        entityId: subject.id,
        field: "handledOutcome",
        newValue: outcome,
        note: note ?? undefined,
        correlationId,
      },
      tx,
    );
  }

  /** The subjects of a list of notifications, with who settled them (one query each for the subjects and the names). */
  async views(subjectIds: readonly string[]): Promise<Map<string, SubjectView>> {
    const ids = [...new Set(subjectIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.notificationSubject.findMany({ where: { id: { in: ids } } });
    return this.toViews(rows);
  }

  /**
   * For notifications from before subjects existed (nothing to settle them
   * with): which of their actions still wait -- an entry still pending
   * approval (or still open, for the long-shift alert), an application still
   * pending. Old offline-record notifications have no state to read: they
   * are information only (new ones have a subject to mark reviewed).
   */
  async stillWaiting(organizationId: string, actions: readonly NotificationActionView[]): Promise<(action: NotificationActionView) => boolean> {
    const entryIds = [...new Set(actions.flatMap((action) => ((action.kind === "REVIEW_ATTENDANCE" || action.kind === "OPEN_ENTRY") && action.timeEntryId ? [action.timeEntryId] : [])))];
    const applicantIds = [...new Set(actions.flatMap((action) => (action.kind === "REVIEW_ONBOARDING" && action.workerProfileId ? [action.workerProfileId] : [])))];
    const [entries, applicants] = await Promise.all([
      entryIds.length > 0 ? this.prisma.timeEntry.findMany({ where: { organizationId, id: { in: entryIds } }, select: { id: true, status: true } }) : [],
      applicantIds.length > 0
        ? this.prisma.workerProfile.findMany({ where: { organizationId, id: { in: applicantIds } }, select: { id: true, membership: { select: { status: true } } } })
        : [],
    ]);
    const statusOf = new Map(entries.map((entry) => [entry.id, entry.status as string]));
    const pendingApplicants = new Set(applicants.filter((applicant) => applicant.membership.status === AccountStatus.PENDING_APPROVAL).map((applicant) => applicant.id));
    return (action) => {
      switch (action.kind) {
        case "REVIEW_ATTENDANCE":
          return action.timeEntryId !== undefined && statusOf.get(action.timeEntryId) === TimeEntryStatus.PENDING_APPROVAL;
        case "OPEN_ENTRY":
          return action.timeEntryId !== undefined && statusOf.get(action.timeEntryId) === TimeEntryStatus.ACTIVE;
        case "REVIEW_ONBOARDING":
          return action.workerProfileId !== undefined && pendingApplicants.has(action.workerProfileId);
        default:
          return false;
      }
    };
  }

  /** `GET /notification-subjects/:id`: for a reader who may open the screen where it is settled (otherwise 404). */
  async get(organizationId: string, id: string, reader: AuthenticatedUser): Promise<{ id: string; kind: NotificationSubjectKind; handled: HandledView | null }> {
    const subject = await this.findReadable(organizationId, id, reader);
    const view = (await this.toViews([subject])).get(subject.id) as SubjectView;
    return { id: view.id, kind: view.kind, handled: view.handled };
  }

  /**
   * `POST /notification-subjects/:id/handle`: settles a subject that no other
   * action settles -- an entry the manager followed up (the worker was
   * called about an open shift) or a worker's offline records reviewed. An
   * application is settled by approving or rejecting it, a supervisor's
   * report by resolving it (which tells the supervisor): 409 here.
   */
  async handle(organizationId: string, id: string, reader: AuthenticatedUser, note: string | undefined, correlationId: string) {
    const subject = await this.findReadable(organizationId, id, reader);
    if (subject.kind === NotificationSubjectKind.ONBOARDING || subject.kind === NotificationSubjectKind.SUPERVISOR_ISSUE) {
      throw new AppException(409, ErrorCodes.NOTIFICATION_SUBJECT_NOT_HANDLED_HERE, "This is settled by its own decision, not marked handled here.");
    }
    if (subject.kind === NotificationSubjectKind.ATTENDANCE && !(hasPermission(reader, Permission.APPROVE_ATTENDANCE) || hasPermission(reader, Permission.CORRECT_TIME_ENTRIES))) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You may not settle attendance.");
    }
    if (subject.handledAt) throw new AppException(409, ErrorCodes.CONFLICT, "This was already handled.");
    const trimmed = note?.trim() ? note.trim() : null;
    await this.settle(organizationId, { kind: subject.kind, refId: subject.refId }, reader, NotificationHandledOutcome.REVIEWED, trimmed, correlationId);
    return this.get(organizationId, id, reader);
  }

  /** The subject, if the reader holds the permission of its screen and its record is in their projects; otherwise 404 (it does not exist for them). */
  private async findReadable(organizationId: string, id: string, reader: AuthenticatedUser): Promise<NotificationSubjectRow> {
    const notFound = () => new AppException(404, ErrorCodes.NOT_FOUND, "Not found.");
    const subject = UUID_PATTERN.test(id) ? await this.prisma.notificationSubject.findFirst({ where: { id, organizationId } }) : null;
    if (!subject) throw notFound();
    const scope = scopeOf(reader);
    let visible = false;
    switch (subject.kind) {
      case NotificationSubjectKind.ATTENDANCE:
        visible =
          hasPermission(reader, Permission.VIEW_ATTENDANCE) &&
          (await this.prisma.timeEntry.count({ where: { id: subject.refId, organizationId, ...(timeEntryScopeWhere(scope) ?? {}) } })) > 0;
        break;
      case NotificationSubjectKind.OFFLINE_REVIEW:
        visible =
          hasPermission(reader, Permission.VIEW_ATTENDANCE) &&
          (await this.prisma.workerProfile.count({ where: { id: subject.refId, organizationId, ...(workerScopeWhere(scope) ?? {}) } })) > 0;
        break;
      case NotificationSubjectKind.ONBOARDING:
        visible = hasPermission(reader, Permission.APPROVE_ONBOARDING) && (await this.prisma.workerProfile.count({ where: { id: subject.refId, organizationId } })) > 0;
        break;
      case NotificationSubjectKind.SUPERVISOR_ISSUE: {
        const shiftScope = shiftScopeWhere(scope);
        visible =
          hasPermission(reader, Permission.VIEW_OPERATIONS) &&
          (await this.prisma.supervisorIssueReport.count({ where: { id: subject.refId, organizationId, ...(shiftScope ? { shift: shiftScope } : {}) } })) > 0;
        break;
      }
    }
    if (!visible) throw notFound();
    return subject;
  }

  private async toViews(rows: readonly NotificationSubjectRow[]): Promise<Map<string, SubjectView>> {
    const userIds = [...new Set(rows.flatMap((row) => (row.handledBy ? [row.handledBy] : [])))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullLegalName: true } }) : [];
    const nameOf = new Map(users.map((user) => [user.id, user.fullLegalName]));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          kind: row.kind as NotificationSubjectKind,
          refId: row.refId,
          handled:
            row.handledAt && row.handledBy && row.handledOutcome
              ? {
                  at: row.handledAt.toISOString(),
                  by: { userId: row.handledBy, fullLegalName: nameOf.get(row.handledBy) ?? "" },
                  outcome: row.handledOutcome as NotificationHandledOutcome,
                  note: row.handledNote,
                }
              : null,
        },
      ]),
    );
  }
}
