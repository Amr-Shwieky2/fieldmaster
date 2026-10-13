import type {
  ApiError,
  AttendanceListFilters,
  AttendanceListResponse,
  AuditLogEntry,
  AuthSession,
  ClockInResult,
  DevLoginUser,
  EmergencyCalloutEndResult,
  EmergencyCalloutFilters,
  EmergencyCalloutRecord,
  EmergencyCalloutStartResult,
  EntryCostEstimate,
  FinancialDashboard,
  ForgottenStampInfraction,
  ManualCorrectionInput,
  Paginated,
  Geofence,
  CreatedInvitation,
  CreateReportInput,
  FileViewUrl,
  GeneratedReport,
  JoinApplicationInput,
  OnboardingInvitation,
  OnboardingReview,
  PublicInvitation,
  ReportDownload,
  ReportFileFormat,
  ReportVerification,
  UploadedFile,
  NotificationItem,
  OfflineSyncBatchRecord,
  OfflineSyncBatchResponse,
  CreatePayrollAdjustmentInput,
  MySalaryStatements,
  PayrollAdjustmentLine,
  PayrollCalculationRun,
  PayrollPeriodSummary,
  PayrollVersionDetail,
  PayrollVersionSummary,
  PayrollWorkerDetail,
  Project,
  Shift,
  Site,
  TemporaryCheckInPoint,
  TemporarySupervisorAssignment,
  TimeEntry,
  TimeEntryEvidence,
  TuranAssignment,
  Worker,
  WorkerMonthEarnings,
  WorkerSimulatorContext,
  Member,
  MemberDevice,
  MyTemporarySupervision,
  OperationsSnapshot,
  OrganizationSettingsView,
  SupervisedShift,
  TemporarySupervisorListItem,
  WorkdaySettings,
} from "./types";
import type { FileAssetPurpose, NotificationType, OrgRole } from "@fieldmaster/shared-types";

