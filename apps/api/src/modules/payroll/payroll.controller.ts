import { Body, Controller, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { PayrollCalculationService } from "./payroll-calculation.service";
import { PayrollAdjustmentsService } from "./payroll-adjustments.service";
import { PayrollVersionsService } from "./payroll-versions.service";
import { FinancialDashboardService } from "./financial-dashboard.service";
import { SalaryStatementsService } from "./salary-statements.service";
import { CreateManualAdjustmentDto, ReopenPeriodDto } from "./dto/manual-adjustment.dto";
import { VersionPipe, YearMonthPipe } from "./payroll-params";

/**
 * Payroll (Step 7). Every route except `my-payslip` needs a financial
 * permission only Owners hold. A month has versions: GET `/:yearMonth` is
 * the latest one; `/versions/:version` any of them, read-only unless it is
 * the latest.
 */
@ApiBearerAuth()
@ApiTags("payroll")
@Controller("payroll-periods")
export class PayrollController {
  constructor(
    private readonly payrollCalculation: PayrollCalculationService,
    private readonly payrollAdjustments: PayrollAdjustmentsService,
    private readonly versions: PayrollVersionsService,
    private readonly financialDashboard: FinancialDashboardService,
    private readonly statements: SalaryStatementsService,
  ) {}

  @Get()
  @RequirePermissions(Permission.VIEW_PAYROLL)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.versions.listMonths(user.organizationId);
  }

  @Get(":yearMonth")
  @RequirePermissions(Permission.VIEW_PAYROLL)
  getDetail(@Param("yearMonth", YearMonthPipe) yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    return this.versions.detail(user.organizationId, yearMonth);
  }

  @Get(":yearMonth/versions")
  @RequirePermissions(Permission.VIEW_PAYROLL)
  listVersions(@Param("yearMonth", YearMonthPipe) yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    return this.versions.listVersions(user.organizationId, yearMonth);
  }

  @Get(":yearMonth/versions/:version")
  @RequirePermissions(Permission.VIEW_PAYROLL)
  getVersion(@Param("yearMonth", YearMonthPipe) yearMonth: string, @Param("version", VersionPipe) version: number, @CurrentUser() user: AuthenticatedUser) {
    return this.versions.detail(user.organizationId, yearMonth, version);
  }

  @Get(":yearMonth/versions/:version/workers/:workerProfileId")
  @RequirePermissions(Permission.VIEW_PAYROLL)
  getWorker(
    @Param("yearMonth", YearMonthPipe) yearMonth: string,
    @Param("version", VersionPipe) version: number,
    @Param("workerProfileId") workerProfileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.versions.workerDetail(user.organizationId, yearMonth, version, workerProfileId);
  }

  @Get(":yearMonth/calculation")
  @RequirePermissions(Permission.VIEW_PAYROLL)
  getCalculation(@Param("yearMonth", YearMonthPipe) yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    return this.versions.latestRun(user.organizationId, yearMonth);
  }

  @Get(":yearMonth/dashboard")
  @RequirePermissions(Permission.VIEW_FINANCIAL_DASHBOARD)
  getDashboard(@Param("yearMonth", YearMonthPipe) yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financialDashboard.getDashboard(user.organizationId, yearMonth);
  }

  /** 202 + the calculation run (a background job). Poll `GET /:yearMonth/calculation` for its progress. */
  @Post(":yearMonth/calculate")
  @HttpCode(202)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.MANAGE_PAYROLL)
  async calculate(
    @Param("yearMonth", YearMonthPipe) yearMonth: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    const runId = await this.payrollCalculation.requestCalculation(user.organizationId, yearMonth, user, idempotencyKey, correlationId);
    return this.versions.run(user.organizationId, runId);
  }

  @Post(":yearMonth/finalize")
  @RequirePermissions(Permission.FINALIZE_PAYROLL)
  async finalize(@Param("yearMonth", YearMonthPipe) yearMonth: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    const finalized = await this.payrollCalculation.finalize(user.organizationId, yearMonth, user, correlationId);
    return this.versions.detailById(finalized.id);
  }

  /** Creates the next version; answers it (the finalized one stays readable under `/versions/:version`). */
  @Post(":yearMonth/reopen")
  @RequirePermissions(Permission.FINALIZE_PAYROLL)
  async reopen(
    @Param("yearMonth", YearMonthPipe) yearMonth: string,
    @Body() dto: ReopenPeriodDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    const next = await this.payrollCalculation.reopen(user.organizationId, yearMonth, dto.reason.trim(), user, correlationId);
    return this.versions.detailById(next.id);
  }

  @Post(":yearMonth/adjustments")
  @RequirePermissions(Permission.MANAGE_PAYROLL)
  createAdjustment(
    @Param("yearMonth", YearMonthPipe) yearMonth: string,
    @Body() dto: CreateManualAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.payrollAdjustments.create(user.organizationId, yearMonth, dto, user, correlationId);
  }

  /** The caller's own item in the month's latest FINALIZED version; the route takes no worker id. */
  @Get(":yearMonth/my-payslip")
  myPayslip(@Param("yearMonth", YearMonthPipe) yearMonth: string, @CurrentUser() user: AuthenticatedUser) {
    return this.statements.myPayslip(user.organizationId, yearMonth, user);
  }
}
