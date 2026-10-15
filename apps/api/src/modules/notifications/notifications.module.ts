import { Global, Logger, Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsGateway } from "./notifications.gateway";
import { NotificationAudienceService } from "./notification-audience.service";
import { RealtimeAuthService } from "./realtime-auth.service";
import { RealtimeEventsService } from "./realtime-events";
import { PushDeliveryService } from "./push/push-delivery.service";
import { PushDeliveryProcessor } from "./push/push-delivery.processor";
import { ExpoPushProvider, LogPushProvider, PUSH_PROVIDER, resolvePushProviderKind, type PushProvider } from "./push/push-provider";
import { NotificationSubjectsService } from "./notification-subjects.service";
import { NotificationSubjectsController } from "./notification-subjects.controller";

@Global()
@Module({
  controllers: [NotificationsController, NotificationSubjectsController],
  providers: [
    NotificationsService,
    NotificationSubjectsService,
    NotificationsGateway,
    NotificationAudienceService,
    RealtimeAuthService,
    RealtimeEventsService,
    PushDeliveryService,
    PushDeliveryProcessor,
    {
      // Step 9: PUSH_PROVIDER=log (default) | expo, resolved once at start; an invalid value stops the API from starting.
      provide: PUSH_PROVIDER,
      useFactory: (): PushProvider => {
        const kind = resolvePushProviderKind();
        new Logger("Push").log(`Push provider: ${kind}`);
        return kind === "expo" ? new ExpoPushProvider() : new LogPushProvider();
      },
    },
  ],
  exports: [NotificationsService, NotificationSubjectsService, NotificationAudienceService, RealtimeAuthService, RealtimeEventsService, PushDeliveryService, PUSH_PROVIDER],
})
export class NotificationsModule {}
