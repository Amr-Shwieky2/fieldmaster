import { Global, Module } from "@nestjs/common";
import { RolesService } from "./roles.service";
import { RolesController } from "./roles.controller";
import { NotificationsModule } from "../notifications/notifications.module";

/** Global so the memberships and auth modules can assign roles through the same service. */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
