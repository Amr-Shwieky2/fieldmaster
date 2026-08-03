import { Module } from "@nestjs/common";
import { SitesModule } from "../sites/sites.module";
import { ShiftsModule } from "../shifts/shifts.module";
import { ClockEventsService } from "./clock-events.service";
import { LocationValidationService } from "./location-validation.service";
import { AttendanceController } from "./attendance.controller";
import { TimeEntriesService } from "./time-entries.service";
import { TimeEntriesController } from "./time-entries.controller";
import { AttendanceApprovalsService } from "./attendance-approvals.service";
import { ManualCorrectionsService } from "./manual-corrections.service";
import { ForgottenStampService } from "./forgotten-stamp.service";

@Module({
  imports: [SitesModule, ShiftsModule],
  controllers: [AttendanceController, TimeEntriesController],
  providers: [
    ClockEventsService,
    LocationValidationService,
    TimeEntriesService,
    AttendanceApprovalsService,
    ManualCorrectionsService,
    ForgottenStampService,
  ],
  exports: [ForgottenStampService, ClockEventsService],
})
export class AttendanceModule {}
