import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { WorkersService } from "./workers.service";
import { ApproveWorkerDto, RejectWorkerDto } from "./dto/approve-worker.dto";
import { CreateCompensationProfileDto } from "./dto/create-compensation-profile.dto";

@ApiBearerAuth()
@ApiTags("workers")
@Controller("workers")
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @Get()
  @RequirePermissions(Permission.MANAGE_WORKERS)
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.workersService.list(user.organizationId, user);
  }

  @Get("pending-approval")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async pendingApproval(@CurrentUser() user: AuthenticatedUser) {
    return this.workersService.listPendingApproval(user.organizationId);
  }

  @Get(":id")
  @RequirePermissions(Permission.MANAGE_WORKERS)
  async getById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workersService.getById(user.organizationId, id, user);
  }

  @Post(":id/approve")
  @RequirePermissions(Permission.APPROVE_ONBOARDING, Permission.MANAGE_COMPENSATION)
  async approve(
    @Param("id") id: string,
    @Body() dto: ApproveWorkerDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.workersService.approve(user.organizationId, id, dto, user, correlationId);
  }

  @Post(":id/reject")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async reject(
    @Param("id") id: string,
    @Body() dto: RejectWorkerDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.workersService.reject(user.organizationId, id, dto, user, correlationId);
  }

  @Get(":id/compensation-profiles")
  async listCompensationProfiles(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workersService.listCompensationProfiles(user.organizationId, id, user);
  }

  @Post(":id/compensation-profiles")
  @RequirePermissions(Permission.MANAGE_COMPENSATION)
  async addCompensationProfile(
    @Param("id") id: string,
    @Body() dto: CreateCompensationProfileDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.workersService.addCompensationProfile(user.organizationId, id, dto, user, correlationId);
  }
}
