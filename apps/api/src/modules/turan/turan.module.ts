import { Module } from "@nestjs/common";
import { PayrollModule } from "../payroll/payroll.module";
import { EmergencyCalloutRecordsService } from "./emergency-callout-records.service";
import { TuranAssignmentsService } from "./turan-assignments.service";
import { EmergencyCalloutsService } from "./emergency-callouts.service";
import { TuranController } from "./turan.controller";

@Module({
  imports: [PayrollModule],
  controllers: [TuranController],
  providers: [TuranAssignmentsService, EmergencyCalloutsService, EmergencyCalloutRecordsService],
  exports: [TuranAssignmentsService],
})
export class TuranModule {}
