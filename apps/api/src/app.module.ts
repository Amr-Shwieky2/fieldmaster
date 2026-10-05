import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./common/prisma/prisma.module";
import { AppConfigModule } from "./common/config/app-config.module";
import { CommonModule } from "./common/common.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { AuthModule } from "./modules/auth/auth.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { MembershipsModule } from "./modules/memberships/memberships.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { WorkersModule } from "./modules/workers/workers.module";
import { SitesModule } from "./modules/sites/sites.module";
import { ShiftsModule } from "./modules/shifts/shifts.module";
import { AttendanceModule } from "./modules/attendance/attendance.module";
import { TuranModule } from "./modules/turan/turan.module";
import { PayrollModule } from "./modules/payroll/payroll.module";
import { AuditLogsModule } from "./modules/audit-logs/audit-logs.module";
import { QueueModule } from "./common/queue/queue.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { DevicesModule } from "./modules/devices/devices.module";
import { OfflineSyncModule } from "./modules/offline-sync/offline-sync.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CommonModule,
    QueueModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    NotificationsModule,
    WorkersModule,
    SitesModule,
    ShiftsModule,
    AttendanceModule,
    TuranModule,
    PayrollModule,
    AuditLogsModule,
    ReportsModule,
    DevicesModule,
    OfflineSyncModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
