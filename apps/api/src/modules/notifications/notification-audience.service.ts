import { Injectable } from "@nestjs/common";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { Permission } from "../../common/auth/permissions";
import { NOTIFICATION_PERMISSION } from "./notification-preferences";
import { MEMBERSHIP_ACCESS_INCLUDE, effectivePermissionsOf } from "../../common/auth/member-access";
import {
  CONFIGURABLE_NOTIFICATIONS,
  FieldManagerAudience,
  OrganizationSettingsService,
  type ConfigurableNotificationType,
  type NotificationAudience,
} from "../../common/settings/organization-settings.service";

/** Where an event happened. Without one the event is about the whole organization: a member restricted to some projects is not told. */
export interface AudienceContext {
  projectId?: string | null;
  siteId?: string | null;
}

export interface AudienceRecipient {
  userId: string;
  /** May see money (VIEW_FINANCIALS): gets the copy with amounts, where there is one. */
  financial: boolean;
  /** The shift's own manager (their copy never has money, as before). */
  isShiftManager: boolean;
}

/**
 * Who a manager-facing notification reaches, after the organization's
 * notification settings (Step 6) and the members' roles and project scopes
 * (flexible organization model):
 * - the Owners follow the "owners" switch;
 * - everyone else who manages -- Field Managers and custom roles -- follows
 *   the "fieldManagers" switch: the shift's manager (or every Field
 *   Manager, per the type), and custom roles holding the type's permission;
 * - a member restricted to some projects is told only about events in them.
 * With the default settings and only built-in roles the result is exactly
 * the recipients each call site used before.
 */
@Injectable()
export class NotificationAudienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrganizationSettingsService,
  ) {}

  async recipients(
    organizationId: string,
    type: ConfigurableNotificationType,
    options: { managerUserId?: string; context?: AudienceContext } = {},
  ): Promise<AudienceRecipient[]> {
    const audience = this.settings.notificationAudience(await this.settings.get(organizationId), type);
    const rule = CONFIGURABLE_NOTIFICATIONS[type];
    const required = NOTIFICATION_PERMISSION[type];
    const members = await this.prisma.organizationMembership.findMany({
      where: { organizationId, status: AccountStatus.ACTIVE, archivedAt: null, user: { status: AccountStatus.ACTIVE } },
      include: MEMBERSHIP_ACCESS_INCLUDE,
    });

    const result: AudienceRecipient[] = [];
    for (const member of members) {
      const isShiftManager = options.managerUserId !== undefined && member.userId === options.managerUserId;
      const kind = member.role as OrgRole;
      const permissions = effectivePermissionsOf({ role: kind, roleRecord: member.roleRecord, restrictedToScope: member.restrictedToScope });

      let included: boolean;
      if (kind === OrgRole.OWNER) {
        included = audience.owners;
      } else if (isShiftManager) {
        included = audience.fieldManagers;
      } else if (kind === OrgRole.FIELD_MANAGER) {
        included = audience.fieldManagers && rule.fieldManagerAudience === FieldManagerAudience.ALL_FIELD_MANAGERS;
      } else if (kind === OrgRole.CUSTOM) {
        included = audience.fieldManagers && permissions.has(required);
      } else {
        included = false;
      }
      if (!included) continue;
      if (member.restrictedToScope && !coversContext(member.scopes, options.context)) continue;

      result.push({ userId: member.userId, financial: permissions.has(Permission.VIEW_FINANCIALS), isShiftManager });
    }
    return result;
  }

  /** The projects and site of a shift, for the audience's scope check. */
  async contextOfShift(shiftId: string): Promise<AudienceContext> {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId }, select: { projectId: true, siteId: true, site: { select: { projectId: true } } } });
    return shift ? { projectId: shift.projectId ?? shift.site?.projectId ?? null, siteId: shift.siteId } : {};
  }

  /** The switches of one notification type (for the settings page). */
  async audienceOf(organizationId: string, type: ConfigurableNotificationType): Promise<NotificationAudience> {
    return this.settings.notificationAudience(await this.settings.get(organizationId), type);
  }
}

/** Does a restricted member's selection cover the place of an event? Nothing is covered when the event has no place. */
function coversContext(scopes: { projectId: string | null; siteId: string | null }[], context: AudienceContext | undefined): boolean {
  if (!context) return false;
  return scopes.some(
    (scope) =>
      (scope.projectId !== null && scope.projectId === context.projectId) || (scope.siteId !== null && scope.siteId === context.siteId),
  );
}
