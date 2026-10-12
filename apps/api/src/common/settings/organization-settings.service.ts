import { Injectable } from "@nestjs/common";
import type { OrganizationSettings, Prisma } from "@prisma/client";
import { NotificationType } from "@fieldmaster/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { generateId } from "../ids";

/** Besides the Owners, who a manager-facing notification reaches: the shift's manager, or every Field Manager. */
export const FieldManagerAudience = {
  SHIFT_MANAGER: "SHIFT_MANAGER",
  ALL_FIELD_MANAGERS: "ALL_FIELD_MANAGERS",
} as const;
export type FieldManagerAudience = (typeof FieldManagerAudience)[keyof typeof FieldManagerAudience];

export interface NotificationAudience {
  owners: boolean;
  fieldManagers: boolean;
}

/**
 * Manager-facing notifications an Owner can switch on or off per audience
 * (Step 6). The defaults are exactly who received each one before the
 * setting existed, so an organization that never opens the page keeps
 * today's behavior. Notifications to the worker concerned (approvals,
 * assignments) are not configurable.
 */
export const CONFIGURABLE_NOTIFICATIONS = {
  [NotificationType.WORKER_CLOCKED_IN]: { fieldManagerAudience: FieldManagerAudience.SHIFT_MANAGER, defaults: { owners: true, fieldManagers: true } },
  [NotificationType.WORKER_CLOCKED_OUT]: { fieldManagerAudience: FieldManagerAudience.SHIFT_MANAGER, defaults: { owners: true, fieldManagers: true } },
  [NotificationType.OVERTIME_THRESHOLD_CROSSED]: { fieldManagerAudience: FieldManagerAudience.SHIFT_MANAGER, defaults: { owners: true, fieldManagers: true } },
  [NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED]: {
    fieldManagerAudience: FieldManagerAudience.SHIFT_MANAGER,
    defaults: { owners: true, fieldManagers: true },
  },
  [NotificationType.EMERGENCY_SHIFT_STARTED]: { fieldManagerAudience: FieldManagerAudience.ALL_FIELD_MANAGERS, defaults: { owners: true, fieldManagers: true } },
  [NotificationType.EMERGENCY_SHIFT_ENDED]: { fieldManagerAudience: FieldManagerAudience.ALL_FIELD_MANAGERS, defaults: { owners: true, fieldManagers: true } },
  [NotificationType.ONBOARDING_SUBMITTED]: { fieldManagerAudience: FieldManagerAudience.ALL_FIELD_MANAGERS, defaults: { owners: true, fieldManagers: false } },
  [NotificationType.OFFLINE_EVENT_REJECTED]: { fieldManagerAudience: FieldManagerAudience.ALL_FIELD_MANAGERS, defaults: { owners: true, fieldManagers: false } },
  [NotificationType.SUSPICIOUS_LOCATION_DETECTED]: {
    fieldManagerAudience: FieldManagerAudience.ALL_FIELD_MANAGERS,
    defaults: { owners: true, fieldManagers: false },
  },
} as const satisfies Partial<Record<NotificationType, { fieldManagerAudience: FieldManagerAudience; defaults: NotificationAudience }>>;
export type ConfigurableNotificationType = Extract<keyof typeof CONFIGURABLE_NOTIFICATIONS, string>;

export function isConfigurableNotification(type: string): type is ConfigurableNotificationType {
  return Object.prototype.hasOwnProperty.call(CONFIGURABLE_NOTIFICATIONS, type);
}

type SettingsClient = Pick<Prisma.TransactionClient, "organizationSettings">;

/**
 * The organization's settings, read from the database on every use (Step 6):
 * no setting the API applies is a code constant or an environment variable.
 * The row is created with the column defaults (the values the API used to
 * hard-code) the first time an organization needs it.
 */
@Injectable()
export class OrganizationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, client: SettingsClient = this.prisma): Promise<OrganizationSettings> {
    const existing = await client.organizationSettings.findUnique({ where: { organizationId } });
    if (existing) return existing;
    return client.organizationSettings.upsert({ where: { organizationId }, create: { id: generateId(), organizationId }, update: {} });
  }

  /** Who one configurable notification reaches in this organization (the stored choice, or the default). */
  notificationAudience(settings: Pick<OrganizationSettings, "notificationPreferences">, type: ConfigurableNotificationType): NotificationAudience {
    const stored = asPreferences(settings.notificationPreferences)[type];
    const defaults = CONFIGURABLE_NOTIFICATIONS[type].defaults;
    return { owners: stored?.owners ?? defaults.owners, fieldManagers: stored?.fieldManagers ?? defaults.fieldManagers };
  }
}

/** The stored JSON, read defensively: anything that is not `{ owners?: boolean, fieldManagers?: boolean }` counts as unset. */
export function asPreferences(value: Prisma.JsonValue): Partial<Record<string, Partial<NotificationAudience>>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Partial<NotificationAudience>> = {};
  for (const [type, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const audience = entry as Record<string, unknown>;
    result[type] = {
      ...(typeof audience.owners === "boolean" ? { owners: audience.owners } : {}),
      ...(typeof audience.fieldManagers === "boolean" ? { fieldManagers: audience.fieldManagers } : {}),
    };
  }
  return result;
}
