import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Prisma, Notification } from "@prisma/client";
import type { NotificationType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { generateId } from "../../common/ids";

export interface NotifyInput {
  organizationId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
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
    const notification = await this.prisma.notification.create({
      data: {
        id: generateId(),
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        dataJson: (input.data ?? {}) as Prisma.InputJsonValue,
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
