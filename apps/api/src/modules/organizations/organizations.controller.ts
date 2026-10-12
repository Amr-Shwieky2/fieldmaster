import { Body, Controller, Get, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OrganizationsService } from "./organizations.service";
import { UpdateNotificationSettingsDto, UpdateOnboardingSettingsDto, UpdateWorkdaySettingsDto } from "./dto/update-settings.dto";

/**
 * Organization settings (Step 6): Owners and Field Managers read them,
 * Owners change them one section at a time (each change audited old -> new).
 */
@ApiBearerAuth()
@ApiTags("organizations")
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get("me/settings")
  @RequirePermissions(Permission.VIEW_ORG_SETTINGS)
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getSettings(user.organizationId, user);
  }

  @Patch("me/settings/workday")
  @RequirePermissions(Permission.MANAGE_ORG_SETTINGS)
  updateWorkday(@Body() dto: UpdateWorkdaySettingsDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.organizationsService.updateWorkday(user.organizationId, dto, user, correlationId);
  }

  @Patch("me/settings/onboarding")
  @RequirePermissions(Permission.MANAGE_ORG_SETTINGS)
  updateOnboarding(@Body() dto: UpdateOnboardingSettingsDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.organizationsService.updateOnboarding(user.organizationId, dto, user, correlationId);
  }

  @Patch("me/settings/notifications")
  @RequirePermissions(Permission.MANAGE_ORG_SETTINGS)
  updateNotifications(@Body() dto: UpdateNotificationSettingsDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.organizationsService.updateNotifications(user.organizationId, dto, user, correlationId);
  }
}
