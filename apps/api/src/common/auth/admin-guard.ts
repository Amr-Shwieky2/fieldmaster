import type { Prisma } from "@prisma/client";
import { AccountStatus, OrgRole, holdsAdminPermissions, isPermission } from "@fieldmaster/shared-types";
import { AppException, ErrorCodes } from "../errors/app-exception";
import { permissionsOfRole } from "./member-access";

type Tx = Prisma.TransactionClient;

/**
 * "An organization always keeps at least one active member who can manage
 * roles and settings" (flexible organization model). Whoever the change
 * would leave without one is refused with 409: `LAST_ACTIVE_OWNER` when the
 * member being changed is an Owner (the rule the organization always had),
 * `LAST_ADMIN` otherwise. Every change of a member's role, status or
 * restriction and of a role's permissions calls this inside its transaction,
 * after taking the organization's lock, so two simultaneous changes cannot
 * each leave the other as "the remaining admin".
 *
 * Only an unrestricted, active Owner or custom-role member can be one: the
 * built-in Field Manager and Worker roles never hold these permissions, and
 * a member restricted to some projects never has them.
 */

/** Waits for any other change of this organization's administrators (held until the transaction ends). */
export async function lockAdmins(tx: Tx, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`admins:${organizationId}`}, 0))`;
}

/** How many active members can manage roles and settings, leaving out one member and/or pretending one role has other permissions. */
export async function countAdmins(
  tx: Tx,
  organizationId: string,
  options: { excludeMembershipId?: string; roleOverride?: { roleId: string; permissions: readonly string[] } } = {},
): Promise<number> {
  const candidates = await tx.organizationMembership.findMany({
    where: {
      organizationId,
      status: AccountStatus.ACTIVE,
      archivedAt: null,
      restrictedToScope: false,
      user: { status: AccountStatus.ACTIVE },
      role: { in: [OrgRole.OWNER, OrgRole.CUSTOM] },
      ...(options.excludeMembershipId ? { id: { not: options.excludeMembershipId } } : {}),
    },
    select: { role: true, roleId: true, roleRecord: { select: { id: true, name: true, systemKey: true, permissions: true } } },
  });
  return candidates.filter((member) => {
    const override = options.roleOverride && member.roleId === options.roleOverride.roleId ? options.roleOverride : null;
    const permissions = override ? new Set(override.permissions.filter(isPermission)) : permissionsOfRole(member.role as OrgRole, member.roleRecord);
    return holdsAdminPermissions(permissions);
  }).length;
}

/** The error the rule answers with: the Owner rule's own code when an Owner is the one leaving. */
export function lastAdminError(leavingRole: OrgRole): AppException {
  return leavingRole === OrgRole.OWNER
    ? new AppException(409, ErrorCodes.LAST_ACTIVE_OWNER, "The organization must keep at least one active Owner.")
    : new AppException(409, ErrorCodes.LAST_ADMIN, "The organization must keep at least one active member who can manage roles and settings.");
}
