import { Module } from "@nestjs/common";
import { PayrollModule } from "../payroll/payroll.module";
import { ReportsService } from "./reports.service";
import { ReportsController } from "./reports.controller";

@Module({
  imports: [PayrollModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
