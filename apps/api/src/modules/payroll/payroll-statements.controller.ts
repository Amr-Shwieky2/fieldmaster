import { Controller, Get, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { SalaryStatementsService } from "./salary-statements.service";

/**
 * "My salary" (Step 7; the mobile screen is Step 9): the caller's own monthly
 * statements from FINALIZED payroll versions, plus a labeled estimate (DRAFT)
 * for the open month(s). No financial permission: the data is the caller's
 * own, scoped by the worker profile in the token (404 without one).
 */
@ApiBearerAuth()
@ApiTags("payroll")
@Controller("payroll-statements")
export class PayrollStatementsController {
  constructor(private readonly statements: SalaryStatementsService) {}

  /**
   * Step 9: the current business month as a labeled estimate from approved
   * entries only. Takes no worker id: always the caller's own (404 without a
   * worker profile; 409 PAYROLL_PERIOD_FINALIZED once the month is finalized).
   */
  @Get("me/current")
  myCurrentEstimate(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.myCurrentEstimate(user.organizationId, user);
  }

  @Get("me")
  myStatements(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.myStatements(user.organizationId, user);
  }
}

/**
 * Step 9: the caller's own pay for one of their time entries. Worker-own
 * money, like `GET /payroll-statements/me`: no financial permission, and any
 * entry that is not the caller's own is a 404 (it does not exist for them).
 */
@ApiBearerAuth()
@ApiTags("payroll")
@Controller("time-entries")
export class MyEntryPayController {
  constructor(private readonly statements: SalaryStatementsService) {}

  @Get(":id/my-pay")
  @RequirePermissions(Permission.VIEW_OWN_ATTENDANCE)
  myEntryPay(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.statements.myEntryPay(user.organizationId, id, user);
  }
}
