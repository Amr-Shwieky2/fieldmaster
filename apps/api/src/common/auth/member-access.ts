import type { Prisma } from "@prisma/client";
import { OrgRole, Permission, SYSTEM_ROLE_PERMISSIONS, isPermission, permissionsForScope } from "@fieldmaster/shared-types";
import type { PrismaService } from "../prisma/prisma.service";
import type { MemberScope } from "./auth-context";

type Db = Pick<PrismaService, "site"> | Pick<Prisma.TransactionClient, "site">;

/** What the guard (and the real-time channels) read of a membership to know what the member may do. */
export interface MembershipAccessRow {
  role: OrgRole;
  roleRecord: { id: string; name: string; systemKey: string | null; permissions: string[] } | null;
  restrictedToScope: boolean;
  scopes: { projectId: string | null; siteId: string | null }[];
}

/** The Prisma `include` that loads a membership with everything `resolveMemberAccess` needs. */
export const MEMBERSHIP_ACCESS_INCLUDE = {
  roleRecord: { select: { id: true, name: true, systemKey: true, permissions: true } },
  scopes: { select: { projectId: true, siteId: true } },
} as const;

/** A role's own permission set: a built-in role's from the code, a custom role's from its record (unknown names ignored). */
export function permissionsOfRole(role: OrgRole, record: MembershipAccessRow["roleRecord"]): Set<Permission> {
  if (role === OrgRole.CUSTOM) return new Set((record?.permissions ?? []).filter(isPermission));
  return new Set(SYSTEM_ROLE_PERMISSIONS[role]);
}

/** The member's effective permissions: their role's, minus the organization-wide ones when they are restricted to some projects. */
export function effectivePermissionsOf(row: Pick<MembershipAccessRow, "role" | "roleRecord" | "restrictedToScope">): Set<Permission> {
  return new Set(permissionsForScope(permissionsOfRole(row.role, row.roleRecord), row.restrictedToScope));
}

/** The projects and sites a restricted member may work with (one query); no query at all for an unrestricted one. */
export async function resolveMemberScope(db: Db, organizationId: string, row: Pick<MembershipAccessRow, "restrictedToScope" | "scopes">): Promise<MemberScope> {
  if (!row.restrictedToScope) return { restricted: false };
  const projectIds = row.scopes.flatMap((scope) => (scope.projectId ? [scope.projectId] : []));
  const explicitSiteIds = row.scopes.flatMap((scope) => (scope.siteId ? [scope.siteId] : []));
  const sites =
    projectIds.length === 0 && explicitSiteIds.length === 0
      ? []
      : await db.site.findMany({
          where: { organizationId, OR: [{ projectId: { in: projectIds } }, { id: { in: explicitSiteIds } }] },
          select: { id: true, projectId: true },
        });
  const explicit = new Set(explicitSiteIds);
  const visibleProjectIds = new Set(projectIds);
  for (const site of sites) if (explicit.has(site.id)) visibleProjectIds.add(site.projectId);
  return { restricted: true, projectIds, siteIds: sites.map((site) => site.id), visibleProjectIds: [...visibleProjectIds] };
}
