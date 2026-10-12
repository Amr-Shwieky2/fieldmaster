import { Inject, Injectable } from "@nestjs/common";
import type { OrganizationSettings, Prisma } from "@prisma/client";
import {
  BUSINESS_TIMEZONE,
  EMERGENCY_RETROACTIVE_MINUTES,
  EMERGENCY_RETURN_BUFFER_MINUTES,
  FORGOTTEN_STAMP_FREE_INFRACTIONS,
  FORGOTTEN_STAMP_PENALTY_AGOROT,
  STANDARD_DAY_MINUTES,
} from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Permission, roleHasPermission } from "../../common/auth/permissions";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";
import {
  CONFIGURABLE_NOTIFICATIONS,
  OrganizationSettingsService,
  asPreferences,
  type ConfigurableNotificationType,
} from "../../common/settings/organization-settings.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { UpdateNotificationSettingsDto, UpdateOnboardingSettingsDto, UpdateWorkdaySettingsDto } from "./dto/update-settings.dto";

/** The workday settings an Owner can change, in the order the page shows them. */
const WORKDAY_FIELDS = [
  "defaultGraceMinutes",
  "defaultGeofenceRadiusMeters",
  "defaultMinGpsAccuracyMeters",
  "deviceTimeDeviationSeconds",
  "temporaryPointRadiusMeters",
  "temporaryPointMinAccuracyMeters",
  "autoDeductUnpaidBreaks",
] as const satisfies readonly (keyof UpdateWorkdaySettingsDto & keyof OrganizationSettings)[];

/**
 * Organization settings (Step 6). Read by Owners and Field Managers (a Field
 * Manager's copy has no money: the forgotten-stamp penalty amount is left
 * out); changed by Owners only, one section at a time, every changed field
 * audited as old -> new. The fixed business rules (9-hour day, two free
 * forgotten stamps, the penalty, -60 / +15 minutes for emergencies) and the
 * test-mode status are shown, never editable.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrganizationSettingsService,
    private readonly auditService: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment,
  ) {}

  async getSettings(organizationId: string, viewer: AuthenticatedUser) {
    return this.view(await this.settings.get(organizationId), viewer);
  }

  async updateWorkday(organizationId: string, dto: UpdateWorkdaySettingsDto, actor: AuthenticatedUser, correlationId: string) {
    const current = await this.settings.get(organizationId);
    const changes = WORKDAY_FIELDS.filter((field) => dto[field] !== undefined && dto[field] !== current[field]).map((field) => ({
      field,
      oldValue: String(current[field]),
      newValue: String(dto[field]),
    }));
    const data = Object.fromEntries(WORKDAY_FIELDS.filter((field) => dto[field] !== undefined).map((field) => [field, dto[field]]));
    return this.save(organizationId, data, changes, actor, correlationId);
  }

  async updateOnboarding(organizationId: string, dto: UpdateOnboardingSettingsDto, actor: AuthenticatedUser, correlationId: string) {
    const current = await this.settings.get(organizationId);
    const changes =
      dto.invitationTtlHours === current.onboardingInvitationTtlHours
        ? []
        : [{ field: "onboardingInvitationTtlHours", oldValue: String(current.onboardingInvitationTtlHours), newValue: String(dto.invitationTtlHours) }];
    return this.save(organizationId, { onboardingInvitationTtlHours: dto.invitationTtlHours }, changes, actor, correlationId);
  }

  async updateNotifications(organizationId: string, dto: UpdateNotificationSettingsDto, actor: AuthenticatedUser, correlationId: string) {
    // One entry per event: two entries for the same event would make the audit's old -> new ambiguous.
    const types = dto.preferences.map((preference) => preference.type);
    if (new Set(types).size !== types.length) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Each notification type may appear only once.");
    }
    const current = await this.settings.get(organizationId);
    const stored = asPreferences(current.notificationPreferences);
    const changes: { field: string; oldValue: string; newValue: string }[] = [];
    for (const preference of dto.preferences) {
      const before = this.settings.notificationAudience(current, preference.type);
      const entry = { ...stored[preference.type] };
      for (const audience of ["owners", "fieldManagers"] as const) {
        const value = preference[audience];
        if (value === undefined) continue;
        if (value !== before[audience]) changes.push({ field: `notifications.${preference.type}.${audience}`, oldValue: String(before[audience]), newValue: String(value) });
        entry[audience] = value;
      }
      stored[preference.type] = entry;
    }
    return this.save(organizationId, { notificationPreferences: stored as Prisma.InputJsonValue }, changes, actor, correlationId);
  }

  private async save(
    organizationId: string,
    data: Prisma.OrganizationSettingsUpdateInput,
    changes: { field: string; oldValue: string; newValue: string }[],
    actor: AuthenticatedUser,
    correlationId: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.organizationSettings.update({ where: { organizationId }, data });
      for (const change of changes) {
        await this.auditService.record(
          {
            organizationId,
            actorUserId: actor.sub,
            action: "ORGANIZATION_SETTING_CHANGED",
            entityType: "OrganizationSettings",
            entityId: row.id,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            correlationId,
          },
          tx,
        );
      }
      return row;
    });
    return this.view(updated, actor);
  }

  private view(settings: OrganizationSettings, viewer: AuthenticatedUser) {
    // Money (the penalty amount) only for someone who may see compensation: an Owner.
    const isOwnerView = roleHasPermission(viewer.role, Permission.VIEW_COMPENSATION);
    return {
      canEdit: roleHasPermission(viewer.role, Permission.MANAGE_ORG_SETTINGS),
      workday: {
        defaultGraceMinutes: settings.defaultGraceMinutes,
        defaultGeofenceRadiusMeters: settings.defaultGeofenceRadiusMeters,
        defaultMinGpsAccuracyMeters: settings.defaultMinGpsAccuracyMeters,
        deviceTimeDeviationSeconds: settings.deviceTimeDeviationSeconds,
        temporaryPointRadiusMeters: settings.temporaryPointRadiusMeters,
        temporaryPointMinAccuracyMeters: settings.temporaryPointMinAccuracyMeters,
        autoDeductUnpaidBreaks: settings.autoDeductUnpaidBreaks,
        timezone: BUSINESS_TIMEZONE,
      },
      onboarding: { invitationTtlHours: settings.onboardingInvitationTtlHours },
      notifications: (Object.keys(CONFIGURABLE_NOTIFICATIONS) as ConfigurableNotificationType[]).map((type) => ({
        type,
        fieldManagerAudience: CONFIGURABLE_NOTIFICATIONS[type].fieldManagerAudience,
        ...this.settings.notificationAudience(settings, type),
        defaults: CONFIGURABLE_NOTIFICATIONS[type].defaults,
      })),
      testMode: { appEnv: this.appEnvironment.appEnv, devLoginEnabled: this.appEnvironment.devLoginEnabled },
      // Fixed business rules: shown, never editable. Only an Owner's copy carries the penalty amount (money).
      fixedRules: {
        standardDayMinutes: STANDARD_DAY_MINUTES,
        freeForgottenStampsPerMonth: FORGOTTEN_STAMP_FREE_INFRACTIONS,
        emergencyRetroactiveMinutes: EMERGENCY_RETROACTIVE_MINUTES,
        emergencyReturnBufferMinutes: EMERGENCY_RETURN_BUFFER_MINUTES,
        ...(isOwnerView ? { forgottenStampPenaltyAgorot: FORGOTTEN_STAMP_PENALTY_AGOROT } : {}),
      },
      updatedAt: settings.updatedAt,
    };
  }
}
