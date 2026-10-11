import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { TimeEntryStatus, TuranStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { TuranAssignmentsService } from "../turan/turan-assignments.service";
import { DEV_REWIND_MAX_MINUTES } from "./dev-tools.constants";

/**
 * Test-mode tools for the admin web's worker simulator. Every route is gated
 * like dev login (404 unless DEV_LOGIN_ENABLED=true, which the API refuses to
 * start with in production) and nothing here bypasses a business rule: the
 * simulator still clocks in/out through the real endpoints.
 */
@Injectable()
export class DevToolsService {
  private readonly logger = new Logger(DevToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly turanAssignments: TuranAssignmentsService,
    @Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment,
  ) {}

  /**
   * Moves an OPEN entry's clock-in back by `minutes` so a long shift (6 h,
   * 9 h, 10 h 30 m) can be tested without waiting. Never silent: the entry
   * is marked (`devRewoundAt`, shown as a badge in the admin web) and a
   * DEV_REWIND audit event records the old and new clock-in.
   */
  async rewindTimeEntry(organizationId: string, timeEntryId: string, minutes: number, actor: AuthenticatedUser, correlationId: string) {
    this.assertDevLoginEnabled();

    const entry = await this.prisma.timeEntry.findFirst({ where: { id: timeEntryId, organizationId } });
    if (!entry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    if (entry.status !== TimeEntryStatus.ACTIVE || entry.clockOutAt !== null || entry.clockInAt === null) {
      throw new AppException(409, ErrorCodes.TIME_ENTRY_NOT_OPEN, "Only an open time entry can be rewound.");
    }
    // An emergency call-out's times are derived from the callout's own
    // start/end clicks (-60 / +15), not from the entry's clockInAt.
    if (entry.isEmergency) {
      throw new AppException(409, ErrorCodes.DEV_REWIND_EMERGENCY_NOT_SUPPORTED, "Emergency call-outs cannot be rewound.");
    }

    const oldClockInAt = entry.clockInAt;
    const newClockInAt = new Date(oldClockInAt.getTime() - minutes * 60_000);
    if (Date.now() - newClockInAt.getTime() > DEV_REWIND_MAX_MINUTES * 60_000) {
      throw new AppException(400, ErrorCodes.DEV_REWIND_LIMIT_EXCEEDED, "A rewound entry may not be open for more than 24 hours.");
    }

    // The business date follows the clock-in, exactly as at a real clock-in;
    // both the current and the resulting payroll period must still be open.
    const newBusinessDate = toBusinessDate(newClockInAt);
    await this.assertPeriodNotFinalized(organizationId, entry.businessDate);
    if (newBusinessDate !== entry.businessDate) {
      await this.assertPeriodNotFinalized(organizationId, newBusinessDate);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional on the values just checked, so a concurrent clock-out or
      // rewind can't be overwritten.
      const result = await tx.timeEntry.updateMany({
        where: { id: entry.id, status: TimeEntryStatus.ACTIVE, clockInAt: oldClockInAt },
        data: { clockInAt: newClockInAt, businessDate: newBusinessDate, devRewoundAt: new Date() },
      });
      if (result.count === 0) {
        throw new AppException(409, ErrorCodes.CONFLICT, "The time entry changed while it was being rewound. Try again.");
      }

      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "DEV_REWIND",
          entityType: "TimeEntry",
          entityId: entry.id,
          field: "clockInAt",
          oldValue: oldClockInAt.toISOString(),
          newValue: newClockInAt.toISOString(),
          note:
            `Test-mode rewind by ${minutes} min (APP_ENV=${this.appEnvironment.appEnv}); ` +
            `business date ${entry.businessDate} -> ${newBusinessDate}`,
          correlationId,
        },
        tx,
      );

      return tx.timeEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { shift: true } });
    });

    this.logger.warn(`[DEV REWIND] Time entry ${entry.id} clock-in moved back ${minutes} min by user ${actor.sub}`);
    return updated;
  }

  /**
   * What the simulator shows next to a worker that the worker-facing API does
   * not expose: their Turan assignments, whether one makes them eligible for
   * an emergency call-out right now, and their active temporary-supervisor
   * assignments. Read-only; called with the simulated worker's own session.
   */
  async workerSimulatorContext(organizationId: string, actor: AuthenticatedUser) {
    this.assertDevLoginEnabled();
    const workerProfileId = actor.workerProfileId;
    if (!workerProfileId) {
      return { workerProfileId: null, turanAssignments: [], emergencyEligibleTuranAssignmentId: null, temporarySupervisorAssignments: [] };
    }

    const now = new Date();
    const turanAssignments = await this.prisma.turanAssignment.findMany({
      where: {
        organizationId,
        OR: [{ assignedWorkerProfileId: workerProfileId }, { backupWorkerProfileId: workerProfileId }],
        status: { in: [TuranStatus.SCHEDULED, TuranStatus.ACTIVE] },
        endAt: { gte: now },
      },
      orderBy: { startAt: "asc" },
      take: 10,
    });

    const temporarySupervisorAssignments = await this.prisma.temporarySupervisorAssignment.findMany({
      where: { workerProfileId, revokedAt: null, activatedAt: { lte: now }, expiresAt: { gt: now }, shift: { organizationId } },
      include: { shift: { select: { id: true, title: true } } },
      orderBy: { activatedAt: "asc" },
    });

    return {
      workerProfileId,
      turanAssignments: turanAssignments.map((t) => ({
        id: t.id,
        turanType: t.turanType,
        status: t.status,
        startAt: t.startAt,
        endAt: t.endAt,
        role: t.assignedWorkerProfileId === workerProfileId ? ("ASSIGNED" as const) : ("BACKUP" as const),
      })),
      // The same check the emergency call-out endpoint runs.
      emergencyEligibleTuranAssignmentId: await this.turanAssignments.isEligibleForEmergency(workerProfileId, now),
      temporarySupervisorAssignments: temporarySupervisorAssignments.map((a) => ({
        id: a.id,
        shiftId: a.shiftId,
        shiftTitle: a.shift.title,
        activatedAt: a.activatedAt,
        expiresAt: a.expiresAt,
      })),
    };
  }

  private async assertPeriodNotFinalized(organizationId: string, businessDate: string) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { organizationId, yearMonth: businessDate.slice(0, 7) },
      orderBy: { version: "desc" },
    });
    if (period?.status === "FINALIZED") {
      throw new AppException(409, ErrorCodes.PAYROLL_PERIOD_FINALIZED, "This payroll period has been finalized and can no longer be edited.");
    }
  }

  private assertDevLoginEnabled() {
    // Defense in depth: the route middleware and guard already return 404.
    if (!this.appEnvironment.devLoginEnabled) throw new NotFoundException("Not found.");
  }
}
