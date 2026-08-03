import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { SitesService } from "./sites.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { CreateSiteDto } from "./dto/create-site.dto";
import { CreateGeofenceDto } from "./dto/create-geofence.dto";

@ApiBearerAuth()
@ApiTags("projects-sites-geofences")
@Controller()
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post("projects")
  @RequirePermissions(Permission.MANAGE_SITES)
  createProject(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.sitesService.createProject(user.organizationId, dto, user, correlationId);
  }

  @Get("projects")
  @RequirePermissions(Permission.MANAGE_SITES)
  listProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.sitesService.listProjects(user.organizationId, user);
  }

  @Get("projects/:id")
  @RequirePermissions(Permission.MANAGE_SITES)
  getProject(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sitesService.getProject(user.organizationId, id, user);
  }

  @Post("sites")
  @RequirePermissions(Permission.MANAGE_SITES)
  createSite(@Body() dto: CreateSiteDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.sitesService.createSite(user.organizationId, dto, user, correlationId);
  }

  @Get("sites")
  @RequirePermissions(Permission.MANAGE_SITES)
  listSites(@CurrentUser() user: AuthenticatedUser, @Query("projectId") projectId?: string) {
    return this.sitesService.listSites(user.organizationId, projectId);
  }

  @Get("sites/:id")
  @RequirePermissions(Permission.MANAGE_SITES)
  getSite(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sitesService.getSite(user.organizationId, id);
  }

  @Post("geofences")
  @RequirePermissions(Permission.MANAGE_SITES)
  createGeofence(@Body() dto: CreateGeofenceDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.sitesService.createGeofence(user.organizationId, dto, user, correlationId);
  }

  @Get("sites/:id/geofences")
  @RequirePermissions(Permission.MANAGE_SITES)
  listGeofences(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sitesService.listGeofencesForSite(user.organizationId, id);
  }
}
