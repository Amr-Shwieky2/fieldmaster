import { Module } from "@nestjs/common";
import { PayrollCalculationService } from "./payroll-calculation.service";
import { PayrollCalculationProcessor } from "./payroll-calculation.processor";
import { PayrollInputsService } from "./payroll-inputs.service";
import { PayrollVersionsService } from "./payroll-versions.service";
import { PayrollAdjustmentsService } from "./payroll-adjustments.service";
import { FinancialDashboardService } from "./financial-dashboard.service";
import { SalaryStatementsService } from "./salary-statements.service";
import { PayrollController } from "./payroll.controller";
import { PayrollStatementsController } from "./payroll-statements.controller";
import { AttendanceCostService } from "./attendance-cost.service";
import { AttendanceCostController } from "./attendance-cost.controller";

@Module({
  controllers: [PayrollController, PayrollStatementsController, AttendanceCostController],
  providers: [
    PayrollCalculationService,
    PayrollCalculationProcessor,
    PayrollInputsService,
    PayrollVersionsService,
    PayrollAdjustmentsService,
    FinancialDashboardService,
    SalaryStatementsService,
    AttendanceCostService,
  ],
  exports: [PayrollCalculationService, AttendanceCostService],
})
export class PayrollModule {}
