import { Module } from "@nestjs/common";
import { PayrollCalculationService } from "./payroll-calculation.service";
import { PayrollAdjustmentsService } from "./payroll-adjustments.service";
import { FinancialDashboardService } from "./financial-dashboard.service";
import { PayrollController } from "./payroll.controller";

@Module({
  controllers: [PayrollController],
  providers: [PayrollCalculationService, PayrollAdjustmentsService, FinancialDashboardService],
  exports: [PayrollCalculationService],
})
export class PayrollModule {}
