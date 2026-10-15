import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { SupervisorIssuesService } from "./supervisor-issues.service";

export class ResolveSupervisorIssueDto {
  @ApiProperty({ description: "What was done about it (shown to every manager and sent to the supervisor)." })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}

/** Mobile manager mode: a temporary supervisor's reports, for members who may see live operations (within their projects). */
@ApiBearerAuth()
@ApiTags("shifts")
@Controller("supervisor-issues")
export class SupervisorIssuesController {
  constructor(private readonly issues: SupervisorIssuesService) {}

  @Get(":id")
  @RequirePermissions(Permission.VIEW_OPERATIONS)
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.issues.get(user.organizationId, id, user);
  }

  @Post(":id/resolve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.VIEW_OPERATIONS)
  resolve(@Param("id") id: string, @Body() dto: ResolveSupervisorIssueDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.issues.resolve(user.organizationId, id, dto.note, user, correlationId);
  }
}
