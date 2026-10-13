import { OrgRole, ReportType } from "@fieldmaster/shared-types";
import { AppException } from "../../../common/errors/app-exception";
import { normalizeReportFilters } from "../report-filters";
import { canAccessReport, decideReportAccess, reportVisibilityWhere, type ReportActor } from "../report-access";

const WORKER_ID = "0192cccc-0000-7000-8000-000000000001";
const OTHER_WORKER_ID = "0192cccc-0000-7000-8000-000000000002";
const PROJECT_ID = "0192eeee-0000-7000-8000-000000000001";

function errorOf(run: () => unknown): { status: number; code: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof AppException) return { status: error.getStatus(), code: error.code };
    throw error;
  }
  throw new Error("expected an AppException");
}

describe("normalizeReportFilters", () => {
  const period = { fromDate: "2026-10-01", toDate: "2026-10-31" };

  it("keeps only the filters a type takes, ids in lower case", () => {
    expect(normalizeReportFilters(ReportType.OPERATIONAL_ATTENDANCE, { ...period, projectId: PROJECT_ID.toUpperCase() })).toEqual({
      ...period,
      projectId: PROJECT_ID,
    });
    expect(normalizeReportFilters(ReportType.WORKER_ATTENDANCE_LEDGER, { ...period, workerProfileId: WORKER_ID })).toEqual({
      ...period,
      workerProfileId: WORKER_ID,
    });
    expect(normalizeReportFilters(ReportType.PAYROLL, { yearMonth: "2026-10" })).toEqual({ yearMonth: "2026-10" });
    expect(normalizeReportFilters(ReportType.PAYROLL, { yearMonth: "2026-10", version: 2 })).toEqual({ yearMonth: "2026-10", version: 2 });
  });

  it("refuses a missing, malformed or not applicable filter with VALIDATION_FAILED", () => {
    const refused = { status: 400, code: "VALIDATION_FAILED" };
    expect(errorOf(() => normalizeReportFilters(ReportType.WORKER_ATTENDANCE_LEDGER, period))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.WORKER_ATTENDANCE_LEDGER, { ...period, workerProfileId: "not-a-uuid" }))).toEqual(refused);
    expect(
      errorOf(() => normalizeReportFilters(ReportType.WORKER_ATTENDANCE_LEDGER, { ...period, workerProfileId: WORKER_ID, projectId: PROJECT_ID })),
    ).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.OVERTIME, { fromDate: "2026-10-01" }))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.OVERTIME, {}))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.EMERGENCY_CALLOUTS, { ...period, siteId: PROJECT_ID }))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.PAYROLL, { ...period, yearMonth: "2026-10" }))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.PAYROLL, { yearMonth: "2026-13" }))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.PAYROLL, { yearMonth: "2026-10", version: 0 }))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.SITE_VIOLATIONS, { ...period, yearMonth: "2026-10" }))).toEqual(refused);
  });

  it("checks the period: real dates, in order, at most 366 days", () => {
    const refused = { status: 400, code: "VALIDATION_FAILED" };
    expect(errorOf(() => normalizeReportFilters(ReportType.SITE_VIOLATIONS, { fromDate: "2026-02-30", toDate: "2026-03-01" }))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.SITE_VIOLATIONS, { fromDate: "2026-10-31", toDate: "2026-10-01" }))).toEqual(refused);
    expect(errorOf(() => normalizeReportFilters(ReportType.SITE_VIOLATIONS, { fromDate: "2025-01-01", toDate: "2026-01-02" }))).toEqual(refused);
    expect(normalizeReportFilters(ReportType.SITE_VIOLATIONS, { fromDate: "2024-01-01", toDate: "2024-12-31" })).toEqual({
      fromDate: "2024-01-01",
      toDate: "2024-12-31",
    });
    expect(normalizeReportFilters(ReportType.SITE_VIOLATIONS, { fromDate: "2026-10-13", toDate: "2026-10-13" })).toEqual({
      fromDate: "2026-10-13",
      toDate: "2026-10-13",
    });
  });

  it("forgotten stamps take either a period or a month, not both", () => {
    expect(normalizeReportFilters(ReportType.FORGOTTEN_STAMPS, { yearMonth: "2026-10" })).toEqual({ yearMonth: "2026-10" });
    expect(normalizeReportFilters(ReportType.FORGOTTEN_STAMPS, period)).toEqual(period);
    expect(errorOf(() => normalizeReportFilters(ReportType.FORGOTTEN_STAMPS, { ...period, yearMonth: "2026-10" }))).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
    });
    expect(errorOf(() => normalizeReportFilters(ReportType.FORGOTTEN_STAMPS, {}))).toEqual({ status: 400, code: "VALIDATION_FAILED" });
  });
});

