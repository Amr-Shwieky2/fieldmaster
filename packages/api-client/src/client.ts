import type {
  ApiError,
  AuditLogEntry,
  AuthSession,
  FinancialDashboard,
  Geofence,
  GeneratedReport,
  NotificationItem,
  OfflineSyncBatchRecord,
  OfflineSyncBatchResponse,
  PayrollPeriod,
  Project,
  Shift,
  Site,
  TimeEntry,
  TuranAssignment,
  Worker,
} from "./types";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.message);
  }
}

/**
 * Thrown when `fetch` itself fails (no connectivity, DNS failure, request
 * timeout) as opposed to `ApiRequestError`, which means the server was
 * reached and returned an error response. Mobile screens use this
 * distinction to decide whether to fall back to the offline queue (spec
 * section 20) instead of showing the user a hard failure.
 */
export class NetworkError extends Error {
  constructor(public readonly cause: unknown) {
    super("Network request failed. Check your connection.");
  }
}

export interface FieldMasterClientOptions {
  baseUrl: string;
  getAccessToken: () => string | null;
  onUnauthorized?: () => void;
}

/**
 * Thin typed fetch wrapper over the FieldMaster REST API. Deliberately not
 * a generated client -- there's no OpenAPI codegen step in this slice, just
 * a hand-written surface covering what apps/admin-web actually calls.
 */
export class FieldMasterClient {
  constructor(private readonly options: FieldMasterClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const token = this.options.getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new NetworkError(err);
    }

    if (response.status === 401) {
      this.options.onUnauthorized?.();
    }

