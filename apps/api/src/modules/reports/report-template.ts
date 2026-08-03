export interface ReportShiftRow {
  businessDate: string;
  shiftTitle: string;
  projectName: string | null;
  siteName: string | null;
  checkInMethod: string;
  rawClockIn: string | null;
  validatedClockIn: string | null;
  rawClockOut: string | null;
  validatedClockOut: string | null;
  clockInGps: string | null;
  clockOutGps: string | null;
  locationValidationStatus: string | null;
  isEmergency: boolean;
  emergencyBreakdown: string | null;
  status: string;
  fullDayCredit: boolean;
  corrections: { field: string; reason: string; note: string | null; editedBy: string; editedAt: string }[];
  summaryText: string | null;
  approvals: { action: string; actedBy: string; actedAt: string }[];
  forgottenStamp: { sequence: number; deductionAgorot: number } | null;
  financials: { regularMinutes: number; overtimeMinutes: number; totalAgorot: number } | null;
}

export interface ReportData {
  reportId: string;
  organizationName: string;
  workerName: string;
  workerId: string;
  periodLabel: string;
  generatedAt: string;
  generatedByName: string;
  includesFinancials: boolean;
  dataHash: string;
  rows: ReportShiftRow[];
  totalNetAgorot: number | null;
}

function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatAgorot(agorot: number): string {
  return `₪${(agorot / 100).toFixed(2)}`;
}

export function renderWorkerAttendanceLedgerHtml(data: ReportData): string {
  const rowsHtml = data.rows
    .map(
      (row) => `
    <section class="shift">
      <h3>${esc(row.businessDate)} — ${esc(row.shiftTitle)} ${row.isEmergency ? '<span class="badge">EMERGENCY</span>' : ""}</h3>
      <table class="kv">
        <tr><td>Project / Site</td><td>${esc(row.projectName)} / ${esc(row.siteName)}</td></tr>
        <tr><td>Check-in method</td><td>${esc(row.checkInMethod)}</td></tr>
        <tr><td>Status</td><td>${esc(row.status)}${row.fullDayCredit ? " (Full-Day Credit applied)" : ""}</td></tr>
        <tr><td>Raw clock-in (device)</td><td>${esc(row.rawClockIn)}</td></tr>
        <tr><td>Validated clock-in (server)</td><td>${esc(row.validatedClockIn)}</td></tr>
        <tr><td>Raw clock-out (device)</td><td>${esc(row.rawClockOut)}</td></tr>
        <tr><td>Validated clock-out (server)</td><td>${esc(row.validatedClockOut)}</td></tr>
        <tr><td>GPS at clock-in</td><td>${esc(row.clockInGps)}</td></tr>
        <tr><td>GPS at clock-out</td><td>${esc(row.clockOutGps)}</td></tr>
        <tr><td>Geofence / location validation</td><td>${esc(row.locationValidationStatus)}</td></tr>
        ${row.emergencyBreakdown ? `<tr><td>Emergency compensation</td><td>${esc(row.emergencyBreakdown)}</td></tr>` : ""}
      </table>
      ${row.summaryText ? `<p class="summary"><strong>Daily summary:</strong> ${esc(row.summaryText)}</p>` : ""}
      ${
        row.corrections.length > 0
          ? `<table class="sub"><thead><tr><th>Field</th><th>Reason</th><th>Note</th><th>Edited by</th><th>When</th></tr></thead><tbody>
          ${row.corrections.map((c) => `<tr><td>${esc(c.field)}</td><td>${esc(c.reason)}</td><td>${esc(c.note)}</td><td>${esc(c.editedBy)}</td><td>${esc(c.editedAt)}</td></tr>`).join("")}
        </tbody></table>`
          : ""
      }
      ${
        row.approvals.length > 0
          ? `<p class="approvals">${row.approvals.map((a) => `${esc(a.action)} by ${esc(a.actedBy)} at ${esc(a.actedAt)}`).join(" · ")}</p>`
          : ""
      }
      ${
        row.forgottenStamp
          ? `<p class="flag">Forgotten-stamp infraction #${row.forgottenStamp.sequence} this month${
              data.includesFinancials ? ` — deduction ${formatAgorot(row.forgottenStamp.deductionAgorot)}` : ""
            }</p>`
          : ""
      }
      ${
        data.includesFinancials && row.financials
          ? `<table class="kv"><tr><td>Regular / Overtime minutes</td><td>${row.financials.regularMinutes} / ${row.financials.overtimeMinutes}</td></tr><tr><td>Compensation</td><td>${formatAgorot(row.financials.totalAgorot)}</td></tr></table>`
          : ""
      }
    </section>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Worker Attendance Ledger</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 11px; color: #1e293b; margin: 0; padding: 24px 32px; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  h2 { font-size: 13px; color: #475569; font-weight: 500; margin-top: 0; }
  h3 { font-size: 12px; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; }
  .header { border-bottom: 2px solid #1e293b; padding-bottom: 8px; margin-bottom: 12px; }
  .meta { color: #64748b; font-size: 10px; }
  .shift { margin-bottom: 16px; page-break-inside: avoid; }
  table.kv { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.kv td { padding: 2px 6px; border-bottom: 1px solid #f1f5f9; }
  table.kv td:first-child { color: #64748b; width: 220px; }
  table.sub { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 10px; }
  table.sub th, table.sub td { border: 1px solid #e2e8f0; padding: 3px 6px; text-align: left; }
  .badge { background: #fee2e2; color: #991b1b; font-size: 9px; padding: 1px 6px; border-radius: 8px; }
  .flag { color: #b45309; font-weight: 600; }
  .summary { margin: 4px 0; }
  .approvals { color: #475569; font-style: italic; }
  .footer { margin-top: 24px; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 9px; color: #64748b; }
  .total { font-size: 13px; font-weight: 700; margin-top: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>Worker Attendance Ledger</h1>
    <h2>${esc(data.organizationName)}</h2>
    <div class="meta">
      Worker: <strong>${esc(data.workerName)}</strong> (${esc(data.workerId)})<br/>
      Period: ${esc(data.periodLabel)}<br/>
      Generated: ${esc(data.generatedAt)} by ${esc(data.generatedByName)}
    </div>
  </div>

  ${rowsHtml || "<p>No shifts found in this period.</p>"}

  ${data.includesFinancials && data.totalNetAgorot !== null ? `<p class="total">Total compensation for period: ${formatAgorot(data.totalNetAgorot)}</p>` : ""}

  <div class="footer">
    Report ID: ${esc(data.reportId)}<br/>
    Data hash (SHA-256, computed over the report's source data before rendering): ${esc(data.dataHash)}
  </div>
</body>
</html>`;
}
