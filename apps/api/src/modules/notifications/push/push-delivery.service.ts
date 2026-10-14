import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { generateId } from "../../../common/ids";
import { QUEUE_NAMES } from "../../../common/queue/queue.constants";
import { isPushEnabled } from "../notification-preferences";
import { buildPushContent } from "./push-content";
import { PUSH_ANDROID_CHANNEL_ID, PUSH_PROVIDER, type PushMessage, type PushProvider } from "./push-provider";

/** How a push delivery ended, as recorded on the notification's delivery row (`error` holds a code, never text). */
export const PushDeliveryStatus = {
  DELIVERED: "DELIVERED",
  /** Not sent on purpose: the member turned push off for this type (PUSH_DISABLED), or has no device with a push token (NO_PUSH_DEVICE). */
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
} as const;
export type PushDeliveryStatus = (typeof PushDeliveryStatus)[keyof typeof PushDeliveryStatus];

export const PUSH_DISABLED = "PUSH_DISABLED";
export const NO_PUSH_DEVICE = "NO_PUSH_DEVICE";
/** Expo's ticket error for a token that no longer reaches an app (uninstalled, or the token changed): it is dropped. */
export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

/**
 * Push delivery of in-app notifications (Step 9). `NotificationsService`
 * queues one job per notification (BullMQ, so a slow push service never
 * delays the request that created it); the job sends it to the recipient's
 * devices that are not revoked and have a push token, unless the member
 * turned push off for that type -- the in-app notification exists either
 * way. Every outcome is a NotificationDelivery row on the provider's channel.
 * Nothing here logs a push token or the notification's text.
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger("Push");

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    @InjectQueue(QUEUE_NAMES.PUSH_DELIVERY) private readonly queue: Queue,
  ) {}

  /** Queues the push of a notification just created. Never awaited by the caller and never throws: a lost push must not fail the request. */
  enqueue(notificationId: string): void {
    this.queue
      .add(
        "deliver",
        { notificationId },
        { jobId: notificationId, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 100, removeOnFail: 100 },
      )
      .catch((error: unknown) => {
        this.logger.warn(`Could not queue the push of notification ${notificationId} (${error instanceof Error ? error.name : "unknown error"}).`);
      });
  }

  /**
   * Sends one notification's push and records the outcome. Safe to run again
   * (a retried job): a delivery already recorded as sent or skipped is not
   * sent twice. Throws only when the provider could not be reached, so the
   * job retries.
   */
  async deliver(notificationId: string): Promise<PushDeliveryStatus | null> {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) return null;
    const existing = await this.prisma.notificationDelivery.findFirst({ where: { notificationId, channel: this.provider.channel } });
    if (existing && existing.status !== PushDeliveryStatus.FAILED) return existing.status as PushDeliveryStatus;

    const record = async (status: PushDeliveryStatus, error: string | null) => {
      const now = new Date();
      const data = { status, error, attemptedAt: now, deliveredAt: status === PushDeliveryStatus.DELIVERED ? now : null };
      if (existing) await this.prisma.notificationDelivery.update({ where: { id: existing.id }, data });
      else await this.prisma.notificationDelivery.create({ data: { id: generateId(), notificationId, channel: this.provider.channel, ...data } });
      return status;
    };

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { organizationId: notification.organizationId, userId: notification.recipientUserId },
      select: { notificationPreferences: true },
    });
    const skip = (reason: string) => {
      this.provider.skipped?.(notification, reason);
      return record(PushDeliveryStatus.SKIPPED, reason);
    };
    if (!isPushEnabled(membership?.notificationPreferences, notification.type)) return skip(PUSH_DISABLED);

    const devices = await this.prisma.userDevice.findMany({
      where: { userId: notification.recipientUserId, revokedAt: null, pushToken: { not: null } },
      select: { id: true, pushToken: true },
    });
    if (devices.length === 0) return skip(NO_PUSH_DEVICE);

    const content = buildPushContent(notification);
    const messages: PushMessage[] = devices.map((device) => ({
      to: device.pushToken!,
      title: content.title,
      body: content.body,
      data: content.data,
      sound: "default",
      channelId: PUSH_ANDROID_CHANNEL_ID,
    }));
    let tickets;
    try {
      tickets = await this.provider.send(messages);
    } catch (error) {
      await record(PushDeliveryStatus.FAILED, "PROVIDER_UNAVAILABLE");
      throw error;
    }

    const unregistered = devices.filter((_, index) => {
      const ticket = tickets[index];
      return ticket !== undefined && !ticket.ok && ticket.error === DEVICE_NOT_REGISTERED;
    });
    if (unregistered.length > 0) {
      await this.prisma.userDevice.updateMany({ where: { id: { in: unregistered.map((device) => device.id) } }, data: { pushToken: null } });
    }
    const sent = tickets.filter((ticket) => ticket.ok).length;
    if (sent > 0) return record(PushDeliveryStatus.DELIVERED, null);
    const firstError = tickets.find((ticket): ticket is { ok: false; error: string } => !ticket.ok)?.error ?? "UNKNOWN";
    this.logger.warn(`Push of notification ${notificationId} was refused for every device (${firstError}).`);
    return record(PushDeliveryStatus.FAILED, firstError);
  }
}
