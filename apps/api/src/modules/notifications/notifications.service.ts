import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Prisma, Notification } from "@prisma/client";
import { AccountStatus, OrgRole, type NotificationType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { generateId } from "../../common/ids";
import { hasFinancialData, withoutFinancialData } from "./notification-data";

export interface NotifyInput {
  organizationId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Values the text is built from, for localized rendering (see notification-data.ts). Money only for Owner recipients. */
  data?: Record<string, unknown>;
}

export const NOTIFICATION_CREATED_EVENT = "notification.created";
export interface NotificationCreatedEvent {
  recipientUserId: string;
  notification: Notification;
}

/**
 * Persists an in-app notification and "delivers" it. Push delivery uses a
 * dev adapter (logs the payload) unless Firebase credentials are configured
 * -- see IMPLEMENTATION_STATUS.md for what's wired vs. stubbed. Every
 * notification also emits `notification.created`, which the WebSocket
 * gateway and SSE stream both subscribe to for real-time delivery; clients
 * that don't hold a live connection can still poll GET /notifications.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger("Notifications");

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async notify(input: NotifyInput) {
    const data = await this.guardFinancialData(input);
    const notification = await this.prisma.notification.create({
      data: {
        id: generateId(),
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        dataJson: data as Prisma.InputJsonValue,
      },
    });

    const channel = process.env.FIREBASE_PROJECT_ID ? "PUSH_FCM" : "PUSH_DEV_LOG";
    if (!process.env.FIREBASE_PROJECT_ID) {
      this.logger.log(`[DEV PUSH -> ${input.recipientUserId}] ${input.title}: ${input.body}`);
    }
    await this.prisma.notificationDelivery.create({
      data: {
        id: generateId(),
        notificationId: notification.id,
        channel,
        status: "DELIVERED",
        attemptedAt: new Date(),
        deliveredAt: new Date(),
      },
    });
    await this.prisma.notificationDelivery.create({
      data: {
        id: generateId(),
        notificationId: notification.id,
        channel: "IN_APP",
        status: "DELIVERED",
        attemptedAt: new Date(),
        deliveredAt: new Date(),
      },
    });

    this.eventEmitter.emit(NOTIFICATION_CREATED_EVENT, {
      recipientUserId: input.recipientUserId,
      notification,
    } satisfies NotificationCreatedEvent);

    return notification;
  }

  async notifyMany(inputs: NotifyInput[]) {
    return Promise.all(inputs.map((input) => this.notify(input)));
  }

  /**
   * Safety net for financial isolation: money values (`*Agorot` keys) in
   * `data` are kept only when the recipient is an active Owner of the
   * organization. Call sites already send money to Owners only; this makes a
   * mistake there strip the values (and log) instead of leaking them to a
   * Field Manager or Worker. Costs one lookup, and only when data has money.
   */
  private async guardFinancialData(input: NotifyInput): Promise<Record<string, unknown>> {
    const data = input.data ?? {};
    if (!hasFinancialData(data)) return data;
    const ownerMembership = await this.prisma.organizationMembership.findFirst({
      where: { organizationId: input.organizationId, userId: input.recipientUserId, role: OrgRole.OWNER, status: AccountStatus.ACTIVE, archivedAt: null },
      select: { id: true },
    });
    if (ownerMembership) return data;
    this.logger.warn(`Stripped financial values from a ${input.type} notification for non-Owner recipient ${input.recipientUserId}.`);
    return withoutFinancialData(data);
  }

  async listForUser(organizationId: string, recipientUserId: string) {
    return this.prisma.notification.findMany({
      where: { organizationId, recipientUserId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async markRead(notificationId: string, recipientUserId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, recipientUserId },
      data: { readAt: new Date() },
    });
  }
}
