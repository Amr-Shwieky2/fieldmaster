import { Injectable, Logger } from "@nestjs/common";
import { NotificationType, TimeEntryStatus, NotificationSubjectKind } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationAudienceService } from "../notifications/notification-audience.service";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { OperationsChangeKind, RealtimeEventsService } from "../notifications/realtime-events";
import { loadWorkerName } from "../notifications/notification-data";

/** At most this many entries per sweep; the next sweep (a minute later) takes the rest. */
const SWEEP_BATCH = 200;

/**
 * "Open for more than 9 hours" (Step 6): an entry still open a standard day
 * (540 minutes) after its clock-in is reported once to the shift's manager
 * and the Owners -- operational text only, no money -- following the
 * organization's notification settings (OVERTIME_THRESHOLD_CROSSED). A
 * repeatable job runs the sweep every minute; `longOpenNotifiedAt` makes it
 * send at most once per entry, however often or concurrently it runs.
 */
@Injectable()
export class LongOpenEntriesService {
  private readonly logger = new Logger(LongOpenEntriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly notificationAudience: NotificationAudienceService,
    private readonly realtime: RealtimeEventsService,
    private readonly workRules: WorkRulesService,
  ) {}

  /** "Open for more than a standard day": each organization's own standard day (work rules in force today) is the threshold. */
  async sweep(now = new Date()): Promise<{ notifiedEntries: number }> {
    const organizations = await this.prisma.timeEntry.groupBy({
      by: ["organizationId"],
      where: { status: TimeEntryStatus.ACTIVE, clockInAt: { not: null }, longOpenNotifiedAt: null },
    });
    let notifiedEntries = 0;
    for (const { organizationId } of organizations) {
      notifiedEntries += await this.sweepOrganization(organizationId, now);
    }
    if (notifiedEntries > 0) this.logger.log(`Reported ${notifiedEntries} entr${notifiedEntries === 1 ? "y" : "ies"} open for more than a standard day.`);
    return { notifiedEntries };
  }

  private async sweepOrganization(organizationId: string, now: Date): Promise<number> {
    const rules = await this.workRules.current(organizationId);
    const threshold = new Date(now.getTime() - rules.standardDayMinutes * 60_000);
    const entries = await this.prisma.timeEntry.findMany({
      where: { organizationId, status: TimeEntryStatus.ACTIVE, clockInAt: { lte: threshold }, longOpenNotifiedAt: null },
      select: { id: true, organizationId: true, workerProfileId: true, clockInAt: true, shift: { select: { id: true, title: true, managerId: true } } },
      orderBy: { clockInAt: "asc" },
      take: SWEEP_BATCH,
    });
    const hours = rules.standardDayMinutes % 60 === 0 ? `${rules.standardDayMinutes / 60} hours` : `${Math.floor(rules.standardDayMinutes / 60)}h ${rules.standardDayMinutes % 60}m`;

    let notifiedEntries = 0;
    for (const entry of entries) {
      // Claim the entry first: a concurrent sweep (or a clock-out in between) makes this a no-op.
      const claimed = await this.prisma.timeEntry.updateMany({
        where: { id: entry.id, status: TimeEntryStatus.ACTIVE, longOpenNotifiedAt: null },
        data: { longOpenNotifiedAt: now },
      });
      if (claimed.count === 0) continue;

      const workerName = await loadWorkerName(this.prisma, entry.workerProfileId);
      const openMinutes = Math.floor((now.getTime() - entry.clockInAt!.getTime()) / 60_000);
      const recipients = await this.notificationAudience.recipients(entry.organizationId, NotificationType.OVERTIME_THRESHOLD_CROSSED, {
        managerUserId: entry.shift.managerId,
        context: await this.notificationAudience.contextOfShift(entry.shift.id),
      });
      await this.notifications.notifyMany(
        recipients.map((recipient) => ({
          organizationId: entry.organizationId,
          recipientUserId: recipient.userId,
          type: NotificationType.OVERTIME_THRESHOLD_CROSSED,
          title: `Shift open for more than ${hours}`,
          body: `${workerName ?? "A worker"} has been clocked in to "${entry.shift.title}" for more than ${hours}.`,
          data: {
            timeEntryId: entry.id,
            shiftId: entry.shift.id,
            shiftTitle: entry.shift.title,
            workerProfileId: entry.workerProfileId,
            workerName,
            clockInAt: entry.clockInAt!.toISOString(),
            openMinutes,
          },
          subject: { kind: NotificationSubjectKind.ATTENDANCE, refId: entry.id },
        })),
      );
      this.realtime.operationsChanged(entry.organizationId, OperationsChangeKind.LONG_OPEN_ENTRY, entry.shift.id);
      notifiedEntries += 1;
    }
    return notifiedEntries;
  }
}
