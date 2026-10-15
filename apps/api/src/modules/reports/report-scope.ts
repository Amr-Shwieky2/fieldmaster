import type { Prisma } from "@prisma/client";
import type { MemberScope } from "../../common/auth/auth-context";
import { shiftScopeWhere } from "../../common/scope/scope-filters";
import type { ReportFilters } from "./report.types";

/** The scope a report was requested under: not restricted, or the projects and sites of a restricted requester. */
export function reportScope(filters: ReportFilters): MemberScope {
  if (!filters.scope) return { restricted: false };
  // `visibleProjectIds` is only used to list projects; a report reaches shifts through projectIds / siteIds.
  return { restricted: true, projectIds: filters.scope.projectIds, siteIds: filters.scope.siteIds, visibleProjectIds: filters.scope.projectIds };
}

/** The shift filter of the report's scope, or undefined when everyone's shifts are in. */
export function reportShiftScope(filters: ReportFilters): Prisma.ShiftWhereInput | undefined {
  return shiftScopeWhere(reportScope(filters));
}
