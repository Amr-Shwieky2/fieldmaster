import { Module } from "@nestjs/common";
import { TuranAssignmentsService } from "./turan-assignments.service";
import { EmergencyCalloutsService } from "./emergency-callouts.service";
import { TuranController } from "./turan.controller";

@Module({
  controllers: [TuranController],
  providers: [TuranAssignmentsService, EmergencyCalloutsService],
  exports: [TuranAssignmentsService],
})
export class TuranModule {}
