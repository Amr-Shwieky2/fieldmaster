import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser, MemberScope } from "../auth/auth-context";

/**
 * Prisma filters for a member restricted to some projects / sites. For a
 * member who is not restricted they are `undefined` (no filter), so
 * `where: { organizationId, ...scopeWhere }` is always safe to write.
 *
 * Everything an attendance record hangs from reaches a shift, and a shift
 * reaches a project and a site: a shift is in scope when its project was
 * selected whole, or its site is one of the visible sites.
 */

export const NO_SCOPE: MemberScope = { restricted: false };

export function scopeOf(user: Pick<AuthenticatedUser, "scope">): MemberScope {
  return user.scope ?? NO_SCOPE;
}

export function isRestricted(user: Pick<AuthenticatedUser, "scope">): boolean {
  return scopeOf(user).restricted;
}

/** A shift of a project selected whole, or at a visible site. */
export function shiftScopeWhere(scope: MemberScope): Prisma.ShiftWhereInput | undefined {
  if (!scope.restricted) return undefined;
  return { OR: [{ projectId: { in: scope.projectIds } }, { siteId: { in: scope.siteIds } }] };
}

/** A project the member can see (selected whole, or holding a site they selected). */
export function projectScopeWhere(scope: MemberScope): Prisma.ProjectWhereInput | undefined {
  if (!scope.restricted) return undefined;
  return { id: { in: scope.visibleProjectIds } };
}

export function siteScopeWhere(scope: MemberScope): Prisma.SiteWhereInput | undefined {
  if (!scope.restricted) return undefined;
  return { id: { in: scope.siteIds } };
}

/** A time entry of an in-scope shift. */
export function timeEntryScopeWhere(scope: MemberScope): Prisma.TimeEntryWhereInput | undefined {
  const shift = shiftScopeWhere(scope);
  return shift ? { shift } : undefined;
}

/**
 * A worker who has a shift assignment, or a time entry, on an in-scope
 * shift. (Applicants waiting for approval have neither, and an Owner-only
 * permission covers them.)
 */
export function workerScopeWhere(scope: MemberScope): Prisma.WorkerProfileWhereInput | undefined {
  const shift = shiftScopeWhere(scope);
  if (!shift) return undefined;
  return { OR: [{ shiftAssignments: { some: { removedAt: null, shift } } }, { timeEntries: { some: { shift } } }] };
}

/** Is this shift's project / site in scope? (For an object already loaded.) */
export function shiftInScope(scope: MemberScope, shift: { projectId: string | null; siteId: string | null }): boolean {
  if (!scope.restricted) return true;
  return (shift.projectId !== null && scope.projectIds.includes(shift.projectId)) || (shift.siteId !== null && scope.siteIds.includes(shift.siteId));
}

export function siteInScope(scope: MemberScope, siteId: string | null): boolean {
  return !scope.restricted || (siteId !== null && scope.siteIds.includes(siteId));
}

export function projectInScope(scope: MemberScope, projectId: string | null): boolean {
  return !scope.restricted || (projectId !== null && scope.visibleProjectIds.includes(projectId));
}