describe("report access", () => {
  const owner: ReportActor = { sub: "owner", role: OrgRole.OWNER, workerProfileId: null };
  const manager: ReportActor = { sub: "manager", role: OrgRole.FIELD_MANAGER, workerProfileId: null };
  const trackedManager: ReportActor = { sub: "tracked-manager", role: OrgRole.FIELD_MANAGER, workerProfileId: OTHER_WORKER_ID };
  const worker: ReportActor = { sub: "worker", role: OrgRole.WORKER, workerProfileId: WORKER_ID };
  const forWorker = { workerProfileId: WORKER_ID };

  it("decides who generates which version: Owner financial, Field Manager operational, a worker their own ledger only", () => {
    const access = (type: ReportType, actor: ReportActor, filters = {}) => {
      try {
        return decideReportAccess(type, actor, filters).includesFinancials ? "financial" : "operational";
      } catch (error) {
        return error instanceof AppException ? error.getStatus() : "error";
      }
    };
    expect(access(ReportType.WORKER_ATTENDANCE_LEDGER, owner, forWorker)).toBe("financial");
    expect(access(ReportType.WORKER_ATTENDANCE_LEDGER, manager, forWorker)).toBe("operational");
    expect(access(ReportType.WORKER_ATTENDANCE_LEDGER, worker, forWorker)).toBe("financial");
    expect(access(ReportType.WORKER_ATTENDANCE_LEDGER, worker, { workerProfileId: OTHER_WORKER_ID })).toBe(403);
    expect(access(ReportType.WORKER_ATTENDANCE_LEDGER, trackedManager, { workerProfileId: OTHER_WORKER_ID })).toBe("financial");

    for (const type of [ReportType.OPERATIONAL_ATTENDANCE, ReportType.SITE_VIOLATIONS]) {
      expect([access(type, owner), access(type, manager), access(type, worker)]).toEqual(["operational", "operational", 403]);
    }
    for (const type of [ReportType.OVERTIME, ReportType.EMERGENCY_CALLOUTS, ReportType.FORGOTTEN_STAMPS]) {
      expect([access(type, owner), access(type, manager), access(type, worker)]).toEqual(["financial", "operational", 403]);
    }
    expect([access(ReportType.PAYROLL, owner), access(ReportType.PAYROLL, manager), access(ReportType.PAYROLL, worker)]).toEqual(["financial", 403, 403]);
  });

  it("shows a report to an Owner, its subject and its requester -- a financial one never to a requester who is neither", () => {
    const operational = { requestedByUserId: "manager", subjectWorkerProfileId: WORKER_ID, includesFinancials: false };
    const financial = { requestedByUserId: "manager", subjectWorkerProfileId: null, includesFinancials: true };
    expect(canAccessReport(operational, owner)).toBe(true);
    expect(canAccessReport(operational, manager)).toBe(true);
    expect(canAccessReport(operational, worker)).toBe(true);
    expect(canAccessReport(operational, trackedManager)).toBe(false);
    expect(canAccessReport(financial, owner)).toBe(true);
    expect(canAccessReport(financial, manager)).toBe(false);
    expect(canAccessReport({ ...financial, subjectWorkerProfileId: WORKER_ID }, worker)).toBe(true);

    expect(reportVisibilityWhere(owner)).toEqual({});
    expect(reportVisibilityWhere(worker)).toEqual({
      OR: [{ requestedByUserId: "worker", includesFinancials: false }, { subjectWorkerProfileId: WORKER_ID }],
    });
    expect(reportVisibilityWhere(manager)).toEqual({ OR: [{ requestedByUserId: "manager", includesFinancials: false }] });
  });
});
