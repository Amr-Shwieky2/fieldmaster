import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { DevLoginEnabledGuard } from "../auth/dev-login-enabled.guard";
import { DevToolsService } from "./dev-tools.service";
import { RewindTimeEntryDto } from "./dto/rewind-time-entry.dto";

/**
 * Test-mode tools for the admin web's worker simulator (DEV_LOGIN_ENABLED=true
 * with APP_ENV development/staging). With dev login off every route answers
 * 404 like an unknown route (DevRoutesGateMiddleware, before authentication).
 */
@ApiBearerAuth()
@ApiTags("dev tools (test mode only)")
@UseGuards(DevLoginEnabledGuard)
@Controller("dev")
export class DevToolsController {
  constructor(private readonly devToolsService: DevToolsService) {}

  @Post("time-entries/:id/rewind")
  @RequirePermissions(Permission.CORRECT_TIME_ENTRIES)
  @ApiOperation({ summary: "Move an open time entry's clock-in back by N minutes (max 24 h); audited as DEV_REWIND (test mode only)." })
  rewind(
    @Param("id") id: string,
    @Body() dto: RewindTimeEntryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.devToolsService.rewindTimeEntry(user.organizationId, id, dto.minutes, user, correlationId);
  }

  @Get("worker-simulator/me")
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  @ApiOperation({ summary: "The signed-in worker's Turan and temporary-supervisor assignments, for the worker simulator (test mode only)." })
  workerSimulatorContext(@CurrentUser() user: AuthenticatedUser) {
    return this.devToolsService.workerSimulatorContext(user.organizationId, user);
  }
}
