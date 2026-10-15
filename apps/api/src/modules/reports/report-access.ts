import type { Prisma } from "@prisma/client";
import { Permission, ReportType, type OrgRole } from "@fieldmaster/shared-types";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { hasPermission } from "../../common/auth/permissions";
import type { MemberScope } from "../../common/auth/auth-context";
import type { ReportFilters } from "./report.types";

export interface ReportActor {
  sub: string;
  role: OrgRole;
  workerProfileId: string | null;
  /** The effective permissions the guard resolved; absent: the built-in role's. */
  permissions?: ReadonlySet<Permission>;
  scope?: MemberScope;
}

function forbidden(message: string): AppException {
  return new AppException(403, ErrorCodes.FORBIDDEN, message);
}

/**
 * Who may generate which report, and which version they get (spec 6.2 /
 * 23.5: money only for those who may see financials, and for a worker's own
 * pay). By permission, not by role name (the built-in roles hold exactly
 * what they always needed):
 * - the attendance ledger: the financial copy for GENERATE_FINANCIAL_REPORTS
 *   (which needs VIEW_FINANCIALS), the operational copy for
 *   GENERATE_OPERATIONAL_REPORTS, and for any member their own ledger
 *   (financial: their own pay);
 * - operational attendance and site violations: GENERATE_OPERATIONAL_REPORTS,
 *   never with money for anyone;
 * - overtime, emergency call-outs, forgotten stamps: the financial copy for
 *   GENERATE_FINANCIAL_REPORTS, otherwise the operational copy;
 * - payroll: GENERATE_FINANCIAL_REPORTS with VIEW_PAYROLL.
 * A member restricted to some projects is refused the reports that cover the
 * whole organization (emergency call-outs, payroll); the others only ever
 * contain their projects. Everyone else is refused (403).
 */
export function decideReportAccess(type: ReportType, actor: ReportActor, filters: ReportFilters): { includesFinancials: boolean } {
  const financial = hasPermission(actor, Permission.GENERATE_FINANCIAL_REPORTS) && hasPermission(actor, Permission.VIEW_FINANCIALS);
  const operational = hasPermission(actor, Permission.GENERATE_OPERATIONAL_REPORTS);
  const restricted = actor.scope?.restricted === true;
  switch (type) {
    case ReportType.WORKER_ATTENDANCE_LEDGER: {
      const isSelf = actor.workerProfileId !== null && actor.workerProfileId === filters.workerProfileId;
      if (financial || isSelf) return { includesFinancials: true };
      if (operational) return { includesFinancials: false };
      throw forbidden("You can only generate your own attendance ledger.");
    }
    case ReportType.OPERATIONAL_ATTENDANCE:
    case ReportType.SITE_VIOLATIONS:
      if (operational) return { includesFinancials: false };
      throw forbidden("You may not generate this report.");
    case ReportType.OVERTIME:
    case ReportType.FORGOTTEN_STAMPS:
      if (financial) return { includesFinancials: true };
      if (operational) return { includesFinancials: false };
      throw forbidden("You may not generate this report.");
    case ReportType.EMERGENCY_CALLOUTS:
      if (restricted) throw new AppException(403, ErrorCodes.SCOPE_RESTRICTED, "Emergency call-outs belong to the whole organization.");
      if (financial) return { includesFinancials: true };
      if (operational) return { includesFinancials: false };
      throw forbidden("You may not generate this report.");
    case ReportType.PAYROLL:
      if (restricted) throw new AppException(403, ErrorCodes.SCOPE_RESTRICTED, "A payroll report covers the whole organization.");
      if (financial && hasPermission(actor, Permission.VIEW_PAYROLL)) return { includesFinancials: true };
      throw forbidden("You may not generate a payroll report.");
    default:
      throw forbidden("Unknown report type.");
  }
}

interface ReportOwnership {
  requestedByUserId: string;
  subjectWorkerProfileId: string | null;
  includesFinancials: boolean;
}

/** Sees every report of the organization: whoever may generate the financial ones (a member restricted to some projects only sees their own). */
function seesAllReports(actor: ReportActor): boolean {
  return hasPermission(actor, Permission.GENERATE_FINANCIAL_REPORTS) && actor.scope?.restricted !== true;
}

/**
 * Who may see a report (list, details, download, verify): whoever may
 * generate the financial reports, the worker it is about, and whoever
 * requested it. A requester without the financial permission never sees a
 * financial report (someone who generated one as an Owner and is a Field
 * Manager now).
 */
export function canAccessReport(report: ReportOwnership, actor: ReportActor): boolean {
  if (seesAllReports(actor)) return true;
  if (actor.workerProfileId !== null && report.subjectWorkerProfileId === actor.workerProfileId) return true;
  return report.requestedByUserId === actor.sub && !report.includesFinancials;
}

/** The same rule as a database filter (the list). */
export function reportVisibilityWhere(actor: ReportActor): Prisma.GeneratedReportWhereInput {
  if (seesAllReports(actor)) return {};
  return {
    OR: [
      { requestedByUserId: actor.sub, includesFinancials: false },
      ...(actor.workerProfileId !== null ? [{ subjectWorkerProfileId: actor.workerProfileId }] : []),
    ],
  };
}
