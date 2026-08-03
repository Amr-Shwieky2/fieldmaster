import { Body, Controller, Headers, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { ClockEventsService } from "./clock-events.service";
import { ClockInDto } from "./dto/clock-in.dto";
import { ClockOutDto } from "./dto/clock-out.dto";

@ApiBearerAuth()
@ApiTags("clock-events")
@Controller("clock-events")
export class AttendanceController {
  constructor(private readonly clockEventsService: ClockEventsService) {}

  @Post("clock-in")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  clockIn(
    @Body() dto: ClockInDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.clockEventsService.clockIn(user.organizationId, dto, user, idempotencyKey, correlationId);
  }

  @Post("clock-out")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  clockOut(
    @Body() dto: ClockOutDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.clockEventsService.clockOut(user.organizationId, dto, user, idempotencyKey, correlationId);
  }
}
