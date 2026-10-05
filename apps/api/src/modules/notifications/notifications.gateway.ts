import { Inject, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { AccessTokenPayload } from "../../common/auth/auth-context";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";
import { isTestModeLoginMethod } from "../../common/auth/login-method";
import { NOTIFICATION_CREATED_EVENT, type NotificationCreatedEvent } from "./notifications.service";

/**
 * Real-time notification fan-out (spec section 24.3). Clients connect with
 * `?token=<access token>` (same JWT used for REST calls); each socket joins
 * a room scoped to its own userId, so `notification.created` events reach
 * only their intended recipient. `GET /notifications/stream` (SSE) is the
 * fallback for clients that can't hold a WebSocket open.
 */
@WebSocketGateway({ cors: { origin: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean) }, namespace: "/notifications" })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment,
  ) {}

  async handleConnection(@ConnectedSocket() client: Socket) {
    const token = client.handshake.auth?.token ?? (client.handshake.query?.token as string | undefined);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
      if (isTestModeLoginMethod(payload.loginMethod) && !this.appEnvironment.devLoginEnabled) {
        client.disconnect(true);
        return;
      }
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() _client: Socket) {
    // Rooms are cleaned up automatically by socket.io on disconnect.
  }

  @OnEvent(NOTIFICATION_CREATED_EVENT)
  handleNotificationCreated(event: NotificationCreatedEvent) {
    this.server.to(`user:${event.recipientUserId}`).emit("notification", event.notification);
  }
}
