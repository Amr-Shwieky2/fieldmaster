import { Module } from "@nestjs/common";
import { ShiftsService } from "./shifts.service";
import { ShiftsController } from "./shifts.controller";
import { TemporarySupervisorAccessController } from "./temporary-supervisor-access.controller";
import { TemporarySupervisorsService } from "./temporary-supervisors.service";
import { TemporaryCheckInPointsService } from "./temporary-check-in-points.service";
import { SupervisorIssuesService } from "./supervisor-issues.service";
import { SupervisorIssuesController } from "./supervisor-issues.controller";

@Module({
  controllers: [ShiftsController, TemporarySupervisorAccessController, SupervisorIssuesController],
  providers: [ShiftsService, TemporarySupervisorsService, TemporaryCheckInPointsService, SupervisorIssuesService],
  exports: [ShiftsService, TemporarySupervisorsService, TemporaryCheckInPointsService],
})
export class ShiftsModule {}
