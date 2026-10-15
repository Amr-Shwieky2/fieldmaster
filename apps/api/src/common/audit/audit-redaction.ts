import { Permission } from "@fieldmaster/shared-types";
import { hasPermission, type PermissionHolder } from "../auth/permissions";

/**
 * Audit rows whose old / new value is an amount of money: a forgotten-stamp
 * deduction, a manual payroll adjustment, a change of the penalty rule. A
 * member who may read the audit log but not see financials gets those rows
 * with the values left out (the row, who did it and why stay).
 */
const FINANCIAL_AUDIT_ACTIONS = new Set(["FORGOTTEN_STAMP_INFRACTION_RECORDED", "PAYROLL_ADJUSTMENT_CREATED"]);

export function isFinancialAuditRow(row: { action: string; field?: string | null }): boolean {
  return FINANCIAL_AUDIT_ACTIONS.has(row.action) || /agorot/i.test(row.field ?? "");
}

export function redactAuditRow<T extends { action: string; field?: string | null; oldValue?: string | null; newValue?: string | null }>(row: T, viewer: PermissionHolder): T & { redacted?: true } {
  if (hasPermission(viewer, Permission.VIEW_FINANCIALS) || !isFinancialAuditRow(row)) return row;
  return { ...row, oldValue: null, newValue: null, redacted: true };
}
