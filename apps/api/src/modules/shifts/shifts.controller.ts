import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission, hasPermission } from "../../common/auth/permissions";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { ShiftStatus, ShiftType } from "@fieldmaster/shared-types";
import { ShiftsService } from "./shifts.service";
import { CreateShiftDto } from "./dto/create-shift.dto";
import { AssignWorkerDto } from "./dto/assign-worker.dto";
import { TemporarySupervisorsService } from "./temporary-supervisors.service";
import { AssignTemporarySupervisorDto } from "./dto/temporary-supervisor.dto";
import { TemporaryCheckInPointsService } from "./temporary-check-in-points.service";
import { CreateTemporaryCheckInPointDto } from "./dto/temporary-check-in-point.dto";
import { pageWindow } from "../../common/validation/page-query";

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
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    // A member without VIEW_SHIFTS (a Worker) only ever sees the shifts they're
    // personally assigned to; whoever holds it sees the organization's list
    // (the projects they are restricted to, if any).
    const scope = this.scopeFor(user);
    return this.shiftsService.list(user.organizationId, { status, businessDate, shiftType }, user, scope, pageWindow({ page, pageSize }));
  }

  /** Mobile manager mode (declared before `:id`): the workers a shift at this time can have, with their overlapping shifts. */
  @Get("assignable-workers")
  @RequirePermissions(Permission.MANAGE_SHIFTS)
  assignableWorkers(@CurrentUser() user: AuthenticatedUser, @Query("start") start?: string, @Query("end") end?: string) {
    return this.shiftsService.assignableWorkers(user.organizationId, start, end, user);
  }

  @Get(":id")
  getById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    const scope = this.scopeFor(user);
    return this.shiftsService.getById(user.organizationId, id, user, scope);
  }

  private scopeFor(user: AuthenticatedUser): { workerProfileId: string } | undefined {
    if (hasPermission(user, Permission.VIEW_SHIFTS)) return undefined;
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

  @Get(":id/temporary-supervisors")
  @RequirePermissions(Permission.MANAGE_TEMP_SUPERVISORS)
  listTemporarySupervisors(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.temporarySupervisorsService.listForShift(user.organizationId, id, user);
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

  /**
   * The same visibility as the shift itself (Step 6 fix): a Worker -- a
   * temporary supervisor included -- only for a shift they are assigned to;
   * an unknown or other organization's shift is a 404.
   */
  @Get(":id/temporary-check-in-points")
  async listTemporaryCheckInPoints(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    if (!UUID_PATTERN.test(id)) throw new AppException(404, ErrorCodes.NOT_FOUND, "Shift not found.");
    await this.shiftsService.getById(user.organizationId, id, user, this.scopeFor(user));
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

  /** Managers, or an active temporary supervisor of the point's shift who may manage points (checked in the service). */
  @Delete("temporary-check-in-points/:pointId")
  revokeTemporaryCheckInPoint(
    @Param("pointId") pointId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.temporaryCheckInPointsService.revoke(user.organizationId, pointId, user, correlationId);
  }
}
