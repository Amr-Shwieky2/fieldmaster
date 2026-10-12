import { Injectable } from "@nestjs/common";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { OrganizationSettingsService, type ConfigurableNotificationType, type NotificationAudience } from "../../common/settings/organization-settings.service";

/**
 * Who a manager-facing notification reaches, after the organization's
 * notification settings (Step 6). With the default settings the result is
 * exactly the recipients each call site used before.
 */
@Injectable()
export class NotificationAudienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrganizationSettingsService,
  ) {}

  /** Every active Owner and every active Field Manager, each list empty when that audience is switched off. */
  async managers(organizationId: string, type: ConfigurableNotificationType): Promise<{ ownerUserIds: string[]; fieldManagerUserIds: string[] }> {
    const audience = await this.audience(organizationId, type);
    const [ownerUserIds, fieldManagerUserIds] = await Promise.all([
      audience.owners ? this.activeMemberUserIds(organizationId, OrgRole.OWNER) : [],
      audience.fieldManagers ? this.activeMemberUserIds(organizationId, OrgRole.FIELD_MANAGER) : [],
    ]);
    return { ownerUserIds, fieldManagerUserIds };
  }

  /**
   * The shift's manager and the Owners. The manager follows the Field
   * Managers' switch, or the Owners' switch when the manager is an Owner.
   */
  async shiftManagerAndOwners(
    organizationId: string,
    type: ConfigurableNotificationType,
    managerUserId: string,
  ): Promise<{ managerUserId: string | null; ownerUserIds: string[] }> {
    const audience = await this.audience(organizationId, type);
    const [ownerUserIds, manager] = await Promise.all([
      audience.owners ? this.activeMemberUserIds(organizationId, OrgRole.OWNER) : [],
      this.prisma.organizationMembership.findFirst({ where: { organizationId, userId: managerUserId }, select: { role: true } }),
    ]);
    const managerIncluded = manager?.role === OrgRole.OWNER ? audience.owners : audience.fieldManagers;
    return { managerUserId: managerIncluded ? managerUserId : null, ownerUserIds };
  }

  private async audience(organizationId: string, type: ConfigurableNotificationType): Promise<NotificationAudience> {
    return this.settings.notificationAudience(await this.settings.get(organizationId), type);
  }

  private async activeMemberUserIds(organizationId: string, role: OrgRole): Promise<string[]> {
    const members = await this.prisma.organizationMembership.findMany({
      where: { organizationId, role, status: AccountStatus.ACTIVE, archivedAt: null },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }
}
