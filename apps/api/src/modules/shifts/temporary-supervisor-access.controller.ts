import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { TemporarySupervisorsService } from "./temporary-supervisors.service";
import { ReportIssueDto } from "./dto/temporary-supervisor.dto";

/**
 * The temporary supervisor's own API (Step 6; the worker simulator uses it
 * now, the mobile app in Step 9). Every route checks the assignment live:
 * it must be the caller's and ACTIVE (not revoked, inside its window, shift
 * not closed), so access ends the moment any of that changes.
 */
@ApiBearerAuth()
@ApiTags("temporary-supervisors")
@Controller("temporary-supervisors")
export class TemporarySupervisorAccessController {
  constructor(private readonly temporarySupervisors: TemporarySupervisorsService) {}

  @Get("me")
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.temporarySupervisors.mine(user.organizationId, user);
  }

  @Get(":assignmentId/shift")
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  shift(@Param("assignmentId") assignmentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.temporarySupervisors.shiftView(user.organizationId, assignmentId, user);
  }

  @Post(":assignmentId/report-issue")
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  reportIssue(
    @Param("assignmentId") assignmentId: string,
    @Body() dto: ReportIssueDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.temporarySupervisors.reportIssue(user.organizationId, assignmentId, dto, user, correlationId);
  }
}
