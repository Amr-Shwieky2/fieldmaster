import { Body, Controller, Get, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OrganizationsService } from "./organizations.service";
import { UpdateOrganizationSettingsDto } from "./dto/update-settings.dto";

@ApiBearerAuth()
@ApiTags("organizations")
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get("me/settings")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getSettings(user.organizationId);
  }

  @Patch("me/settings")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  async updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOrganizationSettingsDto) {
    return this.organizationsService.updateSettings(user.organizationId, dto);
  }
}
