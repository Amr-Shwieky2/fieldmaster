import { Module } from "@nestjs/common";
import { PayrollCalculationService } from "./payroll-calculation.service";
import { PayrollAdjustmentsService } from "./payroll-adjustments.service";
import { FinancialDashboardService } from "./financial-dashboard.service";
import { PayrollController } from "./payroll.controller";
import { AttendanceCostService } from "./attendance-cost.service";
import { AttendanceCostController } from "./attendance-cost.controller";

@Module({
  controllers: [PayrollController, AttendanceCostController],
  providers: [PayrollCalculationService, PayrollAdjustmentsService, FinancialDashboardService, AttendanceCostService],
  exports: [PayrollCalculationService, AttendanceCostService],
})
export class PayrollModule {}
