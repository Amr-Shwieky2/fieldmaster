import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Prisma, Notification } from "@prisma/client";
import { AccountStatus, OrgRole, type NotificationType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { hasFinancialData, withoutFinancialData } from "./notification-data";
import { readPushPreferences, receivableNotificationTypes, withPushPreferences } from "./notification-preferences";
import { PushDeliveryService } from "./push/push-delivery.service";

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

/** `GET/PATCH /notifications/preferences` (the contract's `MyNotificationPreferences`). */
export interface MyNotificationPreferences {
  preferences: { type: NotificationType; push: boolean }[];
}

/**
 * Persists an in-app notification and delivers it. Push (Step 9) is a
 * background job per notification (PushDeliveryService: PUSH_PROVIDER `log`
 * in development, `expo` for real devices) that follows the recipient's own
 * push preferences; the in-app notification is always created. Every
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
    private readonly push: PushDeliveryService,
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
    // Step 9: the push goes out in the background (its delivery row is written by the job).
    this.push.enqueue(notification.id);

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

  /** `POST /notifications/read-all`: every unread notification of the caller in this organization. */
  async markAllRead(organizationId: string, recipientUserId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { organizationId, recipientUserId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /** The caller's own push switches (Step 9): one line per type their role can receive; push is on unless they turned it off. */
  async myPreferences(actor: AuthenticatedUser): Promise<MyNotificationPreferences> {
    const membership = await this.prisma.organizationMembership.findUniqueOrThrow({ where: { id: actor.membershipId }, select: { notificationPreferences: true } });
    return this.preferencesView(actor, membership.notificationPreferences);
  }

  /**
   * Changes some of the caller's push switches; types left out keep theirs.
   * A type the caller's role never receives, or the same type twice, is a
   * 400 (`details.field` = "preferences"). In-app notifications are not
   * affected: they are always kept.
   */
  async updateMyPreferences(actor: AuthenticatedUser, changes: readonly { type: NotificationType; push: boolean }[]): Promise<MyNotificationPreferences> {
    const receivable = new Set(receivableNotificationTypes(actor.role, actor.workerProfileId !== null));
    const seen = new Set<string>();
    for (const change of changes) {
      if (!receivable.has(change.type)) {
        throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "You do not receive this type of notification.", { field: "preferences", type: change.type });
      }
      if (seen.has(change.type)) {
        throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Each notification type may appear only once.", { field: "preferences", type: change.type });
      }
      seen.add(change.type);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMembership.findUniqueOrThrow({ where: { id: actor.membershipId }, select: { notificationPreferences: true } });
      return tx.organizationMembership.update({
        where: { id: actor.membershipId },
        data: { notificationPreferences: withPushPreferences(membership.notificationPreferences, changes) },
        select: { notificationPreferences: true },
      });
    });
    return this.preferencesView(actor, updated.notificationPreferences);
  }

  private preferencesView(actor: AuthenticatedUser, stored: Prisma.JsonValue): MyNotificationPreferences {
    const push = readPushPreferences(stored);
    return {
      preferences: receivableNotificationTypes(actor.role, actor.workerProfileId !== null).map((type) => ({ type, push: push[type] ?? true })),
    };
  }
}