/** `?a=1&b=x,y` from the defined values (arrays joined with commas); "" when there are none. */
function queryString(params: Record<string, string | number | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

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

  /** Like `request`, for a multipart body (the browser sets the boundary). */
  private async requestForm<T>(path: string, form: FormData): Promise<T> {
    const token = this.options.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, { method: "POST", headers, body: form });
    } catch (err) {
      throw new NetworkError(err);
    }
    if (response.status === 401) this.options.onUnauthorized?.();
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiRequestError(response.status, json as ApiError);
    return json as T;
  }

  // ── Auth ────────────────────────────────────────────────────────────
  requestOtp(phoneNumber: string) {
    return this.request<void>("POST", "/auth/otp/request", { phoneNumber });
  }

  verifyOtp(input: { phoneNumber: string; code: string; deviceId: string; platform: "WEB" | "IOS" | "ANDROID"; organizationId?: string }) {
    return this.request<AuthSession>("POST", "/auth/otp/verify", input);
  }

  // ── Dev login (test mode only; the API answers 404 when it is off) ──
  /**
   * Active members available for one-click login. Resolves to null when the
   * API is not in dev login mode (404), so callers can simply hide the test
   * options.
   */
  async listDevLoginUsers(): Promise<DevLoginUser[] | null> {
    try {
      return await this.request<DevLoginUser[]>("GET", "/auth/dev/users");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return null;
      throw error;
    }
  }
  devLogin(input: { membershipId: string; deviceId?: string; platform?: "WEB" | "IOS" | "ANDROID" }) {
    return this.request<AuthSession>("POST", "/auth/dev/login", input);
  }
  /** Ends one session server-side (revokes its refresh-token family); other sessions are unaffected. */
  logout(refreshToken: string) {
    return this.request<void>("POST", "/auth/logout", { refreshToken });
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
  /** Owner only (audited): the application with its ID and bank details decrypted. */
  getOnboardingReview(workerProfileId: string) {
    return this.request<OnboardingReview>("GET", `/workers/${workerProfileId}/onboarding-review`);
  }
  /** Owner only (audited): a short-lived signed URL to an uploaded identity document or photo. */
  getFileAssetViewUrl(fileAssetId: string) {
    return this.request<FileViewUrl>("GET", `/file-assets/${fileAssetId}/view-url`);
  }

  // ── Onboarding invitations (Step 8) ─────────────────────────────────
  createInvitation(prefilledPhoneNumber?: string) {
    return this.request<CreatedInvitation>("POST", "/onboarding-invitations", prefilledPhoneNumber ? { prefilledPhoneNumber } : {});
  }
  listInvitations() {
    return this.request<OnboardingInvitation[]>("GET", "/onboarding-invitations");
  }
  revokeInvitation(id: string) {
    return this.request<{ success: true }>("DELETE", `/onboarding-invitations/${id}`);
  }

  // ── Public onboarding page (no session; Step 8) ─────────────────────
  getPublicInvitation(token: string) {
    return this.request<PublicInvitation>("GET", `/onboarding/invitations/${encodeURIComponent(token)}`);
  }
  uploadOnboardingFile(token: string, purpose: FileAssetPurpose, file: Blob, fileName: string) {
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", file, fileName);
    return this.requestForm<UploadedFile>(`/onboarding/invitations/${encodeURIComponent(token)}/uploads`, form);
  }
  submitJoinApplication(token: string, input: JoinApplicationInput) {
    return this.request<{ submitted: true }>("POST", `/onboarding/invitations/${encodeURIComponent(token)}/redeem`, input);
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
  assignTemporarySupervisor(shiftId: string, input: { workerProfileId: string; activatedAt?: string; expiresAt?: string; canOpenCheckInPoints?: boolean }) {
    return this.request<TemporarySupervisorAssignment>("POST", `/shifts/${shiftId}/temporary-supervisors`, input);
  }
  /** A shift's temporary-supervisor assignments with their state now (Owners and Field Managers). */
  listShiftTemporarySupervisors(shiftId: string) {
    return this.request<TemporarySupervisorListItem[]>("GET", `/shifts/${shiftId}/temporary-supervisors`);
  }
  revokeTemporarySupervisor(assignmentId: string) {
    return this.request<TemporarySupervisorAssignment>("DELETE", `/shifts/temporary-supervisors/${assignmentId}`);
  }
  /** Allowed for Owners, Field Managers and the shift's active Temporary Supervisor. */
  createTemporaryCheckInPoint(input: { shiftId: string; name: string; latitude: number; longitude: number; radiusMeters?: number }) {
    return this.request<TemporaryCheckInPoint>("POST", "/shifts/temporary-check-in-points", input);
  }
  listTemporaryCheckInPoints(shiftId: string) {
    return this.request<TemporaryCheckInPoint[]>("GET", `/shifts/${shiftId}/temporary-check-in-points`);
  }
  /** Closes a temporary check-in point: managers, or the shift's active Temporary Supervisor allowed to manage points. */
  closeTemporaryCheckInPoint(pointId: string) {
    return this.request<TemporaryCheckInPoint>("DELETE", `/shifts/temporary-check-in-points/${pointId}`);
  }

  // ── Temporary supervisor (the supervisor's own session) ─────────────
  myTemporarySupervisions() {
    return this.request<MyTemporarySupervision[]>("GET", "/temporary-supervisors/me");
  }
  getSupervisedShift(assignmentId: string) {
    return this.request<SupervisedShift>("GET", `/temporary-supervisors/${assignmentId}/shift`);
  }
  reportSupervisorIssue(assignmentId: string, text: string) {
    return this.request<{ reportedAt: string; notifiedCount: number }>("POST", `/temporary-supervisors/${assignmentId}/report-issue`, { text });
  }

  // ── Live operations (no money) ──────────────────────────────────────
  getOperationsLive() {
    return this.request<OperationsSnapshot>("GET", "/operations/live");
  }
  /**
   * URL of the notifications SSE stream for `EventSource`, which cannot send
   * an Authorization header: the access token travels as a query parameter.
   * Owners and Field Managers also get named `operations` events on it.
   */
  notificationsStreamUrl(accessToken: string) {
    return `${this.options.baseUrl}/notifications/stream?token=${encodeURIComponent(accessToken)}`;
  }

  // ── Organization settings ───────────────────────────────────────────
  getOrganizationSettings() {
    return this.request<OrganizationSettingsView>("GET", "/organizations/me/settings");
  }
  updateWorkdaySettings(input: Partial<WorkdaySettings>) {
    return this.request<OrganizationSettingsView>("PATCH", "/organizations/me/settings/workday", input);
  }
  updateOnboardingSettings(input: { invitationTtlHours: number }) {
    return this.request<OrganizationSettingsView>("PATCH", "/organizations/me/settings/onboarding", input);
  }
  updateNotificationSettings(preferences: { type: NotificationType; owners?: boolean; fieldManagers?: boolean }[]) {
    return this.request<OrganizationSettingsView>("PATCH", "/organizations/me/settings/notifications", { preferences });
  }

  // ── Users, roles and devices (Owners) ───────────────────────────────
  listMembers() {
    return this.request<Member[]>("GET", "/memberships");
  }
  changeMemberRole(membershipId: string, role: OrgRole, reason: string) {
    return this.request<Member>("PATCH", `/memberships/${membershipId}/role`, { role, reason });
  }
  suspendMember(membershipId: string, reason: string) {
    return this.request<Member>("POST", `/memberships/${membershipId}/suspend`, { reason });
  }
  reactivateMember(membershipId: string, reason: string) {
    return this.request<Member>("POST", `/memberships/${membershipId}/reactivate`, { reason });
  }
  archiveMember(membershipId: string, reason: string) {
    return this.request<Member>("POST", `/memberships/${membershipId}/archive`, { reason });
  }
  setMemberTimeTracking(membershipId: string, isTimeTrackable: boolean, reason: string) {
    return this.request<Member>("PATCH", `/memberships/${membershipId}/time-tracking`, { isTimeTrackable, reason });
  }
  listMemberDevices(membershipId: string) {
    return this.request<MemberDevice[]>("GET", `/memberships/${membershipId}/devices`);
  }
  /** "إنهاء الجلسة": the session ends at once (its access token is refused too). */
  revokeMemberSession(membershipId: string, sessionId: string, reason: string) {
    return this.request<{ id: string; revokedAt: string }>("POST", `/memberships/${membershipId}/sessions/${sessionId}/revoke`, { reason });
  }
  /** "إلغاء مفتاح الجهاز": offline events signed by that device are refused from now on. */
  revokeMemberDeviceKey(membershipId: string, deviceId: string, reason: string) {
    return this.request<{ id: string; revokedAt: string }>("POST", `/memberships/${membershipId}/devices/${deviceId}/revoke-key`, { reason });
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
  getTimeEntry(id: string) {
    return this.request<TimeEntry>("GET", `/time-entries/${id}`);
  }
  /** Owners and Field Managers; never carries money. */
  listAttendanceEntries(filters: AttendanceListFilters = {}) {
    return this.request<AttendanceListResponse>("GET", `/attendance/entries${queryString({ ...filters })}`);
  }
  /** Everything a manager needs to decide on one entry; never carries money. */
  getTimeEntryEvidence(id: string) {
    return this.request<TimeEntryEvidence>("GET", `/time-entries/${id}/evidence`);
  }
  /** Owner only (403 for anyone else). */
  getTimeEntryEstimatedCost(id: string) {
    return this.request<EntryCostEstimate>("GET", `/time-entries/${id}/estimated-cost`);
  }
  requestTimeEntryCorrection(id: string, notes: string) {
    return this.request<TimeEntry>("POST", `/time-entries/${id}/request-correction`, { notes });
  }
  createManualCorrection(input: ManualCorrectionInput) {
    return this.request<{ timeEntry: TimeEntry; correction: { id: string } }>("POST", "/manual-corrections", input);
  }
  /** An Owner's rows also carry `deductionAgorot`. */
  listForgottenStampInfractions(filters: { month?: string; workerProfileId?: string } = {}) {
    return this.request<ForgottenStampInfraction[]>("GET", `/forgotten-stamp-infractions${queryString(filters)}`);
  }
  /** Owner only: cancels the deduction with an offsetting adjustment (the original is kept). */
  reverseForgottenStampInfraction(id: string, reason: string) {
    return this.request<ForgottenStampInfraction>("POST", `/forgotten-stamp-infractions/${id}/reverse`, { reason });
  }
  /** Owner only (403 for anyone else). `month` is YYYY-MM; the current month when omitted. */
  getWorkerEstimatedEarnings(workerProfileId: string, month?: string) {
    return this.request<WorkerMonthEarnings>("GET", `/workers/${workerProfileId}/estimated-earnings${queryString({ month })}`);
  }

  // ── Clock events ────────────────────────────────────────────────────
  /** The API answers with the new time entry and the clock event that opened it. */
  clockIn(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<ClockInResult>("POST", "/clock-events/clock-in", input, {
      "Idempotency-Key": idempotencyKey,
    });
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

  // ── Payroll (Owner only, except the caller's own statements) ────────
  listPayrollPeriods() {
    return this.request<PayrollPeriodSummary[]>("GET", "/payroll-periods");
  }
  /** The month's latest version (404 when the month was never calculated). */
  getPayrollPeriod(yearMonth: string) {
    return this.request<PayrollVersionDetail>("GET", `/payroll-periods/${yearMonth}`);
  }
  /** Any version of the month, read-only unless it is the latest. */
  getPayrollVersion(yearMonth: string, version: number) {
    return this.request<PayrollVersionDetail>("GET", `/payroll-periods/${yearMonth}/versions/${version}`);
  }
  listPayrollVersions(yearMonth: string) {
    return this.request<PayrollVersionSummary[]>("GET", `/payroll-periods/${yearMonth}/versions`);
  }
  getPayrollWorker(yearMonth: string, version: number, workerProfileId: string) {
    return this.request<PayrollWorkerDetail>("GET", `/payroll-periods/${yearMonth}/versions/${version}/workers/${workerProfileId}`);
  }
  /** The latest calculation run of the month's latest version (404 when there is none). */
  getPayrollCalculation(yearMonth: string) {
    return this.request<PayrollCalculationRun>("GET", `/payroll-periods/${yearMonth}/calculation`);
  }
  /** Starts a background calculation (202). The same key always returns the same run; a second calculation while one runs is 409. */
  calculatePayroll(yearMonth: string, idempotencyKey: string) {
    return this.request<PayrollCalculationRun>("POST", `/payroll-periods/${yearMonth}/calculate`, undefined, { "Idempotency-Key": idempotencyKey });
  }
  finalizePayroll(yearMonth: string) {
    return this.request<PayrollVersionDetail>("POST", `/payroll-periods/${yearMonth}/finalize`);
  }
  /** Creates the next version from the finalized one (which stays readable); answers the new version. */
  reopenPayroll(yearMonth: string, reason: string) {
    return this.request<PayrollVersionDetail>("POST", `/payroll-periods/${yearMonth}/reopen`, { reason });
  }
  createPayrollAdjustment(yearMonth: string, input: CreatePayrollAdjustmentInput) {
    return this.request<PayrollAdjustmentLine>("POST", `/payroll-periods/${yearMonth}/adjustments`, input);
  }
  getFinancialDashboard(yearMonth: string) {
    return this.request<FinancialDashboard>("GET", `/payroll-periods/${yearMonth}/dashboard`);
  }
  /** The caller's own salary: finalized months plus labeled estimates (time-trackable members only; 404 otherwise). */
  getMySalaryStatements() {
    return this.request<MySalaryStatements>("GET", "/payroll-statements/me");
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
  startEmergencyCallout(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<EmergencyCalloutStartResult>("POST", "/emergency-callouts/start", input, { "Idempotency-Key": idempotencyKey });
  }
  endEmergencyCallout(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<EmergencyCalloutEndResult>("POST", "/emergency-callouts/end", input, { "Idempotency-Key": idempotencyKey });
  }
  /** Owners and Field Managers; an Owner's items also carry `estimatedCostAgorot`. */
  listEmergencyCallouts(filters: EmergencyCalloutFilters = {}) {
    return this.request<Paginated<EmergencyCalloutRecord>>("GET", `/emergency-callouts${queryString({ ...filters })}`);
  }
  getEmergencyCallout(id: string) {
    return this.request<EmergencyCalloutRecord>("GET", `/emergency-callouts/${id}`);
  }

  // ── Dev tools (test mode only; the API answers 404 when dev login is off) ──
  /** Moves an open time entry's clock-in back by `minutes` (max 24 h). Audited as DEV_REWIND; Owners and Field Managers only. */
  rewindTimeEntry(id: string, minutes: number) {
    return this.request<TimeEntry>("POST", `/dev/time-entries/${id}/rewind`, { minutes });
  }
  /** The signed-in worker's Turan and temporary-supervisor assignments (call with the worker's own session). */
  getWorkerSimulatorContext() {
    return this.request<WorkerSimulatorContext>("GET", "/dev/worker-simulator/me");
  }

  // ── Audit logs ──────────────────────────────────────────────────────
  listAuditLogs(cursor?: string) {
    return this.request<{ items: AuditLogEntry[]; nextCursor: string | null }>("GET", `/audit-logs${cursor ? `?cursor=${cursor}` : ""}`);
  }
  verifyAuditChain() {
    return this.request<{ valid: boolean; brokenAtId?: string }>("GET", "/audit-logs/verify");
  }

  // ── Reports (Step 8: background jobs, PDF + CSV) ────────────────────
  /** Starts a report (202, a background job). The same key always answers the same report. */
  createReport(input: CreateReportInput, idempotencyKey: string) {
    return this.request<GeneratedReport>("POST", "/reports", input, { "Idempotency-Key": idempotencyKey });
  }
  listReports() {
    return this.request<GeneratedReport[]>("GET", "/reports");
  }
  getReport(id: string) {
    return this.request<GeneratedReport>("GET", `/reports/${id}`);
  }
  getReportDownloadUrl(id: string, format: ReportFileFormat = "pdf") {
    return this.request<ReportDownload>("GET", `/reports/${id}/download?format=${format}`);
  }
  verifyReport(id: string) {
    return this.request<ReportVerification>("GET", `/reports/${id}/verify`);
  }
}
