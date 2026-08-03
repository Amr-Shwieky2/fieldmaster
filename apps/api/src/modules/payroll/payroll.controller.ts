import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { PayrollCalculationService } from "./payroll-calculation.service";
import { PayrollAdjustmentsService } from "./payroll-adjustments.service";
import { FinancialDashboardService } from "./financial-dashboard.service";
import { CreateManualAdjustmentDto, ReopenPeriodDto } from "./dto/manual-adjustment.dto";
import { PrismaService } from "../../common/prisma/prisma.service";

@ApiBearerAuth()
@ApiTags("payroll")
@Controller("payroll-periods")
export class PayrollController {
  constructor(
    private readonly payrollCalculation: PayrollCalculationService,
    private readonly payrollAdjustments: PayrollAdjustmentsService,
    private readonly financialDashboard: FinancialDashboardService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions(Permission.VIEW_PAYROLL)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.payrollCalculation.listPeriods(user.organizationId);
  }

  @Get(":yearMonth")
  @RequirePermissions(Permission.VIEW_PAYROLL)
  getDetail(@Param("yearMonth") yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payrollCalculation.getPeriodDetail(user.organizationId, yearMonth);
  }

  @Get(":yearMonth/dashboard")
  @RequirePermissions(Permission.VIEW_FINANCIAL_DASHBOARD)
  getDashboard(@Param("yearMonth") yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financialDashboard.getDashboard(user.organizationId, yearMonth);
  }

  @Post(":yearMonth/calculate")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.MANAGE_PAYROLL)
  calculate(
    @Param("yearMonth") yearMonth: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.payrollCalculation.calculate(user.organizationId, yearMonth, user, idempotencyKey, correlationId);
  }

  @Post(":yearMonth/finalize")
  @RequirePermissions(Permission.FINALIZE_PAYROLL)
  finalize(@Param("yearMonth") yearMonth: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.payrollCalculation.finalize(user.organizationId, yearMonth, user, correlationId);
  }

  @Post(":yearMonth/reopen")
  @RequirePermissions(Permission.FINALIZE_PAYROLL)
  reopen(
    @Param("yearMonth") yearMonth: string,
    @Body() dto: ReopenPeriodDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.payrollCalculation.reopen(user.organizationId, yearMonth, dto.reason, user, correlationId);
  }

  @Post(":yearMonth/adjustments")
  @RequirePermissions(Permission.MANAGE_PAYROLL)
  createAdjustment(
    @Param("yearMonth") yearMonth: string,
    @Body() dto: CreateManualAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.payrollAdjustments.create(user.organizationId, yearMonth, dto, user, correlationId);
  }

  @Get(":yearMonth/my-payslip")
  async myPayslip(@Param("yearMonth") yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    if (!user.workerProfileId) {
      throw new AppException(404, ErrorCodes.NOT_FOUND, "No payslip available for this account.");
    }
    const period = await this.prisma.payrollPeriod.findFirst({ where: { organizationId: user.organizationId, yearMonth }, orderBy: { version: "desc" } });
    if (!period) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll for this month has not been calculated yet.");

    const item = await this.prisma.payrollItem.findUnique({
      where: { payrollPeriodId_workerProfileId: { payrollPeriodId: period.id, workerProfileId: user.workerProfileId } },
      include: { adjustments: true },
    });
    if (!item) throw new AppException(404, ErrorCodes.NOT_FOUND, "No payroll record found for this month.");

    return { periodStatus: period.status, ...item };
  }
}
