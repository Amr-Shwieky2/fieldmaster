import { Injectable, Logger } from "@nestjs/common";
import { NotificationType, STANDARD_DAY_MINUTES, TimeEntryStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationAudienceService } from "../notifications/notification-audience.service";
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
  ) {}

  async sweep(now = new Date()): Promise<{ notifiedEntries: number }> {
    const threshold = new Date(now.getTime() - STANDARD_DAY_MINUTES * 60_000);
    const entries = await this.prisma.timeEntry.findMany({
      where: { status: TimeEntryStatus.ACTIVE, clockInAt: { lte: threshold }, longOpenNotifiedAt: null },
      select: { id: true, organizationId: true, workerProfileId: true, clockInAt: true, shift: { select: { id: true, title: true, managerId: true } } },
      orderBy: { clockInAt: "asc" },
      take: SWEEP_BATCH,
    });

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
      const audience = await this.notificationAudience.shiftManagerAndOwners(
        entry.organizationId,
        NotificationType.OVERTIME_THRESHOLD_CROSSED,
        entry.shift.managerId,
      );
      const recipients = [...new Set([...(audience.managerUserId ? [audience.managerUserId] : []), ...audience.ownerUserIds])];
      await this.notifications.notifyMany(
        recipients.map((recipientUserId) => ({
          organizationId: entry.organizationId,
          recipientUserId,
          type: NotificationType.OVERTIME_THRESHOLD_CROSSED,
          title: "Shift open for more than 9 hours",
          body: `${workerName ?? "A worker"} has been clocked in to "${entry.shift.title}" for more than 9 hours.`,
          data: {
            timeEntryId: entry.id,
            shiftId: entry.shift.id,
            shiftTitle: entry.shift.title,
            workerProfileId: entry.workerProfileId,
            workerName,
            clockInAt: entry.clockInAt!.toISOString(),
            openMinutes,
          },
        })),
      );
      this.realtime.operationsChanged(entry.organizationId, OperationsChangeKind.LONG_OPEN_ENTRY);
      notifiedEntries += 1;
    }

    if (notifiedEntries > 0) this.logger.log(`Reported ${notifiedEntries} entr${notifiedEntries === 1 ? "y" : "ies"} open for more than 9 hours.`);
    return { notifiedEntries };
  }
}
