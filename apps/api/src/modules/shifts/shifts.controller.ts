import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OrgRole, type ShiftStatus, type ShiftType } from "@fieldmaster/shared-types";
import { ShiftsService } from "./shifts.service";
import { CreateShiftDto } from "./dto/create-shift.dto";
import { AssignWorkerDto } from "./dto/assign-worker.dto";
import { TemporarySupervisorsService } from "./temporary-supervisors.service";
import { AssignTemporarySupervisorDto } from "./dto/temporary-supervisor.dto";
import { TemporaryCheckInPointsService } from "./temporary-check-in-points.service";
import { CreateTemporaryCheckInPointDto } from "./dto/temporary-check-in-point.dto";

@ApiBearerAuth()
@ApiTags("shifts")
@Controller("shifts")
export class ShiftsController {
  constructor(
    private readonly shiftsService: ShiftsService,
    private readonly temporarySupervisorsService: TemporarySupervisorsService,
    private readonly temporaryCheckInPointsService: TemporaryCheckInPointsService,
  ) {}

  @Post()
  @RequirePermissions(Permission.MANAGE_SHIFTS)
  create(@Body() dto: CreateShiftDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.shiftsService.create(user.organizationId, dto, user, correlationId);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: ShiftStatus,
    @Query("businessDate") businessDate?: string,
    @Query("shiftType") shiftType?: ShiftType,
  ) {
    // Workers have no MANAGE_SHIFTS permission and only ever see shifts
    // they're personally assigned to; managers/owners see the full org list.
    const scope = this.scopeFor(user);
    return this.shiftsService.list(user.organizationId, { status, businessDate, shiftType }, scope);
  }

  @Get(":id")
  getById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    const scope = this.scopeFor(user);
    return this.shiftsService.getById(user.organizationId, id, scope);
  }

  private scopeFor(user: AuthenticatedUser): { workerProfileId: string } | undefined {
    if (user.role !== OrgRole.WORKER) return undefined;
    if (!user.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "No worker profile associated with this account.");
    }
    return { workerProfileId: user.workerProfileId };
  }

  @Post(":id/assignments")
  @RequirePermissions(Permission.MANAGE_SHIFTS)
  assignWorker(
    @Param("id") id: string,
    @Body() dto: AssignWorkerDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.shiftsService.assignWorker(user.organizationId, id, dto.workerProfileId, user, correlationId);
  }

  @Post(":id/close")
  @RequirePermissions(Permission.MANAGE_SHIFTS)
  close(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.shiftsService.close(user.organizationId, id, user, correlationId);
  }

  @Post(":id/temporary-supervisors")
  @RequirePermissions(Permission.MANAGE_TEMP_SUPERVISORS)
  assignTemporarySupervisor(
    @Param("id") id: string,
    @Body() dto: AssignTemporarySupervisorDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.temporarySupervisorsService.assign(user.organizationId, id, dto, user, correlationId);
  }

  @Post("temporary-check-in-points")
  createTemporaryCheckInPoint(
    @Body() dto: CreateTemporaryCheckInPointDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.temporaryCheckInPointsService.create(user.organizationId, dto, user, correlationId);
  }

  @Get(":id/temporary-check-in-points")
  listTemporaryCheckInPoints(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.temporaryCheckInPointsService.listForShift(user.organizationId, id);
  }

  @Delete("temporary-supervisors/:assignmentId")
  @RequirePermissions(Permission.MANAGE_TEMP_SUPERVISORS)
  revokeTemporarySupervisor(
    @Param("assignmentId") assignmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.temporarySupervisorsService.revoke(user.organizationId, assignmentId, user, correlationId);
  }

  @Delete("temporary-check-in-points/:pointId")
  @RequirePermissions(Permission.MANAGE_TEMP_SUPERVISORS)
  revokeTemporaryCheckInPoint(
    @Param("pointId") pointId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.temporaryCheckInPointsService.revoke(user.organizationId, pointId, user, correlationId);
  }
}
