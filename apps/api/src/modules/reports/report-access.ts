import type { Prisma } from "@prisma/client";
import { OrgRole, ReportType } from "@fieldmaster/shared-types";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { ReportFilters } from "./report.types";

export interface ReportActor {
  sub: string;
  role: OrgRole;
  workerProfileId: string | null;
}

function forbidden(message: string): AppException {
  return new AppException(403, ErrorCodes.FORBIDDEN, message);
}

/**
 * Who may generate which report, and which version they get (spec 6.2 /
 * 23.5: money only for Owners and for a worker's own pay):
 * - the attendance ledger: an Owner (financial), a Field Manager
 *   (operational), any member for their own worker profile (financial);
 * - operational attendance and site violations: Owners and Field Managers,
 *   never with money;
 * - overtime, emergency call-outs, forgotten stamps: Owners (financial) and
 *   Field Managers (operational);
 * - payroll: Owners only.
 * Everyone else is refused (403).
 */
export function decideReportAccess(type: ReportType, actor: ReportActor, filters: ReportFilters): { includesFinancials: boolean } {
  const isOwner = actor.role === OrgRole.OWNER;
  const isManager = actor.role === OrgRole.FIELD_MANAGER;
  switch (type) {
    case ReportType.WORKER_ATTENDANCE_LEDGER: {
      const isSelf = actor.workerProfileId !== null && actor.workerProfileId === filters.workerProfileId;
      if (isOwner || isSelf) return { includesFinancials: true };
      if (isManager) return { includesFinancials: false };
      throw forbidden("You can only generate your own attendance ledger.");
    }
    case ReportType.OPERATIONAL_ATTENDANCE:
    case ReportType.SITE_VIOLATIONS:
      if (isOwner || isManager) return { includesFinancials: false };
      throw forbidden("Only Owners and Field Managers can generate this report.");
    case ReportType.OVERTIME:
    case ReportType.EMERGENCY_CALLOUTS:
    case ReportType.FORGOTTEN_STAMPS:
      if (isOwner) return { includesFinancials: true };
      if (isManager) return { includesFinancials: false };
      throw forbidden("Only Owners and Field Managers can generate this report.");
    case ReportType.PAYROLL:
      if (isOwner) return { includesFinancials: true };
      throw forbidden("Only an Owner can generate a payroll report.");
    default:
      throw forbidden("Unknown report type.");
  }
}

interface ReportOwnership {
  requestedByUserId: string;
  subjectWorkerProfileId: string | null;
  includesFinancials: boolean;
}

/**
 * Who may see a report (list, details, download, verify): an Owner, the
 * worker it is about, and whoever requested it. A requester who is neither
 * an Owner nor its subject never sees a financial report (someone who
 * generated one as an Owner and is a Field Manager now).
 */
export function canAccessReport(report: ReportOwnership, actor: ReportActor): boolean {
  if (actor.role === OrgRole.OWNER) return true;
  if (actor.workerProfileId !== null && report.subjectWorkerProfileId === actor.workerProfileId) return true;
  return report.requestedByUserId === actor.sub && !report.includesFinancials;
}

/** The same rule as a database filter (the list). */
export function reportVisibilityWhere(actor: ReportActor): Prisma.GeneratedReportWhereInput {
  if (actor.role === OrgRole.OWNER) return {};
  return {
    OR: [
      { requestedByUserId: actor.sub, includesFinancials: false },
      ...(actor.workerProfileId !== null ? [{ subjectWorkerProfileId: actor.workerProfileId }] : []),
    ],
  };
}
