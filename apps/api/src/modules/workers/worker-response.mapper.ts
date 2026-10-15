import { Permission, type OrgRole } from "@fieldmaster/shared-types";
import { hasPermission } from "../../common/auth/permissions";
import type { CompensationProfile, User, WorkerProfile } from "@prisma/client";

export interface WorkerListRow {
  workerProfile: WorkerProfile & { membership: { role: string; status: string; user: User } };
  activeCompensationProfile?: CompensationProfile | null;
}

/**
 * Central enforcement point for "whoever may not see money -- Field
 * Managers, Temporary Supervisors, custom roles without the financial
 * permission -- must never see compensation" (spec section 6.2 / 31.3). Every worker
 * response -- list, detail, or nested in shift/attendance payloads -- must
 * be built through this mapper rather than returning Prisma rows directly.
 */
export function serializeWorker(
  row: WorkerListRow,
  viewer: { role: OrgRole; workerProfileId: string | null; permissions?: ReadonlySet<Permission> },
) {
  const wp = row.workerProfile;
  // Compensation: a member who may see it (VIEW_COMPENSATION), or the worker themself.
  const canSeeFinancials = hasPermission(viewer, Permission.VIEW_COMPENSATION) || viewer.workerProfileId === wp.id;

  const base = {
    id: wp.id,
    organizationId: wp.organizationId,
    fullLegalName: wp.membership.user.fullLegalName,
    preferredName: wp.membership.user.preferredName,
    phoneNumber: wp.membership.user.phoneNumber,
    preferredLanguage: wp.membership.user.preferredLanguage,
    accountStatus: wp.membership.status,
    role: wp.membership.role,
    profilePhotoUrl: wp.profilePhotoUrl,
    createdAt: wp.createdAt,
  };

  if (!canSeeFinancials) {
    return base;
  }

  return {
    ...base,
    compensation: row.activeCompensationProfile
      ? {
          compensationType: row.activeCompensationProfile.compensationType,
          dailyBaseRateAgorot: row.activeCompensationProfile.dailyBaseRateAgorot,
          baseHourlyRateAgorot: row.activeCompensationProfile.baseHourlyRateAgorot,
          overtimeHourlyRateAgorot: row.activeCompensationProfile.overtimeHourlyRateAgorot,
          effectiveStartDate: row.activeCompensationProfile.effectiveStartDate,
        }
      : null,
  };
}
