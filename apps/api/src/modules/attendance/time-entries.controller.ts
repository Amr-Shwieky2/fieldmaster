import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { TimeEntryStatus } from "@fieldmaster/shared-types";
import { TimeEntriesService } from "./time-entries.service";
import { AttendanceApprovalsService } from "./attendance-approvals.service";
import { ManualCorrectionsService } from "./manual-corrections.service";
import { ForgottenStampService } from "./forgotten-stamp.service";
import { FullDayCreditDto, ApproveTimeEntryDto, RejectTimeEntryDto, RequestCorrectionDto } from "./dto/approval.dto";
import { CreateManualCorrectionDto } from "./dto/manual-correction.dto";

@ApiBearerAuth()
@ApiTags("attendance")
@Controller()
export class TimeEntriesController {
  constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly approvalsService: AttendanceApprovalsService,
    private readonly correctionsService: ManualCorrectionsService,
    private readonly forgottenStampService: ForgottenStampService,
  ) {}

  @Get("time-entries")
  @RequirePermissions(Permission.VIEW_OWN_ATTENDANCE)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("workerProfileId") workerProfileId?: string,
    @Query("status") status?: TimeEntryStatus,
    @Query("businessDate") businessDate?: string,
  ) {
    return this.timeEntriesService.list(user.organizationId, user, { workerProfileId, status, businessDate });
  }

  @Get("time-entries/:id")
  @RequirePermissions(Permission.VIEW_OWN_ATTENDANCE)
  getById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timeEntriesService.getById(user.organizationId, id, user);
  }

  @Get("attendance-approvals/pending")
  @RequirePermissions(Permission.APPROVE_ATTENDANCE)
  listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.approvalsService.listPendingApproval(user.organizationId);
  }

  @Post("time-entries/:id/full-day-credit")
  @RequirePermissions(Permission.APPLY_FULL_DAY_CREDIT)
  applyFullDayCredit(
    @Param("id") id: string,
    @Body() dto: FullDayCreditDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.approvalsService.applyFullDayCredit(user.organizationId, id, dto.reason, user, correlationId);
  }

  @Post("time-entries/:id/approve")
  @RequirePermissions(Permission.APPROVE_ATTENDANCE)
  approve(@Param("id") id: string, @Body() dto: ApproveTimeEntryDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.approvalsService.approve(user.organizationId, id, user, dto.notes, correlationId);
  }

  @Post("time-entries/:id/reject")
  @RequirePermissions(Permission.APPROVE_ATTENDANCE)
  reject(@Param("id") id: string, @Body() dto: RejectTimeEntryDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.approvalsService.reject(user.organizationId, id, dto.reason, user, correlationId);
  }

  @Post("time-entries/:id/request-correction")
  @RequirePermissions(Permission.APPROVE_ATTENDANCE)
  requestCorrection(
    @Param("id") id: string,
    @Body() dto: RequestCorrectionDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.approvalsService.requestCorrection(user.organizationId, id, dto.notes, user, correlationId);
  }

  @Post("manual-corrections")
  @RequirePermissions(Permission.CORRECT_TIME_ENTRIES)
  createCorrection(@Body() dto: CreateManualCorrectionDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.correctionsService.create(user.organizationId, dto, user, { correlationId });
  }

  @Get("forgotten-stamp-infractions")
  @RequirePermissions(Permission.APPROVE_ATTENDANCE)
  listForgottenStampInfractions(@CurrentUser() user: AuthenticatedUser, @Query("workerProfileId") workerProfileId?: string) {
    return this.forgottenStampService.listForOrganization(user.organizationId, workerProfileId);
  }

  @Post("forgotten-stamp-infractions/:id/reverse")
  @RequirePermissions(Permission.MANAGE_PAYROLL)
  reverseInfraction(
    @Param("id") id: string,
    @Body() dto: RejectTimeEntryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.forgottenStampService.reverse(user.organizationId, id, dto.reason, user, correlationId);
  }
}
