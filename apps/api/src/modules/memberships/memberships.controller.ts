import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { MembershipsService } from "./memberships.service";
import { pageWindow } from "../../common/validation/page-query";
import { CreateMembershipDto } from "./dto/create-membership.dto";
import { ChangeMemberRoleDto, MemberActionReasonDto, SetMemberScopeDto, SetTimeTrackingDto } from "./dto/member-actions.dto";

/** Members, their roles and project scope, and devices (MANAGE_ORG_USERS; every change with a reason, audited). */
@ApiBearerAuth()
@ApiTags("memberships")
@Controller("memberships")
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  async create(@Body() dto: CreateMembershipDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.create(user.organizationId, dto, user, correlationId);
  }

  @Get()
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  async list(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.membershipsService.list(user.organizationId, user, pageWindow({ page, pageSize }));
  }

  /** Each member's role record and project scope (the users page joins it to the list by membershipId). */
  @Get("access")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  async access(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.membershipsService.access(user.organizationId, pageWindow({ page, pageSize }));
  }

  @Patch(":id/role")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  changeRole(@Param("id") id: string, @Body() dto: ChangeMemberRoleDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.changeRole(user.organizationId, id, dto, user, correlationId);
  }

  /** All projects, or only the listed projects and sites (a restricted member sees only those, everywhere). */
  @Patch(":id/scope")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  setScope(@Param("id") id: string, @Body() dto: SetMemberScopeDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.setScope(user.organizationId, id, dto, user, correlationId);
  }

  @Post(":id/suspend")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  suspend(@Param("id") id: string, @Body() dto: MemberActionReasonDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.suspend(user.organizationId, id, dto, user, correlationId);
  }

  @Post(":id/reactivate")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  reactivate(@Param("id") id: string, @Body() dto: MemberActionReasonDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.reactivate(user.organizationId, id, dto, user, correlationId);
  }

  @Post(":id/archive")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  archive(@Param("id") id: string, @Body() dto: MemberActionReasonDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.archive(user.organizationId, id, dto, user, correlationId);
  }

  @Patch(":id/time-tracking")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  setTimeTracking(@Param("id") id: string, @Body() dto: SetTimeTrackingDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.setTimeTracking(user.organizationId, id, dto, user, correlationId);
  }

  @Get(":id/devices")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  devices(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.membershipsService.devicesAndSessions(user.organizationId, id);
  }

  @Post(":id/sessions/:sessionId/revoke")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  revokeSession(
    @Param("id") id: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: MemberActionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.membershipsService.revokeSession(user.organizationId, id, sessionId, dto, user, correlationId);
  }

  @Post(":id/devices/:deviceId/revoke-key")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  revokeDeviceKey(
    @Param("id") id: string,
    @Param("deviceId") deviceId: string,
    @Body() dto: MemberActionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.membershipsService.revokeDeviceKey(user.organizationId, id, deviceId, dto, user, correlationId);
  }
}
