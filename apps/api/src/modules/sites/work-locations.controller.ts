import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { WorkLocationsService } from "./work-locations.service";
import { CreateWorkLocationDto, UpdateWorkLocationDto } from "./dto/work-location.dto";

/**
 * Mobile manager mode: a work location (a site with its geofence) created or
 * edited in one transaction from the phone (MANAGE_SITES, within the
 * member's projects). The web's site and geofence routes are unchanged.
 */
@ApiBearerAuth()
@ApiTags("projects-sites-geofences")
@Controller("work-locations")
export class WorkLocationsController {
  constructor(private readonly workLocations: WorkLocationsService) {}

  /** What a new work location starts with (the organization's default radius) and the radius bounds. */
  @Get("defaults")
  @RequirePermissions(Permission.MANAGE_SITES)
  defaults(@CurrentUser() user: AuthenticatedUser) {
    return this.workLocations.defaults(user.organizationId);
  }

  @Get(":id")
  @RequirePermissions(Permission.MANAGE_SITES)
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workLocations.get(user.organizationId, id, user);
  }

  @Post()
  @RequirePermissions(Permission.MANAGE_SITES)
  create(@Body() dto: CreateWorkLocationDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.workLocations.create(user.organizationId, dto, user, correlationId);
  }

  @Patch(":id")
  @RequirePermissions(Permission.MANAGE_SITES)
  update(@Param("id") id: string, @Body() dto: UpdateWorkLocationDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.workLocations.update(user.organizationId, id, dto, user, correlationId);
  }
}
