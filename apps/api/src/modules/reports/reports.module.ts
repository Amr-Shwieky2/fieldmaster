import { Module } from "@nestjs/common";
import { PayrollModule } from "../payroll/payroll.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { ReportGenerationService } from "./report-generation.service";
import { ReportGenerationProcessor } from "./report-generation.processor";
import { ReportDataService } from "./report-data.service";
import { ReportPdfRenderer } from "./render/pdf-renderer";

/**
 * Reports (Step 8). PayrollModule exports the pay of an entry
 * (PayrollCalculationService, AttendanceCostService); the attendance
 * evidence and a payroll version are looked up by ReportDataService.
 */
@Module({
  imports: [PayrollModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportGenerationService, ReportGenerationProcessor, ReportDataService, ReportPdfRenderer],
})
export class ReportsModule {}
