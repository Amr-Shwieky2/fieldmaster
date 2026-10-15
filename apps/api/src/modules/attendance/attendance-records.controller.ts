import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { AttendanceRecordsService } from "./attendance-records.service";
import { ListAttendanceQueryDto } from "./dto/attendance-list.dto";

/**
 * The admin attendance screens (Step 5). Whoever holds VIEW_ATTENDANCE gets
 * the same, money-free responses (the entries of their projects, when
 * restricted); Workers are refused (403) -- they read their own attendance
 * through `GET /time-entries`.
 */
@ApiBearerAuth()
@ApiTags("attendance")
@Controller()
export class AttendanceRecordsController {
  constructor(private readonly records: AttendanceRecordsService) {}

  @Get("attendance/entries")
  @RequirePermissions(Permission.VIEW_ATTENDANCE)
  list(@Query() query: ListAttendanceQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.records.list(user.organizationId, query, user.scope);
  }

  @Get("time-entries/:id/evidence")
  @RequirePermissions(Permission.VIEW_ATTENDANCE)
  evidence(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.records.getEvidence(user.organizationId, id, user);
  }
}
