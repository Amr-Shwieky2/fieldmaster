import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
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

  @Get("me")
  myStatements(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.myStatements(user.organizationId, user);
  }
}
