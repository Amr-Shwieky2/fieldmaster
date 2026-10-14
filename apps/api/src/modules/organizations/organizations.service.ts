import { Inject, Injectable } from "@nestjs/common";
import type { OrganizationSettings, Prisma } from "@prisma/client";
import { BUSINESS_TIMEZONE } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Permission, canViewFinancials, hasPermission } from "../../common/auth/permissions";
import { WorkRulesService } from "../../common/settings/work-rules.service";
import { OwnerLimitService } from "./owner-limit.service";
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
import type { UpdateOwnerLimitDto } from "./dto/work-rules.dto";

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
 * Organization settings (Step 6). Read by whoever holds VIEW_ORG_SETTINGS (a
 * copy for someone who may not see money leaves the forgotten-stamp penalty
 * amount out); changed by whoever holds MANAGE_ORG_SETTINGS, one section at
 * a time, every changed field audited as old -> new. The work rules (9-hour
 * day, two free forgotten stamps, the penalty, -60 / +15 minutes for
 * emergencies) are shown here as the rules in force today; they are changed
 * as effective-dated versions (WorkRulesAdminService), never in place. The
 * test-mode status is shown, never editable. The limit of Owners is changed
 * here too (`updateOwnerLimit`).
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrganizationSettingsService,
    private readonly auditService: AuditService,
    private readonly workRules: WorkRulesService,
    private readonly ownerLimit: OwnerLimitService,
    @Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment,
  ) {}

  async getSettings(organizationId: string, viewer: AuthenticatedUser) {
    return this.view(await this.settings.get(organizationId), viewer);
  }

  /** `GET /organizations/me/owner-limit`: the limit of active Owners and how many there are. */
  async getOwnerLimit(organizationId: string, viewer: AuthenticatedUser) {
    const [maxOwners, activeOwners] = await Promise.all([this.ownerLimit.maxOwners(organizationId), this.ownerLimit.activeOwners(organizationId, undefined)]);
    return { maxOwners, activeOwners, canEdit: hasPermission(viewer, Permission.MANAGE_ORG_SETTINGS) };
  }

  /**
   * `PATCH /organizations/me/settings/owners`: the most active Owners the
   * organization may have (null = no limit). Not below the number of active
   * Owners now (409); race-safe with Owner changes through the Owners lock.
   */
  async updateOwnerLimit(organizationId: string, dto: UpdateOwnerLimitDto, actor: AuthenticatedUser, correlationId: string) {
    await this.settings.get(organizationId);
    await this.prisma.$transaction(async (tx) => {
      await this.ownerLimit.lockOwners(tx, organizationId);
      const before = await this.ownerLimit.maxOwners(organizationId, tx);
      if (dto.maxOwners !== null) {
        const active = await this.ownerLimit.activeOwners(organizationId, undefined, tx);
        if (dto.maxOwners < active) {
          throw new AppException(409, ErrorCodes.OWNER_LIMIT_BELOW_CURRENT, "The limit cannot be below the number of active Owners.", { activeOwners: active });
        }
      }
      if (before === dto.maxOwners) return;
      const row = await tx.organizationSettings.update({ where: { organizationId }, data: { maxOwners: dto.maxOwners } });
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "ORGANIZATION_SETTING_CHANGED",
          entityType: "OrganizationSettings",
          entityId: row.id,
          field: "maxOwners",
          oldValue: before === null ? "null" : String(before),
          newValue: dto.maxOwners === null ? "null" : String(dto.maxOwners),
          reason: dto.reason,
          correlationId,
        },
        tx,
      );
    });
    return this.getOwnerLimit(organizationId, actor);
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

  private async view(settings: OrganizationSettings, viewer: AuthenticatedUser) {
    // Money (the penalty amount) only for someone who may see financials.
    const isOwnerView = canViewFinancials(viewer);
    // The work rules in force today (the defaults until an Owner adds a version).
    const rules = await this.workRules.current(settings.organizationId);
    return {
      canEdit: hasPermission(viewer, Permission.MANAGE_ORG_SETTINGS),
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
      // The work rules in force today, shown here read-only (changed as dated versions on the work rules page).
      // Only a copy for someone who may see financials carries the penalty amount (money).
      fixedRules: {
        standardDayMinutes: rules.standardDayMinutes,
        freeForgottenStampsPerMonth: rules.freeForgottenStampsPerMonth,
        emergencyRetroactiveMinutes: rules.emergencyMinutesBefore,
        emergencyReturnBufferMinutes: rules.emergencyMinutesAfter,
        ...(isOwnerView ? { forgottenStampPenaltyAgorot: rules.forgottenStampPenaltyAgorot } : {}),
      },
      updatedAt: settings.updatedAt,
    };
  }
}
