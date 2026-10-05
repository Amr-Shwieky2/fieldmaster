import { Controller, Get, Inject, Param, Patch, Query, Sse, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Observable, fromEvent } from "rxjs";
import { filter, map } from "rxjs/operators";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type { AuthenticatedUser, AccessTokenPayload } from "../../common/auth/auth-context";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";
import { TEST_MODE_SESSION_ENDED_MESSAGE, isTestModeLoginMethod } from "../../common/auth/login-method";
import { NotificationsService, NOTIFICATION_CREATED_EVENT, type NotificationCreatedEvent } from "./notifications.service";

@ApiBearerAuth()
@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listForUser(user.organizationId, user.sub);
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
   * this route is @Public() at the guard layer and verifies the JWT itself.
   */
  @Public()
  @Sse("stream")
  stream(@Query("token") token: string): Observable<{ data: unknown }> {
    let payload: AccessTokenPayload;
    try {
      payload = this.jwtService.verify<AccessTokenPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException("Invalid or expired token.");
    }
    if (isTestModeLoginMethod(payload.loginMethod) && !this.appEnvironment.devLoginEnabled) {
      throw new UnauthorizedException(TEST_MODE_SESSION_ENDED_MESSAGE);
    }
    const userId = payload.sub;

    return fromEvent(this.eventEmitter, NOTIFICATION_CREATED_EVENT).pipe(
      filter((event): event is NotificationCreatedEvent => (event as NotificationCreatedEvent).recipientUserId === userId),
      map((event) => ({ data: event.notification })),
    );
  }
}
