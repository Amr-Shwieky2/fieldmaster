import { Body, Controller, Get, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OrganizationsService } from "./organizations.service";
import { WorkRulesAdminService } from "./work-rules-admin.service";
import { CreateWorkRuleVersionDto, UpdateOwnerLimitDto, WorkRulesImpactQueryDto } from "./dto/work-rules.dto";
import { UpdateNotificationSettingsDto, UpdateOnboardingSettingsDto, UpdateWorkdaySettingsDto } from "./dto/update-settings.dto";

/**
 * Organization settings (Step 6): Owners and Field Managers read them,
 * Owners change them one section at a time (each change audited old -> new).
 */
@ApiBearerAuth()
@ApiTags("organizations")
@Controller("organizations")
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly workRulesAdmin: WorkRulesAdminService,
  ) {}

  @Get("me/settings")
  @RequirePermissions(Permission.VIEW_ORG_SETTINGS)
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getSettings(user.organizationId, user);
  }

  /** The limit of active Owners (empty = no limit) and how many there are now. */
  @Get("me/owner-limit")
  @RequirePermissions(Permission.VIEW_ORG_SETTINGS)
  getOwnerLimit(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getOwnerLimit(user.organizationId, user);
  }

  @Patch("me/settings/owners")
  @RequirePermissions(Permission.MANAGE_ORG_SETTINGS)
  updateOwnerLimit(@Body() dto: UpdateOwnerLimitDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.organizationsService.updateOwnerLimit(user.organizationId, dto, user, correlationId);
  }

  /** The work rules: the values in force today and every version, with its effective date and reason. */
  @Get("me/work-rules")
  @RequirePermissions(Permission.VIEW_ORG_SETTINGS)
  getWorkRules(@CurrentUser() user: AuthenticatedUser) {
    return this.workRulesAdmin.view(user.organizationId, user);
  }

  /** Which payroll months a change effective on this date reaches, and which stay as they are. */
  @Get("me/work-rules/impact")
  @RequirePermissions(Permission.VIEW_ORG_SETTINGS)
  workRulesImpact(@Query() query: WorkRulesImpactQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workRulesAdmin.impact(user.organizationId, query.effectiveFrom);
  }

  /** A new version of the work rules, effective after today (never an edit of an older one). */
  @Post("me/work-rules")
  @RequirePermissions(Permission.MANAGE_ORG_SETTINGS)
  createWorkRuleVersion(@Body() dto: CreateWorkRuleVersionDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.workRulesAdmin.create(user.organizationId, dto, user, correlationId);
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
