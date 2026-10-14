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
import { RejectedClockAttemptsService } from "./rejected-clock-attempts.service";
import { AttendanceRecordsService } from "./attendance-records.service";
import { AttendanceRecordsController } from "./attendance-records.controller";
import { AttendanceAttachmentsService } from "./attendance-attachments.service";

@Module({
  imports: [SitesModule, ShiftsModule],
  controllers: [AttendanceController, TimeEntriesController, AttendanceRecordsController],
  providers: [
    ClockEventsService,
    LocationValidationService,
    TimeEntriesService,
    AttendanceApprovalsService,
    ManualCorrectionsService,
    ForgottenStampService,
    RejectedClockAttemptsService,
    AttendanceRecordsService,
    AttendanceAttachmentsService,
  ],
  exports: [ForgottenStampService, ClockEventsService],
})
export class AttendanceModule {}
