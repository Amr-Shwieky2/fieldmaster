import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OperationsService } from "./operations.service";

/**
 * The live operations page's snapshot (Owners and Field Managers; no money
 * for anyone). Clients refetch it when an `operations` event arrives on the
 * notifications WebSocket or SSE stream.
 */
@ApiBearerAuth()
@ApiTags("operations")
@Controller("operations")
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("live")
  @RequirePermissions(Permission.VIEW_OPERATIONS)
  live(@CurrentUser() user: AuthenticatedUser) {
    return this.operations.snapshot(user.organizationId);
  }
}
