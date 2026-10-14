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
import { ReverseInfractionDto } from "./dto/reverse-infraction.dto";
import { ListForgottenStampsQueryDto } from "./dto/forgotten-stamp-list.dto";

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

  /** Workers get their own entries only; `?month=YYYY-MM` (Step 9) narrows to a business month. */
  @Get("time-entries")
  @RequirePermissions(Permission.VIEW_OWN_ATTENDANCE)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("workerProfileId") workerProfileId?: string,
    @Query("status") status?: TimeEntryStatus,
    @Query("businessDate") businessDate?: string,
    @Query("month") month?: string,
  ) {
    return this.timeEntriesService.list(user.organizationId, user, { workerProfileId, status, businessDate, month });
  }

  /** The caller's own entry: the worker's detail (Step 9, no money). Managers: any entry, as before. Anyone else: 404. */
  @Get("time-entries/:id")
  @RequirePermissions(Permission.VIEW_OWN_ATTENDANCE)
  getById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timeEntriesService.getById(user.organizationId, id, user);
  }

  @Get("attendance-approvals/pending")
  @RequirePermissions(Permission.APPROVE_ATTENDANCE)
  listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.approvalsService.listPendingApproval(user.organizationId, user);
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
  @RequirePermissions(Permission.VIEW_ATTENDANCE)
  listForgottenStampInfractions(@CurrentUser() user: AuthenticatedUser, @Query() query: ListForgottenStampsQueryDto) {
    return this.forgottenStampService.listForOrganization(user.organizationId, user, query);
  }

  @Post("forgotten-stamp-infractions/:id/reverse")
  @RequirePermissions(Permission.MANAGE_PAYROLL)
  reverseInfraction(
    @Param("id") id: string,
    @Body() dto: ReverseInfractionDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.forgottenStampService.reverse(user.organizationId, id, dto.reason, user, correlationId);
  }
}
