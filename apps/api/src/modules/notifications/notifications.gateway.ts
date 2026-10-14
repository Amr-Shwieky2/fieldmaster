import { OnEvent } from "@nestjs/event-emitter";
import { ConnectedSocket, OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import { NOTIFICATION_CREATED_EVENT, type NotificationCreatedEvent } from "./notifications.service";
import { RealtimeAuthService, operationsRooms } from "./realtime-auth.service";
import { OPERATIONS_CHANGED_EVENT, SESSIONS_ENDED_EVENT, type OperationsChangedEvent, type SessionsEndedEvent } from "./realtime-events";

/**
 * Real-time fan-out (spec section 24.3). Clients connect with
 * `?token=<access token>` (same JWT used for REST calls), checked like a REST
 * call (`RealtimeAuthService`). Each socket joins rooms for its user (its
 * `notification` events), its membership and its session (so suspending the
 * member or revoking the session disconnects it), and -- Owners and Field
 * Managers only -- its organization's live operations room (`operations`
 * events, Step 6). `GET /notifications/stream` (SSE) is the fallback for
 * clients that can't hold a WebSocket open.
 */
@WebSocketGateway({ cors: { origin: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean) }, namespace: "/notifications" })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  constructor(private readonly realtimeAuth: RealtimeAuthService) {}

  async handleConnection(@ConnectedSocket() client: Socket) {
    const token = client.handshake.auth?.token ?? (client.handshake.query?.token as string | undefined);
    const viewer = await this.realtimeAuth.authenticate(token);
    if (!viewer) {
      client.disconnect(true);
      return;
    }
    await client.join([
      `user:${viewer.userId}`,
      `membership:${viewer.membershipId}`,
      ...(viewer.sessionId ? [`session:${viewer.sessionId}`] : []),
      ...operationsRooms(viewer),
    ]);
    // A suspension or session revoke that landed between the check and the join found no socket to close: check once more.
    if (!(await this.realtimeAuth.authenticate(token))) client.disconnect(true);
  }

  @OnEvent(NOTIFICATION_CREATED_EVENT)
  handleNotificationCreated(event: NotificationCreatedEvent) {
    this.server.to(`user:${event.recipientUserId}`).emit("notification", event.notification);
  }

  @OnEvent(OPERATIONS_CHANGED_EVENT)
  handleOperationsChanged(event: OperationsChangedEvent) {
    // Members who are not restricted listen on the organization's room; a restricted member only on the rooms
    // of their projects and sites, so an event of another project (or one without a place) never reaches them.
    const rooms = [`ops:${event.organizationId}`];
    if (event.projectId) rooms.push(`ops:${event.organizationId}:p:${event.projectId}`);
    if (event.siteId) rooms.push(`ops:${event.organizationId}:s:${event.siteId}`);
    this.server.to(rooms).emit("operations", { kind: event.kind, at: event.at });
  }

  @OnEvent(SESSIONS_ENDED_EVENT)
  handleSessionsEnded(event: SessionsEndedEvent) {
    if (event.membershipId) this.server.in(`membership:${event.membershipId}`).disconnectSockets(true);
    if (event.sessionId) this.server.in(`session:${event.sessionId}`).disconnectSockets(true);
  }
}
