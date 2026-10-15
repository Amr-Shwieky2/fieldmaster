import { OrgRole, Permission, ReportType } from "@fieldmaster/shared-types";
import { canAccessReport, decideReportAccess, reportVisibilityWhere, type ReportActor } from "../report-access";

/** Who may generate which report is decided by permissions (flexible organization model), not by a role's name. */

const WORKER_ID = "11111111-1111-4111-8111-111111111111";

function member(permissions: Permission[], extra: Partial<ReportActor> = {}): ReportActor {
  return { sub: "member", role: OrgRole.CUSTOM, workerProfileId: null, permissions: new Set(permissions), ...extra };
}

describe("report access by permission", () => {
  const filters = { workerProfileId: WORKER_ID };

  it("the financial copy needs GENERATE_FINANCIAL_REPORTS together with VIEW_FINANCIALS; the operational copy GENERATE_OPERATIONAL_REPORTS", () => {
    const accountant = member([Permission.VIEW_FINANCIALS, Permission.GENERATE_OPERATIONAL_REPORTS, Permission.GENERATE_FINANCIAL_REPORTS, Permission.VIEW_PAYROLL]);
    const operations = member([Permission.GENERATE_OPERATIONAL_REPORTS]);
    const nobody = member([Permission.VIEW_SHIFTS]);

    for (const type of [ReportType.OVERTIME, ReportType.FORGOTTEN_STAMPS, ReportType.EMERGENCY_CALLOUTS, ReportType.WORKER_ATTENDANCE_LEDGER]) {
      expect({ type, access: decideReportAccess(type, accountant, filters) }).toEqual({ type, access: { includesFinancials: true } });
      expect({ type, access: decideReportAccess(type, operations, filters) }).toEqual({ type, access: { includesFinancials: false } });
      expect(() => decideReportAccess(type, nobody, filters)).toThrow();
    }
    for (const type of [ReportType.OPERATIONAL_ATTENDANCE, ReportType.SITE_VIOLATIONS]) {
      expect(decideReportAccess(type, accountant, filters)).toEqual({ includesFinancials: false });
      expect(decideReportAccess(type, operations, filters)).toEqual({ includesFinancials: false });
      expect(() => decideReportAccess(type, nobody, filters)).toThrow();
    }
    expect(decideReportAccess(ReportType.PAYROLL, accountant, { yearMonth: "2026-10" })).toEqual({ includesFinancials: true });
    expect(() => decideReportAccess(ReportType.PAYROLL, operations, { yearMonth: "2026-10" })).toThrow();
  });

  it("the money permission alone is not enough for a financial copy (it needs the report permission too)", () => {
    const onlyMoney = member([Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL]);
    expect(() => decideReportAccess(ReportType.PAYROLL, onlyMoney, { yearMonth: "2026-10" })).toThrow();
    const reportsWithoutMoney = member([Permission.GENERATE_OPERATIONAL_REPORTS, Permission.GENERATE_FINANCIAL_REPORTS]);
    expect(decideReportAccess(ReportType.OVERTIME, reportsWithoutMoney, filters)).toEqual({ includesFinancials: false });
  });

  it("anyone may generate their own ledger, with their own pay; a member restricted to some projects may not generate the organization-wide reports", () => {
    const worker = member([Permission.CLOCK_IN_OUT], { workerProfileId: WORKER_ID });
    expect(decideReportAccess(ReportType.WORKER_ATTENDANCE_LEDGER, worker, filters)).toEqual({ includesFinancials: true });
    expect(() => decideReportAccess(ReportType.WORKER_ATTENDANCE_LEDGER, worker, { workerProfileId: "other" })).toThrow();

    const restricted = member([Permission.VIEW_FINANCIALS, Permission.GENERATE_OPERATIONAL_REPORTS, Permission.GENERATE_FINANCIAL_REPORTS, Permission.VIEW_PAYROLL], {
      scope: { restricted: true, projectIds: ["p"], siteIds: ["s"], visibleProjectIds: ["p"] },
    });
    expect(() => decideReportAccess(ReportType.PAYROLL, restricted, { yearMonth: "2026-10" })).toThrow(/whole organization/);
    expect(() => decideReportAccess(ReportType.EMERGENCY_CALLOUTS, restricted, filters)).toThrow(/whole organization/);
    expect(decideReportAccess(ReportType.OVERTIME, restricted, filters)).toEqual({ includesFinancials: true });
  });

  it("who sees a generated report: whoever may generate the financial ones (not when restricted), its subject, and its requester unless it is financial", () => {
    const accountant = member([Permission.VIEW_FINANCIALS, Permission.GENERATE_FINANCIAL_REPORTS, Permission.GENERATE_OPERATIONAL_REPORTS]);
    const requester = member([Permission.GENERATE_OPERATIONAL_REPORTS], { sub: "requester" });
    const restricted = member([Permission.GENERATE_FINANCIAL_REPORTS, Permission.VIEW_FINANCIALS], { scope: { restricted: true, projectIds: [], siteIds: [], visibleProjectIds: [] } });
    const report = { requestedByUserId: "requester", subjectWorkerProfileId: WORKER_ID, includesFinancials: false };
    const financial = { ...report, includesFinancials: true };

    expect(canAccessReport(report, accountant) && canAccessReport(financial, accountant)).toBe(true);
    expect(canAccessReport(report, requester)).toBe(true);
    expect(canAccessReport(financial, requester)).toBe(false);
    expect(canAccessReport(report, restricted)).toBe(false);
    expect(reportVisibilityWhere(accountant)).toEqual({});
    expect(reportVisibilityWhere(requester)).toEqual({ OR: [{ requestedByUserId: "requester", includesFinancials: false }] });
  });
});
