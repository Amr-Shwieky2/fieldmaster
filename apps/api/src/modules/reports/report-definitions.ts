import { ReportType } from "@fieldmaster/shared-types";
import { loadLedgerFinancial, loadLedgerOperational } from "./data/ledger.data";
import { loadOperationalAttendance } from "./data/attendance.data";
import { loadOvertimeFinancial, loadOvertimeOperational } from "./data/overtime.data";
import { loadEmergencyFinancial, loadEmergencyOperational } from "./data/emergency-callouts.data";
import { loadSiteViolations } from "./data/site-violations.data";
import { loadForgottenStampsFinancial, loadForgottenStampsOperational } from "./data/forgotten-stamps.data";
import { loadPayroll } from "./data/payroll.data";
import { ledgerFinancialBody, ledgerFinancialCsv, ledgerOperationalBody, ledgerOperationalCsv } from "./templates/ledger.template";
import { attendanceBody, attendanceCsv } from "./templates/attendance.template";
import { overtimeFinancialBody, overtimeFinancialCsv, overtimeOperationalBody, overtimeOperationalCsv } from "./templates/overtime.template";
import { emergencyFinancialBody, emergencyFinancialCsv, emergencyOperationalBody, emergencyOperationalCsv } from "./templates/emergency-callouts.template";
import { siteViolationsBody, siteViolationsCsv } from "./templates/site-violations.template";
import {
  forgottenStampsFinancialBody,
  forgottenStampsFinancialCsv,
  forgottenStampsOperationalBody,
  forgottenStampsOperationalCsv,
} from "./templates/forgotten-stamps.template";
import { payrollBody, payrollCsv } from "./templates/payroll.template";
import type { ReportDefinition } from "./report.types";

/**
 * Each report type's two versions, wired from their own loader and
 * templates. A type without money for anyone (operational attendance, site
 * violations) has no financial version; payroll has no operational one.
 */
export interface ReportVersions {
  operational: ReportDefinition<unknown> | null;
  financial: ReportDefinition<unknown> | null;
}

function define<D>(definition: ReportDefinition<D>): ReportDefinition<unknown> {
  return definition as ReportDefinition<unknown>;
}

export const REPORT_DEFINITIONS: Record<ReportType, ReportVersions> = {
  [ReportType.WORKER_ATTENDANCE_LEDGER]: {
    operational: define({ orientation: "portrait", load: loadLedgerOperational, body: ledgerOperationalBody, csv: ledgerOperationalCsv }),
    financial: define({ orientation: "portrait", load: loadLedgerFinancial, body: ledgerFinancialBody, csv: ledgerFinancialCsv }),
  },
  [ReportType.OPERATIONAL_ATTENDANCE]: {
    operational: define({ orientation: "landscape", load: loadOperationalAttendance, body: attendanceBody, csv: attendanceCsv }),
    financial: null,
  },
  [ReportType.OVERTIME]: {
    operational: define({ orientation: "landscape", load: loadOvertimeOperational, body: overtimeOperationalBody, csv: overtimeOperationalCsv }),
    financial: define({ orientation: "landscape", load: loadOvertimeFinancial, body: overtimeFinancialBody, csv: overtimeFinancialCsv }),
  },
  [ReportType.EMERGENCY_CALLOUTS]: {
    operational: define({ orientation: "landscape", load: loadEmergencyOperational, body: emergencyOperationalBody, csv: emergencyOperationalCsv }),
    financial: define({ orientation: "landscape", load: loadEmergencyFinancial, body: emergencyFinancialBody, csv: emergencyFinancialCsv }),
  },
  [ReportType.SITE_VIOLATIONS]: {
    operational: define({ orientation: "landscape", load: loadSiteViolations, body: siteViolationsBody, csv: siteViolationsCsv }),
    financial: null,
  },
  [ReportType.FORGOTTEN_STAMPS]: {
    operational: define({
      orientation: "portrait",
      load: loadForgottenStampsOperational,
      body: forgottenStampsOperationalBody,
      csv: forgottenStampsOperationalCsv,
    }),
    financial: define({ orientation: "landscape", load: loadForgottenStampsFinancial, body: forgottenStampsFinancialBody, csv: forgottenStampsFinancialCsv }),
  },
  [ReportType.PAYROLL]: {
    operational: null,
    financial: define({ orientation: "landscape", load: loadPayroll, body: payrollBody, csv: payrollCsv }),
  },
};

/** The definition a report is generated with (its type, financial or not). */
export function reportDefinition(type: ReportType, includesFinancials: boolean): ReportDefinition<unknown> {
  const versions = REPORT_DEFINITIONS[type];
  const definition = versions ? (includesFinancials ? versions.financial : versions.operational) : null;
  if (!definition) throw new Error(`No ${includesFinancials ? "financial" : "operational"} template for ${type} reports.`);
  return definition;
}

/** "worker-attendance-ledger-ar-v1": the template set a report was rendered with (Arabic, version 1). */
export function templateVersionFor(type: ReportType): string {
  return `${type.toLowerCase().replace(/_/g, "-")}-ar-v1`;
}
