import { Global, Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsGateway } from "./notifications.gateway";
import { NotificationAudienceService } from "./notification-audience.service";
import { RealtimeAuthService } from "./realtime-auth.service";
import { RealtimeEventsService } from "./realtime-events";

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, NotificationAudienceService, RealtimeAuthService, RealtimeEventsService],
  exports: [NotificationsService, NotificationAudienceService, RealtimeAuthService, RealtimeEventsService],
})
export class NotificationsModule {}
