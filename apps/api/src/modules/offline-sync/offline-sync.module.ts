import { Module } from "@nestjs/common";
import { AttendanceModule } from "../attendance/attendance.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OfflineSyncController } from "./offline-sync.controller";
import { OfflineSyncService } from "./offline-sync.service";

@Module({
  imports: [AttendanceModule, NotificationsModule],
  controllers: [OfflineSyncController],
  providers: [OfflineSyncService],
})
export class OfflineSyncModule {}
