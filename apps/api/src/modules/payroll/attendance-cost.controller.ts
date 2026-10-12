import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { AttendanceCostService } from "./attendance-cost.service";
import { EstimatedEarningsQueryDto } from "./dto/estimated-earnings.dto";

/**
 * Owner-only money for the attendance screens (Step 5), kept in responses of
 * their own: the attendance list and evidence never carry money, and a Field
 * Manager (or a Worker) is refused here by the permissions guard (403).
 */
@ApiBearerAuth()
@ApiTags("payroll")
@Controller()
export class AttendanceCostController {
  constructor(private readonly costs: AttendanceCostService) {}

  @Get("time-entries/:id/estimated-cost")
  @RequirePermissions(Permission.VIEW_COMPENSATION)
  estimatedCost(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.costs.estimateEntryById(user.organizationId, id);
  }

  @Get("workers/:id/estimated-earnings")
  @RequirePermissions(Permission.VIEW_COMPENSATION)
  estimatedEarnings(@Param("id") id: string, @Query() query: EstimatedEarningsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.costs.estimateWorkerMonth(user.organizationId, id, query.month ?? toBusinessYearMonth(new Date()));
  }
}
