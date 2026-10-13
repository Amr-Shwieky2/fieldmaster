import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Sse, UnauthorizedException, type MessageEvent } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { EMPTY, Observable, fromEvent, interval, merge } from "rxjs";
import { filter, map, takeUntil } from "rxjs/operators";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { NotificationsService, NOTIFICATION_CREATED_EVENT, type NotificationCreatedEvent } from "./notifications.service";
import { RealtimeAuthService } from "./realtime-auth.service";
import { OPERATIONS_CHANGED_EVENT, SESSIONS_ENDED_EVENT, type OperationsChangedEvent, type SessionsEndedEvent } from "./realtime-events";
import { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";

/** How often an SSE connection gets a `ping` event, so a client can tell a live connection from a dead one. */
const SSE_HEARTBEAT_MS = 25_000;

@ApiBearerAuth()
@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly realtimeAuth: RealtimeAuthService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listForUser(user.organizationId, user.sub);
  }

  // Step 9 (declared before the `:id` routes): the caller's own push switches, and "mark all as read".

  /** One line per notification type the caller can receive: `{ type, push }` (push on unless turned off). */
  @Get("preferences")
  async myPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.myPreferences(user);
  }

  /** Changes the listed switches (others keep theirs); answers the whole list. In-app notifications are always kept. */
  @Patch("preferences")
  async updateMyPreferences(@Body() dto: UpdateNotificationPreferencesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.updateMyPreferences(user, dto.preferences);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.organizationId, user.sub);
  }

  @Patch(":id/read")
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.notificationsService.markRead(id, user.sub);
    return { success: true };
  }

  /**
   * SSE fallback for clients that can't hold a WebSocket connection open
   * (spec section 24.3). Browsers' native EventSource can't set an
   * Authorization header, so the token travels as a query param instead --
   * this route is @Public() at the guard layer and checks the token like a
   * REST call (`RealtimeAuthService`).
   *
   * Events: the viewer's notifications (default `message` event), `operations`
   * for Owners and Field Managers (Step 6: the live operations page refetches
   * its snapshot), and a `ping` heartbeat. The stream ends when the member is
   * suspended or archived, their role changes, or this session is revoked.
   */
  @Public()
  @Sse("stream")
  async stream(@Query("token") token: string): Promise<Observable<MessageEvent>> {
    const viewer = await this.realtimeAuth.authenticate(token);
    if (!viewer) throw new UnauthorizedException("Invalid or expired token, or the session or account is no longer active.");

    const notifications = fromEvent(this.eventEmitter, NOTIFICATION_CREATED_EVENT).pipe(
      filter((event): event is NotificationCreatedEvent => (event as NotificationCreatedEvent).recipientUserId === viewer.userId),
      map((event): MessageEvent => ({ data: event.notification })),
    );
    const operations = viewer.canViewOperations
      ? fromEvent(this.eventEmitter, OPERATIONS_CHANGED_EVENT).pipe(
          filter((event): event is OperationsChangedEvent => (event as OperationsChangedEvent).organizationId === viewer.organizationId),
          map((event): MessageEvent => ({ type: "operations", data: { kind: event.kind, at: event.at } })),
        )
      : EMPTY;
    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: "ping", data: {} })));
    const ended = fromEvent(this.eventEmitter, SESSIONS_ENDED_EVENT).pipe(
      filter((event) => {
        const ended = event as SessionsEndedEvent;
        return ended.membershipId === viewer.membershipId || (viewer.sessionId !== null && ended.sessionId === viewer.sessionId);
      }),
    );

    return merge(notifications, operations, heartbeat).pipe(takeUntil(ended));
  }
}
