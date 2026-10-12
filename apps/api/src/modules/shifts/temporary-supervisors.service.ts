import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  AccountStatus,
  AttendanceFlag,
  CheckInMethod,
  EventOrigin,
  LocationValidationStatus,
  NotificationType,
  ShiftStatus,
  ShiftWorkerPresence,
  TemporaryPointStatus,
  TemporarySupervisorState,
  TimeEntryStatus,
} from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationAudienceService } from "../notifications/notification-audience.service";
import { OperationsChangeKind, RealtimeEventsService } from "../notifications/realtime-events";
import { loadWorkerName } from "../notifications/notification-data";
import type { AssignTemporarySupervisorDto, ReportIssueDto } from "./dto/temporary-supervisor.dto";

/** Shift statuses after which nobody supervises it any more (and no point can be opened for it). */
const ENDED_SHIFT_STATUSES: string[] = [ShiftStatus.CLOSED, ShiftStatus.CANCELLED];

type AssignmentLike = { activatedAt: Date; expiresAt: Date; revokedAt: Date | null };

/**
 * Where an assignment stands now. Only ACTIVE gives access: not revoked,
 * inside its window, and its shift is neither closed nor cancelled.
 */
export function temporarySupervisorState(assignment: AssignmentLike, shiftStatus: string, now = new Date()): TemporarySupervisorState {
  if (assignment.revokedAt) return TemporarySupervisorState.REVOKED;
  if (ENDED_SHIFT_STATUSES.includes(shiftStatus) || assignment.expiresAt <= now) return TemporarySupervisorState.EXPIRED;
  if (assignment.activatedAt > now) return TemporarySupervisorState.UPCOMING;
  return TemporarySupervisorState.ACTIVE;
}

/** The database condition for an ACTIVE assignment (the same rule as `temporarySupervisorState`). */
function activeAssignmentWhere(now: Date): Prisma.TemporarySupervisorAssignmentWhereInput {
  return { revokedAt: null, activatedAt: { lte: now }, expiresAt: { gt: now }, shift: { status: { notIn: ENDED_SHIFT_STATUSES as ShiftStatus[] } } };
}

const nameSelect = { membership: { select: { user: { select: { fullLegalName: true } } } } } as const;

/**
 * Temporary supervisors (spec section 6.4, Step 6): a time-trackable worker
 * of a shift who, for a time window, sees that shift's workers and may open
 * temporary check-in points. It is a capability checked live on every call
 * -- never a role in a token -- so revoking it, its window ending, or the
 * shift closing ends access at once.
 */