    if (response.status === 204) return undefined as T;

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiRequestError(response.status, json as ApiError);
    }
    return json as T;
  }

  // ── Auth ────────────────────────────────────────────────────────────
  requestOtp(phoneNumber: string) {
    return this.request<void>("POST", "/auth/otp/request", { phoneNumber });
  }

  verifyOtp(input: { phoneNumber: string; code: string; deviceId: string; platform: "WEB" | "IOS" | "ANDROID"; organizationId?: string }) {
    return this.request<AuthSession>("POST", "/auth/otp/verify", input);
  }

  // ── Workers ─────────────────────────────────────────────────────────
  listWorkers() {
    return this.request<Worker[]>("GET", "/workers");
  }
  getWorker(id: string) {
    return this.request<Worker>("GET", `/workers/${id}`);
  }
  listPendingApproval() {
    return this.request<{ membershipId: string; workerProfileId: string; fullLegalName: string; phoneNumber: string; submittedAt: string }[]>(
      "GET",
      "/workers/pending-approval",
    );
  }
  approveWorker(id: string, compensationProfile: Record<string, unknown>) {
    return this.request("POST", `/workers/${id}/approve`, { compensationProfile });
  }
  rejectWorker(id: string, reason: string) {
    return this.request("POST", `/workers/${id}/reject`, { reason });
  }

  // ── Sites / Projects ────────────────────────────────────────────────
  listProjects() {
    return this.request<Project[]>("GET", "/projects");
  }
  createProject(input: Record<string, unknown>) {
    return this.request<Project>("POST", "/projects", input);
  }
  listSites(projectId?: string) {
    return this.request<Site[]>("GET", `/sites${projectId ? `?projectId=${projectId}` : ""}`);
  }
  getSite(id: string) {
    return this.request<Site>("GET", `/sites/${id}`);
  }
  createSite(input: Record<string, unknown>) {
    return this.request<Site>("POST", "/sites", input);
  }
  createGeofence(input: Record<string, unknown>) {
    return this.request<Geofence>("POST", "/geofences", input);
  }
  listGeofencesForSite(siteId: string) {
    return this.request<Geofence[]>("GET", `/sites/${siteId}/geofences`);
  }

  // ── Shifts ──────────────────────────────────────────────────────────
  listShifts(filters?: { status?: string; businessDate?: string }) {
    const qs = new URLSearchParams(filters as Record<string, string>).toString();
    return this.request<Shift[]>("GET", `/shifts${qs ? `?${qs}` : ""}`);
  }
  getShift(id: string) {
    return this.request<Shift>("GET", `/shifts/${id}`);
  }
  createShift(input: Record<string, unknown>) {
    return this.request<Shift>("POST", "/shifts", input);
  }
  assignWorkerToShift(shiftId: string, workerProfileId: string) {
    return this.request("POST", `/shifts/${shiftId}/assignments`, { workerProfileId });
  }

  // ── Attendance ──────────────────────────────────────────────────────
  listPendingAttendanceApprovals() {
    return this.request<TimeEntry[]>("GET", "/attendance-approvals/pending");
  }
  approveTimeEntry(id: string, notes?: string) {
    return this.request<TimeEntry>("POST", `/time-entries/${id}/approve`, { notes });
  }
  rejectTimeEntry(id: string, reason: string) {
    return this.request<TimeEntry>("POST", `/time-entries/${id}/reject`, { reason });
  }
  applyFullDayCredit(id: string, reason: string) {
    return this.request<TimeEntry>("POST", `/time-entries/${id}/full-day-credit`, { reason });
  }
  listTimeEntries(filters?: { workerProfileId?: string; status?: string }) {
    const qs = new URLSearchParams(filters as Record<string, string>).toString();
    return this.request<TimeEntry[]>("GET", `/time-entries${qs ? `?${qs}` : ""}`);
  }

  // ── Clock events ────────────────────────────────────────────────────
  clockIn(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<TimeEntry>("POST", "/clock-events/clock-in", input, { "Idempotency-Key": idempotencyKey });
  }
  clockOut(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<TimeEntry>("POST", "/clock-events/clock-out", input, { "Idempotency-Key": idempotencyKey });
  }

  // ── Devices / offline sync ──────────────────────────────────────────
  registerDevicePublicKey(input: { deviceId: string; publicKey: string; algorithm?: string }) {
    return this.request<{ id: string; deviceId: string; algorithm: string; registeredAt: string }>("POST", "/devices/public-key", input);
  }
  submitOfflineSyncBatch(input: { deviceId: string; events: Record<string, unknown>[] }, idempotencyKey: string) {
    return this.request<OfflineSyncBatchResponse>("POST", "/offline-sync/batches", input, { "Idempotency-Key": idempotencyKey });
  }
  listOfflineSyncBatches() {
    return this.request<OfflineSyncBatchRecord[]>("GET", "/offline-sync/batches");
  }

  // ── Payroll ─────────────────────────────────────────────────────────
  listPayrollPeriods() {
    return this.request<PayrollPeriod[]>("GET", "/payroll-periods");
  }
  getPayrollPeriod(yearMonth: string) {
    return this.request<PayrollPeriod>("GET", `/payroll-periods/${yearMonth}`);
  }
  calculatePayroll(yearMonth: string, idempotencyKey: string) {
    return this.request<PayrollPeriod>("POST", `/payroll-periods/${yearMonth}/calculate`, undefined, { "Idempotency-Key": idempotencyKey });
  }
  finalizePayroll(yearMonth: string) {
    return this.request<PayrollPeriod>("POST", `/payroll-periods/${yearMonth}/finalize`);
  }
  reopenPayroll(yearMonth: string, reason: string) {
    return this.request<PayrollPeriod>("POST", `/payroll-periods/${yearMonth}/reopen`, { reason });
  }
  getFinancialDashboard(yearMonth: string) {
    return this.request<FinancialDashboard>("GET", `/payroll-periods/${yearMonth}/dashboard`);
  }

  // ── Notifications ───────────────────────────────────────────────────
  listNotifications() {
    return this.request<NotificationItem[]>("GET", "/notifications");
  }
  markNotificationRead(id: string) {
    return this.request("PATCH", `/notifications/${id}/read`);
  }

  // ── Turan / Emergency call-outs ─────────────────────────────────────
  listTuranAssignments(filters?: { turanType?: string; from?: string; to?: string }) {
    const qs = new URLSearchParams(filters as Record<string, string>).toString();
    return this.request<TuranAssignment[]>("GET", `/turan-assignments${qs ? `?${qs}` : ""}`);
  }
  createTuranAssignment(input: Record<string, unknown>) {
    return this.request<TuranAssignment>("POST", "/turan-assignments", input);
  }
  cancelTuranAssignment(id: string) {
    return this.request("POST", `/turan-assignments/${id}/cancel`);
  }

  // ── Audit logs ──────────────────────────────────────────────────────
  listAuditLogs(cursor?: string) {
    return this.request<{ items: AuditLogEntry[]; nextCursor: string | null }>("GET", `/audit-logs${cursor ? `?cursor=${cursor}` : ""}`);
  }
  verifyAuditChain() {
    return this.request<{ valid: boolean; brokenAtId?: string }>("GET", "/audit-logs/verify");
  }

  // ── Reports ─────────────────────────────────────────────────────────
  generateWorkerLedger(input: { workerProfileId: string; fromDate: string; toDate: string }, idempotencyKey: string) {
    return this.request<GeneratedReport & { downloadUrl: string }>("POST", "/reports/worker-attendance-ledger", input, {
      "Idempotency-Key": idempotencyKey,
    });
  }
  listReports() {
    return this.request<GeneratedReport[]>("GET", "/reports");
  }
  getReportDownloadUrl(id: string) {
    return this.request<{ downloadUrl: string; sha256Hash: string; generatedAt: string }>("GET", `/reports/${id}/download`);
  }
}
