import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission, hasAnyPermission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { RolesService } from "./roles.service";
import { ArchiveRoleDto, CreateRoleDto, UpdateRoleDto } from "./dto/role.dto";

/**
 * Roles and permissions. Reading the list (and the catalog of permissions)
 * is for whoever manages roles or users (the users page needs the list to
 * assign one); creating, editing and archiving custom roles is MANAGE_ROLES.
 */
@ApiBearerAuth()
@ApiTags("roles")
@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get("catalog")
  catalog(@CurrentUser() user: AuthenticatedUser) {
    this.assertMayRead(user);
    return this.roles.catalog();
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    this.assertMayRead(user);
    return this.roles.list(user.organizationId, { includeArchived: includeArchived === "true" });
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    this.assertMayRead(user);
    return this.roles.getById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions(Permission.MANAGE_ROLES)
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.roles.create(user.organizationId, dto, user, correlationId);
  }

  @Patch(":id")
  @RequirePermissions(Permission.MANAGE_ROLES)
  update(@Param("id") id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.roles.update(user.organizationId, id, dto, user, correlationId);
  }

  @Post(":id/archive")
  @RequirePermissions(Permission.MANAGE_ROLES)
  archive(@Param("id") id: string, @Body() dto: ArchiveRoleDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.roles.archive(user.organizationId, id, dto, user, correlationId);
  }

  private assertMayRead(user: AuthenticatedUser): void {
    if (!hasAnyPermission(user, [Permission.MANAGE_ROLES, Permission.MANAGE_ORG_USERS])) {
      throw new ForbiddenException("Missing required permission(s): MANAGE_ROLES or MANAGE_ORG_USERS");
    }
  }
}