@Injectable()
export class TemporarySupervisorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly notificationAudience: NotificationAudienceService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  // ── Managers ──────────────────────────────────────────────────────────

  async assign(organizationId: string, shiftId: string, dto: AssignTemporarySupervisorDto, actor: AuthenticatedUser, correlationId: string) {
    const shift = UUID_PATTERN.test(shiftId) ? await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId } }) : null;
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");
    if (ENDED_SHIFT_STATUSES.includes(shift.status)) {
      throw new AppException(409, ErrorCodes.SHIFT_NOT_OPEN, "This shift is closed or cancelled.");
    }

    const worker = await this.prisma.workerProfile.findFirst({
      where: { id: dto.workerProfileId, organizationId },
      include: { membership: { select: { isTimeTrackable: true, status: true, archivedAt: true } } },
    });
    if (!worker) throw new AppException(404, ErrorCodes.NOT_FOUND, "Worker not found.");
    const onShift = await this.prisma.shiftAssignment.findFirst({ where: { shiftId, workerProfileId: worker.id, removedAt: null }, select: { id: true } });
    if (!worker.membership.isTimeTrackable || worker.membership.status !== AccountStatus.ACTIVE || worker.membership.archivedAt || !onShift) {
      throw new AppException(409, ErrorCodes.TEMPORARY_SUPERVISOR_NOT_ON_SHIFT, "A temporary supervisor must be an active, time-trackable worker assigned to this shift.");
    }

    const now = new Date();
    const activatedAt = dto.activatedAt ? new Date(dto.activatedAt) : now;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : shift.scheduledEnd;
    if (expiresAt <= activatedAt || expiresAt <= now) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "The assignment must end after it starts, and in the future.");
    }
    const overlapping = await this.prisma.temporarySupervisorAssignment.findFirst({
      where: { shiftId, workerProfileId: worker.id, revokedAt: null, activatedAt: { lt: expiresAt }, expiresAt: { gt: activatedAt } },
      select: { id: true },
    });
    if (overlapping) {
      throw new AppException(409, ErrorCodes.TEMPORARY_SUPERVISOR_ALREADY_ASSIGNED, "This worker is already a temporary supervisor of this shift for that time.");
    }

    const assignment = await this.prisma.temporarySupervisorAssignment.create({
      data: {
        id: generateId(),
        shiftId,
        workerProfileId: worker.id,
        activatedAt,
        expiresAt,
        canOpenCheckInPoints: dto.canOpenCheckInPoints ?? true,
        assignedBy: actor.sub,
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TEMPORARY_SUPERVISOR_ASSIGNED",
      entityType: "TemporarySupervisorAssignment",
      entityId: assignment.id,
      field: "canOpenCheckInPoints",
      newValue: String(assignment.canOpenCheckInPoints),
      correlationId,
    });
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.TEMPORARY_SUPERVISOR);

    return assignment;
  }

  /** A shift's assignments with their state now (shift page), newest first. */
  async listForShift(organizationId: string, shiftId: string) {
    const shift = UUID_PATTERN.test(shiftId)
      ? await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId }, select: { id: true, status: true } })
      : null;
    if (!shift) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");

    const assignments = await this.prisma.temporarySupervisorAssignment.findMany({
      where: { shiftId },
      include: { worker: { select: { id: true, ...nameSelect } } },
      orderBy: { createdAt: "desc" },
    });
    const userIds = [...new Set(assignments.flatMap((a) => [a.assignedBy, a.revokedBy]).filter((id): id is string => id !== null))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullLegalName: true } }) : [];
    const nameOf = (id: string | null) => (id ? (users.find((user) => user.id === id)?.fullLegalName ?? null) : null);
    const now = new Date();

    return assignments.map((assignment) => ({
      id: assignment.id,
      shiftId: assignment.shiftId,
      worker: { id: assignment.worker.id, fullLegalName: assignment.worker.membership.user.fullLegalName },
      activatedAt: assignment.activatedAt,
      expiresAt: assignment.expiresAt,
      canOpenCheckInPoints: assignment.canOpenCheckInPoints,
      state: temporarySupervisorState(assignment, shift.status, now),
      assignedByName: nameOf(assignment.assignedBy),
      revokedAt: assignment.revokedAt,
      revokedByName: nameOf(assignment.revokedBy),
      createdAt: assignment.createdAt,
    }));
  }

  async revoke(organizationId: string, id: string, actor: AuthenticatedUser, correlationId: string) {
    const assignment = UUID_PATTERN.test(id)
      ? await this.prisma.temporarySupervisorAssignment.findFirst({ where: { id, shift: { organizationId } } })
      : null;
    if (!assignment) throw new AppException(404, ErrorCodes.NOT_FOUND, "Assignment not found.");
    if (assignment.revokedAt) throw new AppException(409, ErrorCodes.CONFLICT, "This assignment was already revoked.");

    const updated = await this.prisma.temporarySupervisorAssignment.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy: actor.sub },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TEMPORARY_SUPERVISOR_REVOKED",
      entityType: "TemporarySupervisorAssignment",
      entityId: id,
      correlationId,
    });
    this.realtime.operationsChanged(organizationId, OperationsChangeKind.TEMPORARY_SUPERVISOR);

    return updated;
  }

  /** The worker's ACTIVE assignment for this shift, or null (checked live on every use). */
  async findActiveAssignmentForShift(shiftId: string, workerProfileId: string) {
    return this.prisma.temporarySupervisorAssignment.findFirst({ where: { shiftId, workerProfileId, ...activeAssignmentWhere(new Date()) } });
  }

  // ── The supervisor themself ───────────────────────────────────────────

  /** The caller's ACTIVE assignments (none for a member without a worker profile). */
  async mine(organizationId: string, actor: AuthenticatedUser) {
    if (!actor.workerProfileId) return [];
    const assignments = await this.prisma.temporarySupervisorAssignment.findMany({
      where: { workerProfileId: actor.workerProfileId, shift: { organizationId }, ...activeAssignmentWhere(new Date()) },
      include: { shift: { select: { id: true, title: true, shiftType: true, scheduledStart: true, scheduledEnd: true, site: { select: { name: true } } } } },
      orderBy: { activatedAt: "asc" },
    });
    return assignments.map((assignment) => ({
      id: assignment.id,
      activatedAt: assignment.activatedAt,
      expiresAt: assignment.expiresAt,
      canOpenCheckInPoints: assignment.canOpenCheckInPoints,
      shift: {
        id: assignment.shift.id,
        title: assignment.shift.title,
        shiftType: assignment.shift.shiftType,
        scheduledStart: assignment.shift.scheduledStart,
        scheduledEnd: assignment.shift.scheduledEnd,
        siteName: assignment.shift.site?.name ?? null,
      },
    }));
  }

  /**
   * One of the caller's assignments, only while it is ACTIVE. Another
   * member's assignment (or an unknown id) is a 404; the caller's own but no
   * longer (or not yet) active one is a 403.
   */
  async requireActiveAssignment(organizationId: string, assignmentId: string, actor: AuthenticatedUser) {
    const assignment =
      actor.workerProfileId && UUID_PATTERN.test(assignmentId)
        ? await this.prisma.temporarySupervisorAssignment.findFirst({
            where: { id: assignmentId, workerProfileId: actor.workerProfileId, shift: { organizationId } },
            include: { shift: true },
          })
        : null;
    if (!assignment) throw new AppException(404, ErrorCodes.NOT_FOUND, "Assignment not found.");
    if (temporarySupervisorState(assignment, assignment.shift.status) !== TemporarySupervisorState.ACTIVE) {
      throw new AppException(403, ErrorCodes.TEMPORARY_SUPERVISOR_INACTIVE, "This temporary supervisor assignment is not active.");
    }
    return assignment;
  }

  /**
   * The supervised shift's workers with their operational attendance only:
   * name, clocked in/out and when, the location outcome and flags. No money,
   * no phone numbers, nothing about other shifts or projects.
   */
  async shiftView(organizationId: string, assignmentId: string, actor: AuthenticatedUser) {
    const assignment = await this.requireActiveAssignment(organizationId, assignmentId, actor);
    const shiftId = assignment.shiftId;

    const [shift, crew, entries, attempts, points] = await Promise.all([
      this.prisma.shift.findUniqueOrThrow({
        where: { id: shiftId },
        select: {
          id: true,
          title: true,
          shiftType: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          businessDate: true,
          checkInMethod: true,
          project: { select: { name: true } },
          site: { select: { name: true, latitude: true, longitude: true } },
          geofence: { select: { centerLatitude: true, centerLongitude: true, radiusMeters: true } },
        },
      }),
      this.prisma.shiftAssignment.findMany({
        where: { shiftId, removedAt: null },
        include: { worker: { select: { id: true, ...nameSelect } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.timeEntry.findMany({
        where: { shiftId },
        select: {
          id: true,
          workerProfileId: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          checkInMethod: true,
          isEmergency: true,
          devRewoundAt: true,
          clockEvents: {
            select: { eventType: true, origin: true, locationValidationStatus: true, mockLocationSuspected: true, temporaryCheckInPointId: true },
            orderBy: { serverReceivedAt: "asc" },
          },
        },
        orderBy: { clockInAt: "desc" },
      }),
      this.prisma.rejectedClockAttempt.findMany({ where: { shiftId }, select: { workerProfileId: true, code: true } }),
      this.prisma.temporaryCheckInPoint.findMany({
        where: { shiftId, status: TemporaryPointStatus.ACTIVE, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const workers = crew.map(({ worker }) => {
      // The worker's latest entry for this shift (entries are newest first).
      const entry = entries.find((candidate) => candidate.workerProfileId === worker.id) ?? null;
      const ownAttempts = attempts.filter((attempt) => attempt.workerProfileId === worker.id);
      const lastEvent = entry?.clockEvents.at(-1) ?? null;
      const flags: AttendanceFlag[] = [];
      if (ownAttempts.some((attempt) => attempt.code === ErrorCodes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS)) flags.push(AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT);
      if (
        entry?.clockEvents.some((event) => event.locationValidationStatus === LocationValidationStatus.FLAGGED || event.mockLocationSuspected) ||
        ownAttempts.some((attempt) => attempt.code === ErrorCodes.MOCK_LOCATION_BLOCKED)
      ) {
        flags.push(AttendanceFlag.SUSPICIOUS_LOCATION);
      }
      if (entry?.clockEvents.some((event) => event.origin === EventOrigin.OFFLINE)) flags.push(AttendanceFlag.OFFLINE);
      if (entry?.checkInMethod === CheckInMethod.FLEXI_CHECK && !entry.isEmergency) flags.push(AttendanceFlag.FLEXI_CHECK);
      if (entry?.clockEvents.some((event) => event.temporaryCheckInPointId !== null)) flags.push(AttendanceFlag.TEMPORARY_POINT);
      if (entry?.isEmergency) flags.push(AttendanceFlag.EMERGENCY);
      if (entry?.devRewoundAt) flags.push(AttendanceFlag.DEV_REWOUND);

      return {
        workerProfileId: worker.id,
        fullLegalName: worker.membership.user.fullLegalName,
        presence: !entry
          ? ShiftWorkerPresence.NOT_CLOCKED_IN
          : entry.status === TimeEntryStatus.ACTIVE
            ? ShiftWorkerPresence.CLOCKED_IN
            : ShiftWorkerPresence.CLOCKED_OUT,
        clockInAt: entry?.clockInAt ?? null,
        clockOutAt: entry?.clockOutAt ?? null,
        locationOutcome: lastEvent?.locationValidationStatus ?? null,
        flags,
      };
    });

    return {
      assignment: { id: assignment.id, activatedAt: assignment.activatedAt, expiresAt: assignment.expiresAt, canOpenCheckInPoints: assignment.canOpenCheckInPoints },
      shift: {
        id: shift.id,
        title: shift.title,
        shiftType: shift.shiftType,
        status: shift.status,
        scheduledStart: shift.scheduledStart,
        scheduledEnd: shift.scheduledEnd,
        businessDate: shift.businessDate,
        checkInMethod: shift.checkInMethod,
        projectName: shift.project?.name ?? null,
        site: shift.site,
        geofence: shift.geofence,
      },
      workers,
      temporaryCheckInPoints: points,
    };
  }

  /** A free-text issue to management: the shift's manager and the Owners (per the notification settings), audited. */
  async reportIssue(organizationId: string, assignmentId: string, dto: ReportIssueDto, actor: AuthenticatedUser, correlationId: string) {
    const assignment = await this.requireActiveAssignment(organizationId, assignmentId, actor);
    const text = dto.text.trim();
    const supervisorName = await loadWorkerName(this.prisma, assignment.workerProfileId);

    const audience = await this.notificationAudience.shiftManagerAndOwners(
      organizationId,
      NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED,
      assignment.shift.managerId,
    );
    const recipients = [...new Set([...(audience.managerUserId ? [audience.managerUserId] : []), ...audience.ownerUserIds])];
    await this.notifications.notifyMany(
      recipients.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        type: NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED,
        title: "Issue reported by a temporary supervisor",
        body: `${supervisorName ?? "A temporary supervisor"} reported an issue on "${assignment.shift.title}": ${text}`,
        data: {
          assignmentId: assignment.id,
          shiftId: assignment.shiftId,
          shiftTitle: assignment.shift.title,
          workerProfileId: assignment.workerProfileId,
          workerName: supervisorName,
          issueText: text,
        },
      })),
    );

    const audit = await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "TEMPORARY_SUPERVISOR_ISSUE_REPORTED",
      entityType: "TemporarySupervisorAssignment",
      entityId: assignment.id,
      note: text,
      correlationId,
    });

    return { reportedAt: audit.createdAt, notifiedCount: recipients.length };
  }
}
