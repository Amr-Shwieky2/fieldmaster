import { Module } from "@nestjs/common";
import { ShiftsService } from "./shifts.service";
import { ShiftsController } from "./shifts.controller";
import { TemporarySupervisorsService } from "./temporary-supervisors.service";
import { TemporaryCheckInPointsService } from "./temporary-check-in-points.service";

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, TemporarySupervisorsService, TemporaryCheckInPointsService],
  exports: [ShiftsService, TemporarySupervisorsService, TemporaryCheckInPointsService],
})
export class ShiftsModule {}
