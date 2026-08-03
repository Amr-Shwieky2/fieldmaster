import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { TuranType } from "@fieldmaster/shared-types";
import { TuranAssignmentsService } from "./turan-assignments.service";
import { CreateTuranAssignmentDto } from "./dto/create-turan-assignment.dto";
import { EmergencyCalloutsService } from "./emergency-callouts.service";
import { StartEmergencyCalloutDto, EndEmergencyCalloutDto } from "./dto/emergency-callout.dto";

@ApiBearerAuth()
@ApiTags("turan")
@Controller()
export class TuranController {
  constructor(
    private readonly turanAssignmentsService: TuranAssignmentsService,
    private readonly emergencyCalloutsService: EmergencyCalloutsService,
  ) {}

  @Post("turan-assignments")
  @RequirePermissions(Permission.MANAGE_TURAN)
  create(@Body() dto: CreateTuranAssignmentDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.turanAssignmentsService.create(user.organizationId, dto, user, correlationId);
  }

  @Get("turan-assignments")
  @RequirePermissions(Permission.MANAGE_TURAN)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("turanType") turanType?: TuranType,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("workerProfileId") workerProfileId?: string,
  ) {
    return this.turanAssignmentsService.list(user.organizationId, { turanType, from, to, workerProfileId });
  }

  @Post("turan-assignments/:id/cancel")
  @RequirePermissions(Permission.MANAGE_TURAN)
  cancel(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.turanAssignmentsService.cancel(user.organizationId, id, user, correlationId);
  }

  @Post("emergency-callouts/start")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  start(
    @Body() dto: StartEmergencyCalloutDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.emergencyCalloutsService.start(user.organizationId, dto, user, idempotencyKey, correlationId);
  }

  @Post("emergency-callouts/end")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  end(
    @Body() dto: EndEmergencyCalloutDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.emergencyCalloutsService.end(user.organizationId, dto, user, idempotencyKey, correlationId);
  }
}
