import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Prisma, Notification } from "@prisma/client";
import { AccountStatus, Permission, type NotificationType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { MEMBERSHIP_ACCESS_INCLUDE, effectivePermissionsOf } from "../../common/auth/member-access";
import { scopeOf, shiftScopeWhere } from "../../common/scope/scope-filters";
import { hasFinancialData, withoutFinancialData } from "./notification-data";
import { readPushPreferences, receivableNotificationTypes, withPushPreferences } from "./notification-preferences";
import { PushDeliveryService } from "./push/push-delivery.service";
import { actionOf, NotificationSubjectsService, type SubjectRef } from "./notification-subjects.service";

export interface NotifyInput {
  organizationId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Values the text is built from, for localized rendering (see notification-data.ts). Money only for recipients who may see money (VIEW_FINANCIALS). */
  data?: Record<string, unknown>;
  /**
   * Mobile manager mode: what the notification is about (an entry to review,
   * a worker's offline records, an application, a supervisor's report).
   * Every manager's notification about it shares one subject, opened again
   * by each new notification; settling it shows as handled for all of them.
   */
  subject?: SubjectRef;
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
    private readonly subjects: NotificationSubjectsService,
  ) {}

  async notify(input: NotifyInput, subjectId?: string) {
    const data = await this.guardFinancialData(input);
    const resolvedSubjectId = subjectId ?? (input.subject ? await this.subjects.open(input.organizationId, input.subject) : null);
    const notification = await this.prisma.notification.create({
      data: {
        id: generateId(),
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        dataJson: data as Prisma.InputJsonValue,
        subjectId: resolvedSubjectId,
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
    // One subject per thing the notifications are about (opened once, shared by every recipient's copy).
    const subjectIds = new Map<string, string>();
    for (const input of inputs) {
      if (!input.subject) continue;
      const key = `${input.organizationId}:${input.subject.kind}:${input.subject.refId}`;
      if (!subjectIds.has(key)) subjectIds.set(key, await this.subjects.open(input.organizationId, input.subject));
    }
    return Promise.all(
      inputs.map((input) => this.notify(input, input.subject ? subjectIds.get(`${input.organizationId}:${input.subject.kind}:${input.subject.refId}`) : undefined)),
    );
  }

  /**
   * Safety net for financial isolation: money values (`*Agorot` keys) in
   * `data` are kept only when the recipient is an active member who may see
   * money (VIEW_FINANCIALS). Call sites already send money to such recipients
   * only; this makes a mistake there strip the values (and log) instead of
   * leaking them to a Field Manager, a Worker or a custom role without the
   * financial permission. Costs one lookup, and only when data has money.
   */
  private async guardFinancialData(input: NotifyInput): Promise<Record<string, unknown>> {
    const data = input.data ?? {};
    if (!hasFinancialData(data)) return data;
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { organizationId: input.organizationId, userId: input.recipientUserId, status: AccountStatus.ACTIVE, archivedAt: null },
      include: MEMBERSHIP_ACCESS_INCLUDE,
    });
    if (membership && effectivePermissionsOf({ role: membership.role, roleRecord: membership.roleRecord, restrictedToScope: membership.restrictedToScope }).has(Permission.VIEW_FINANCIALS)) return data;
    this.logger.warn(`Stripped financial values from a ${input.type} notification for recipient ${input.recipientUserId}, who may not see money.`);
    return withoutFinancialData(data);
  }

  /**
   * The caller's newest notifications. Since the mobile manager mode each
   * also carries what it asks the reader to do (`action`, only when the
   * reader may open the screen where it is settled) and who settled its
   * subject (`handled`, shared by every manager's copy).
   */
  async listForUser(organizationId: string, recipientUserId: string, viewer?: AuthenticatedUser) {
    const all = await this.prisma.notification.findMany({
      where: { organizationId, recipientUserId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // A member restricted to some projects: what is about a shift of another project is not theirs to read
    // (notifications are filtered when they are created; this covers a restriction added later).
    const shiftScope = viewer ? shiftScopeWhere(scopeOf(viewer)) : undefined;
    let notifications = all;
    if (shiftScope) {
      const shiftIds = [...new Set(all.map((notification) => shiftIdOf(notification.dataJson)).filter((id): id is string => id !== null))];
      const visible = new Set((await this.prisma.shift.findMany({ where: { organizationId, id: { in: shiftIds }, ...shiftScope }, select: { id: true } })).map((shift) => shift.id));
      notifications = all.filter((notification) => {
        const shiftId = shiftIdOf(notification.dataJson);
        return shiftId === null || visible.has(shiftId);
      });
    }
    const subjects = await this.subjects.views(notifications.flatMap((notification) => (notification.subjectId ? [notification.subjectId] : [])));
    const rows = notifications.map((notification) => {
      const subject = notification.subjectId ? (subjects.get(notification.subjectId) ?? null) : null;
      return { notification, subject, action: viewer ? actionOf(notification, subject, viewer) : null };
    });
    // A notification from before subjects (none stored with it) cannot be settled: its action stays only while its
    // record still waits for it, so a decision made since takes it out of «تحتاج إجراء».
    const stillWaits = await this.subjects.stillWaiting(
      organizationId,
      rows.flatMap((row) => (row.action && !row.notification.subjectId ? [row.action] : [])),
    );
    return rows.map(({ notification, subject, action }) => ({
      ...notification,
      action: action && (notification.subjectId || stillWaits(action)) ? action : null,
      handled: subject?.handled ?? null,
    }));
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
    const receivable = new Set(receivableNotificationTypes(actor, actor.workerProfileId !== null));
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
      preferences: receivableNotificationTypes(actor, actor.workerProfileId !== null).map((type) => ({ type, push: push[type] ?? true })),
    };
  }
}

function shiftIdOf(data: Prisma.JsonValue | null): string | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const shiftId = (data as Record<string, unknown>).shiftId;
  return typeof shiftId === "string" ? shiftId : null;
}
