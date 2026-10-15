import type { INestApplication } from "@nestjs/common";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { v7 as uuidv7 } from "uuid";
import { NotificationType, Permission, PRIVACY_NOTICE_VERSION } from "@fieldmaster/shared-types";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { useEnv } from "./use-env";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { AuditService } from "../src/common/audit/audit.service";
import { LongOpenEntriesService } from "../src/modules/operations/long-open-entries.service";
import { BASELINE_JPEG } from "./onboarding-files";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";

/**
 * Mobile manager mode: actionable notifications and the manager's phone
 * screens. Every manager's copy of a notification about one entry, one
 * application or one supervisor report points at the same subject; the
 * action that solves it settles it once for all of them, and everyone sees
 * who handled it and when. The new routes keep the permission and project
 * rules of the web: a member restricted to some projects never reads, counts
 * or changes another project's records.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_A_PHONE = "+972500010001";
const WORKER_B_PHONE = "+972500010002";
const SCOPED_PHONE = "+972500020001";
const ACCOUNTANT_PHONE = "+972500020002";
const PLANNER_PHONE = "+972500020003";
const APPLICANT_PHONE = "+972521234567";

const SITE_A = { lat: 32.0853, lng: 34.7818 };
const SITE_B = { lat: 32.1853, lng: 34.8818 };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A project manager's role, restricted to project A in the tests that need it. */
const PROJECT_MANAGER_PERMISSIONS: Permission[] = [
  Permission.VIEW_ATTENDANCE,
  Permission.APPROVE_ATTENDANCE,
  Permission.CORRECT_TIME_ENTRIES,
  Permission.APPLY_FULL_DAY_CREDIT,
  Permission.VIEW_OPERATIONS,
  Permission.VIEW_SHIFTS,
  Permission.MANAGE_SHIFTS,
  Permission.MANAGE_TEMP_SUPERVISORS,
  Permission.MANAGE_SITES,
  Permission.MANAGE_WORKERS,
];
/** «محاسب»: attendance and money, no decisions. */
const ACCOUNTANT_PERMISSIONS: Permission[] = [Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL, Permission.VIEW_FINANCIAL_DASHBOARD];
/** Plans shifts without managing sites. */
const PLANNER_PERMISSIONS: Permission[] = [Permission.VIEW_SHIFTS, Permission.MANAGE_SHIFTS];

const COMPENSATION = {
  compensationType: "DAILY",
  dailyBaseRateAgorot: 45_000,
  overtimeHourlyRateAgorot: 6_500,
  effectiveStartDate: "2026-10-01",
  changeReason: "Onboarding approval",
};

interface NotificationRow {
  id: string;
  type: string;
  subjectId: string | null;
  dataJson: Record<string, unknown> | null;
  action: { kind: string; timeEntryId?: string; workerProfileId?: string; issueId?: string } | null;
  handled: { at: string; by: { userId: string; fullLegalName: string }; outcome: string; note: string | null } | null;
}

function storageClient() {
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
}

describe("Mobile manager mode (e2e)", () => {
  // One application per test at most; the public onboarding limit is tested in onboarding.e2e-spec.ts.
  useEnv({ ONBOARDING_RATE_LIMIT: "1000" });

  let app: INestApplication;
  let prisma: PrismaService;
  const organizationsWithFiles: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // The applications' ID images went to the shared development bucket.
    const bucket = process.env.S3_BUCKET ?? "fieldmaster-dev";
    for (const organizationId of organizationsWithFiles) {
      const listed = await storageClient().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `onboarding/${organizationId}/` }));
      const keys = (listed.Contents ?? []).map((object) => object.Key ?? "").filter(Boolean);
      if (keys.length > 0) await storageClient().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
    }
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  const http = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => request(http()).post(`/api/v1${path}`).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: object = {}) => request(http()).patch(`/api/v1${path}`).set(auth(token)).send(body);

  function clockEvent(token: string, kind: "clock-in" | "clock-out", site: { lat: number; lng: number }, body: Record<string, unknown>) {
    return post(token, `/clock-events/${kind}`, { clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), latitude: site.lat, longitude: site.lng, accuracyMeters: 10, deviceId: "device-1", ...body }).set(
      "Idempotency-Key",
      uuidv7(),
    );
  }

  /**
   * Two projects, each with a site, a shift (managed by the Field Manager) and a worker; a project manager
   * restricted to project A, an accountant (custom role «محاسب») and a shift planner without site rights.
   */
  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const projectA = await prisma.project.update({ where: { id: (await createProject(prisma, organizationId, "PRJ-A")).id }, data: { name: "Project A" } });
    const projectB = await prisma.project.update({ where: { id: (await createProject(prisma, organizationId, "PRJ-B")).id }, data: { name: "Project B" } });
    const a = await createSiteWithGeofence(prisma, organizationId, projectA.id, SITE_A.lat, SITE_A.lng, 100);
    const b = await createSiteWithGeofence(prisma, organizationId, projectB.id, SITE_B.lat, SITE_B.lng, 100);
    const start = new Date(Date.now() - 3_600_000);
    const end = new Date(Date.now() + 8 * 3_600_000);
    const shiftA = await createStandardShift(prisma, organizationId, projectA.id, a.site.id, a.geofence.id, manager.user.id, start, end);
    const shiftB = await createStandardShift(prisma, organizationId, projectB.id, b.site.id, b.geofence.id, manager.user.id, start, end);
    await prisma.shift.update({ where: { id: shiftA.id }, data: { title: "Shift of project A" } });
    await prisma.shift.update({ where: { id: shiftB.id }, data: { title: "Shift of project B" } });
    const workerA = await addWorker(prisma, organizationId, WORKER_A_PHONE, "Worker Alpha", { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
    const workerB = await addWorker(prisma, organizationId, WORKER_B_PHONE, "Worker Beta", { type: "DAILY", dailyRateAgorot: 41_000, overtimeRateAgorot: 6_000 });
    await assignWorkerToShift(prisma, shiftA.id, workerA.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shiftB.id, workerB.workerProfile.id, manager.user.id);

    const ownerToken = (await loginAs(app, OWNER_PHONE)).accessToken;
    const member = async (phoneNumber: string, fullLegalName: string, name: string, permissions: Permission[]) => {
      const role = await post(ownerToken, "/roles", { name, permissions }).expect(201);
      return (await post(ownerToken, "/memberships", { phoneNumber, fullLegalName, roleId: role.body.id }).expect(201)).body.id as string;
    };
    const scopedId = await member(SCOPED_PHONE, "Sara Scoped", "Project manager", PROJECT_MANAGER_PERMISSIONS);
    await member(ACCOUNTANT_PHONE, "Adel Accountant", "محاسب", ACCOUNTANT_PERMISSIONS);
    await member(PLANNER_PHONE, "Paz Planner", "Shift planner", PLANNER_PERMISSIONS);
    await patch(ownerToken, `/memberships/${scopedId}/scope`, { restricted: true, projectIds: [projectA.id], reason: "Runs project A" }).expect(200);

    return {
      organizationId,
      owner,
      manager,
      projectA,
      projectB,
      siteA: a.site,
      siteB: b.site,
      geofenceA: a.geofence,
      shiftA: { ...shiftA, title: "Shift of project A" },
      shiftB: { ...shiftB, title: "Shift of project B" },
      workerA,
      workerB,
      tokens: {
        owner: ownerToken,
        manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
        workerA: (await loginAs(app, WORKER_A_PHONE)).accessToken,
        workerB: (await loginAs(app, WORKER_B_PHONE)).accessToken,
        scoped: (await loginAs(app, SCOPED_PHONE)).accessToken,
        accountant: (await loginAs(app, ACCOUNTANT_PHONE)).accessToken,
        planner: (await loginAs(app, PLANNER_PHONE)).accessToken,
      },
    };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** The worker of project A or B clocks in and out of their shift: one entry waiting for approval. */
  async function workDay(ctx: Ctx, which: "A" | "B"): Promise<string> {
    const token = which === "A" ? ctx.tokens.workerA : ctx.tokens.workerB;
    const site = which === "A" ? SITE_A : SITE_B;
    const shift = which === "A" ? ctx.shiftA : ctx.shiftB;
    await clockEvent(token, "clock-in", site, { shiftId: shift.id }).expect(201);
    const out = await clockEvent(token, "clock-out", site, { summaryText: "Set up the lane closure.", taskCategory: "TRAFFIC_CONTROL" }).expect(201);
    return out.body.id;
  }

  async function notificationsOf(token: string): Promise<NotificationRow[]> {
    return (await get(token, "/notifications").expect(200)).body;
  }

  function one(rows: NotificationRow[], type: string, timeEntryId?: string): NotificationRow {
    const matches = rows.filter((row) => row.type === type && (timeEntryId === undefined || row.dataJson?.timeEntryId === timeEntryId));
    expect({ type, count: matches.length }).toEqual({ type, count: 1 });
    return matches[0];
  }

  it("an entry's notifications share one subject: the Field Manager approves, and the Owner's copy shows who handled it and when", async () => {
    const ctx = await setup();
    const entryId = await workDay(ctx, "A");

    const ownerRow = one(await notificationsOf(ctx.tokens.owner), "WORKER_CLOCKED_OUT");
    const managerRow = one(await notificationsOf(ctx.tokens.manager), "WORKER_CLOCKED_OUT");
    const subjectId = ownerRow.subjectId as string;
    expect(subjectId).toEqual(expect.any(String));
    expect(managerRow.subjectId).toBe(subjectId);
    for (const row of [ownerRow, managerRow]) {
      expect(row.action).toEqual({ kind: "REVIEW_ATTENDANCE", timeEntryId: entryId, workerProfileId: ctx.workerA.workerProfile.id });
      expect(row.handled).toBeNull();
    }
    expect((await get(ctx.tokens.manager, `/notification-subjects/${subjectId}`).expect(200)).body).toEqual({ id: subjectId, kind: "ATTENDANCE", handled: null });
    // The worker: their own notifications ask nothing of them, and the subject does not exist for them.
    for (const row of await notificationsOf(ctx.tokens.workerA)) expect(row.action).toBeNull();
    await get(ctx.tokens.workerA, `/notification-subjects/${subjectId}`).expect(404);
    await get(ctx.tokens.manager, "/notification-subjects/not-an-id").expect(404);

    await post(ctx.tokens.manager, `/time-entries/${entryId}/approve`, { notes: "Checked with the site" }).expect(201);

    const handled = { at: expect.stringMatching(ISO), by: { userId: ctx.manager.user.id, fullLegalName: "Yossi Manager" }, outcome: "APPROVED", note: "Checked with the site" };
    expect(one(await notificationsOf(ctx.tokens.owner), "WORKER_CLOCKED_OUT").handled).toEqual(handled);
    expect(one(await notificationsOf(ctx.tokens.manager), "WORKER_CLOCKED_OUT").handled).toEqual(handled);
    expect((await get(ctx.tokens.owner, `/notification-subjects/${subjectId}`).expect(200)).body).toEqual({ id: subjectId, kind: "ATTENDANCE", handled });

    // Audited once, as the one who handled it.
    const audit = await prisma.auditLog.findMany({ where: { action: "NOTIFICATION_SUBJECT_HANDLED", entityId: subjectId } });
    expect(audit.map((row) => ({ actorUserId: row.actorUserId, field: row.field, newValue: row.newValue }))).toEqual([
      { actorUserId: ctx.manager.user.id, field: "handledOutcome", newValue: "APPROVED" },
    ]);
    // Already handled: a second manager cannot settle it again.
    expect((await post(ctx.tokens.owner, `/notification-subjects/${subjectId}/handle`, { note: "Too late" }).expect(409)).body.code).toBe("CONFLICT");
  });

  it("a requested correction settles with its note; an open entry's alert is marked followed up by a member who may settle attendance, and the clock-out opens it again", async () => {
    const ctx = await setup();
    const entryB = await workDay(ctx, "B");
    await post(ctx.tokens.manager, `/time-entries/${entryB}/request-correction`, { notes: "The clock-out time looks wrong" }).expect(201);
    expect(one(await notificationsOf(ctx.tokens.owner), "WORKER_CLOCKED_OUT", entryB).handled).toEqual({
      at: expect.stringMatching(ISO),
      by: { userId: ctx.manager.user.id, fullLegalName: "Yossi Manager" },
      outcome: "CORRECTION_REQUESTED",
      note: "The clock-out time looks wrong",
    });

    // Worker A clocks in; over nine hours later the overtime alert goes out.
    const clockIn = await clockEvent(ctx.tokens.workerA, "clock-in", SITE_A, { shiftId: ctx.shiftA.id }).expect(201);
    const entryA: string = clockIn.body.timeEntry.id;
    await app.get(LongOpenEntriesService).sweep(new Date(Date.now() + 9.5 * 3_600_000));
    const alert = one(await notificationsOf(ctx.tokens.manager), "OVERTIME_THRESHOLD_CROSSED");
    expect(alert.action).toEqual({ kind: "OPEN_ENTRY", timeEntryId: entryA, workerProfileId: ctx.workerA.workerProfile.id });
    const subjectId = alert.subjectId as string;

    // The accountant may read attendance but settles nothing.
    await get(ctx.tokens.accountant, `/notification-subjects/${subjectId}`).expect(200);
    expect((await post(ctx.tokens.accountant, `/notification-subjects/${subjectId}/handle`, { note: "Seen" }).expect(403)).body.code).toBe("FORBIDDEN");

    const followedUp = await post(ctx.tokens.manager, `/notification-subjects/${subjectId}/handle`, { note: "  Called the worker: still on site  " }).expect(200);
    const handled = { at: expect.stringMatching(ISO), by: { userId: ctx.manager.user.id, fullLegalName: "Yossi Manager" }, outcome: "REVIEWED", note: "Called the worker: still on site" };
    expect(followedUp.body).toEqual({ id: subjectId, kind: "ATTENDANCE", handled });
    expect(one(await notificationsOf(ctx.tokens.owner), "OVERTIME_THRESHOLD_CROSSED").handled).toEqual(handled);

    // The clock-out is new news about the same entry: its approval is open again, on both notifications.
    await clockEvent(ctx.tokens.workerA, "clock-out", SITE_A, { summaryText: "Long night on the bridge.", taskCategory: "TRAFFIC_CONTROL" }).expect(201);
    const rows = await notificationsOf(ctx.tokens.owner);
    const clockOut = one(rows, "WORKER_CLOCKED_OUT", entryA);
    expect(clockOut.subjectId).toBe(subjectId);
    expect(clockOut.handled).toBeNull();
    expect(one(rows, "OVERTIME_THRESHOLD_CROSSED").handled).toBeNull();
  });

  it("a notification from before subjects (none stored) asks for its action only while its record still waits for it", async () => {
    const ctx = await setup();
    const entryId = await workDay(ctx, "A");
    // As the API stored them before this release: no subject.
    await prisma.notificationDelivery.deleteMany({ where: { notification: { organizationId: ctx.organizationId } } });
    await prisma.notification.deleteMany({ where: { organizationId: ctx.organizationId } });
    const old = (type: NotificationType, dataJson: Record<string, string | number>) =>
      prisma.notification.create({ data: { id: uuidv7(), organizationId: ctx.organizationId, recipientUserId: ctx.manager.user.id, type, title: "t", body: "b", dataJson } });
    await old(NotificationType.WORKER_CLOCKED_OUT, { timeEntryId: entryId, workerProfileId: ctx.workerA.workerProfile.id, workerName: "Worker Alpha" });
    await old(NotificationType.OFFLINE_EVENT_REJECTED, { workerProfileId: ctx.workerA.workerProfile.id, workerName: "Worker Alpha", flaggedCount: 0, rejectedCount: 1 });

    const before = await notificationsOf(ctx.tokens.manager);
    expect(one(before, "WORKER_CLOCKED_OUT")).toMatchObject({ subjectId: null, action: { kind: "REVIEW_ATTENDANCE", timeEntryId: entryId }, handled: null });
    // Nothing to mark reviewed with: information only.
    expect(one(before, "OFFLINE_EVENT_REJECTED")).toMatchObject({ subjectId: null, action: null, handled: null });

    await post(ctx.tokens.manager, `/time-entries/${entryId}/approve`).expect(201);
    expect(one(await notificationsOf(ctx.tokens.manager), "WORKER_CLOCKED_OUT")).toMatchObject({ action: null, handled: null });
  });

  it("a member restricted to some projects reads only their projects' subjects; each member's home counters follow their permissions and match the approvals list", async () => {
    const ctx = await setup();
    const entryA = await workDay(ctx, "A");
    const entryB = await workDay(ctx, "B");
    const subjectOf = async (timeEntryId: string) => (await prisma.notificationSubject.findFirstOrThrow({ where: { kind: "ATTENDANCE", refId: timeEntryId } })).id;

    await get(ctx.tokens.scoped, `/notification-subjects/${await subjectOf(entryA)}`).expect(200);
    await get(ctx.tokens.scoped, `/notification-subjects/${await subjectOf(entryB)}`).expect(404);
    await post(ctx.tokens.scoped, `/notification-subjects/${await subjectOf(entryB)}/handle`).expect(404);

    // A correction asked for still waits (as on the approvals list).
    await post(ctx.tokens.manager, `/time-entries/${entryB}/request-correction`, { notes: "Fix the clock-out" }).expect(201);

    const counters = async (token: string) => {
      const { generatedAt, ...rest } = (await get(token, "/operations/summary").expect(200)).body;
      expect(generatedAt).toMatch(ISO);
      return rest;
    };
    const everything = { pendingApprovals: 2, onShift: 0, late: 0, siteAlerts: 0, onboardingRequests: 0 };
    expect(await counters(ctx.tokens.owner)).toEqual(everything);
    expect(await counters(ctx.tokens.manager)).toEqual(everything);
    // Project A only, and no applications (an organization-wide permission a restricted member never holds).
    expect(await counters(ctx.tokens.scoped)).toEqual({ pendingApprovals: 1, onShift: 0, late: 0, siteAlerts: 0 });
    expect(await counters(ctx.tokens.accountant)).toEqual({});
    expect(await counters(ctx.tokens.workerA)).toEqual({});

    for (const [token, pending] of [
      [ctx.tokens.owner, 2],
      [ctx.tokens.scoped, 1],
    ] as const) {
      expect((await get(token, "/attendance/entries?tab=PENDING").expect(200)).body.tabCounts.PENDING).toBe(pending);
    }
  });

  it("an application: the summary decrypts nothing and masks the bank account by permission; approving it settles it for every manager, and a late rejection is refused", async () => {
    const ctx = await setup();
    organizationsWithFiles.push(ctx.organizationId);
    // Owners get applications by default; the organization adds its Field Managers.
    await patch(ctx.tokens.owner, "/organizations/me/settings/notifications", { preferences: [{ type: "ONBOARDING_SUBMITTED", owners: true, fieldManagers: true }] }).expect(200);
    const invitation = (await post(ctx.tokens.owner, "/onboarding-invitations").expect(201)).body;
    const document = await request(http())
      .post(`/api/v1/onboarding/invitations/${invitation.token}/uploads`)
      .field("purpose", "IDENTITY_DOCUMENT")
      .attach("file", BASELINE_JPEG, { filename: "id.jpg", contentType: "image/jpeg" })
      .expect(201);
    await request(http())
      .post(`/api/v1/onboarding/invitations/${invitation.token}/redeem`)
      .send({
        phoneNumber: APPLICANT_PHONE,
        fullLegalName: "Samir Haddad",
        governmentIdType: "ISRAELI_ID",
        governmentIdNumber: "314159260",
        identityDocumentAssetId: document.body.fileAssetId,
        bankName: "Bank Hapoalim",
        branchNumber: "613",
        accountNumber: "4417290031",
        accountHolderName: "Samir Haddad",
        consentAccepted: true,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      })
      .expect(201);
    const applicant = await prisma.workerProfile.findFirstOrThrow({ where: { membership: { user: { phoneNumber: APPLICANT_PHONE } } }, include: { membership: true } });
    const workerProfileId = applicant.id;

    const ownerRow = one(await notificationsOf(ctx.tokens.owner), "ONBOARDING_SUBMITTED");
    const managerRow = one(await notificationsOf(ctx.tokens.manager), "ONBOARDING_SUBMITTED");
    expect(managerRow.subjectId).toBe(ownerRow.subjectId);
    for (const row of [ownerRow, managerRow]) {
      expect(row.action).toEqual({ kind: "REVIEW_ONBOARDING", workerProfileId });
      expect(row.handled).toBeNull();
    }

    const summaryPath = `/workers/${workerProfileId}/onboarding-summary`;
    const base = { workerProfileId, membershipStatus: "PENDING_APPROVAL", fullLegalName: "Samir Haddad", phoneNumber: APPLICANT_PHONE, governmentIdType: "ISRAELI_ID", hasIdentityDocument: true };
    const managerSummary = (await get(ctx.tokens.manager, summaryPath).expect(200)).body;
    expect(managerSummary).toMatchObject({ ...base, canRevealDetails: false, canApprove: false, canReject: true });
    expect(managerSummary).not.toHaveProperty("bankAccount");
    const ownerSummary = (await get(ctx.tokens.owner, summaryPath).expect(200)).body;
    expect(ownerSummary).toMatchObject({ ...base, bankAccount: { bankName: "Bank Hapoalim", branchNumber: "613", accountNumberLast4: "0031" }, canRevealDetails: true, canApprove: true, canReject: true });
    for (const summary of [managerSummary, ownerSummary]) {
      expect(JSON.stringify(summary)).not.toContain("4417290031");
      expect(JSON.stringify(summary)).not.toContain("314159260");
    }
    // Nothing was decrypted for display, so no sensitive view was recorded.
    expect(await prisma.auditLog.count({ where: { action: "WORKER_SENSITIVE_DATA_VIEWED" } })).toBe(0);
    await get(ctx.tokens.scoped, summaryPath).expect(403);
    await get(ctx.tokens.accountant, summaryPath).expect(403);
    await get(ctx.tokens.owner, "/workers/not-an-id/onboarding-summary").expect(404);

    // An application is settled by its decision, not marked handled.
    expect((await post(ctx.tokens.manager, `/notification-subjects/${ownerRow.subjectId}/handle`).expect(409)).body.code).toBe("NOTIFICATION_SUBJECT_NOT_HANDLED_HERE");
    await post(ctx.tokens.owner, `/workers/${workerProfileId}/approve`, { compensationProfile: COMPENSATION }).expect(201);
    expect(one(await notificationsOf(ctx.tokens.manager), "ONBOARDING_SUBMITTED").handled).toEqual({
      at: expect.stringMatching(ISO),
      by: { userId: ctx.owner.user.id, fullLegalName: "Dana Owner" },
      outcome: "WORKER_APPROVED",
      note: null,
    });
    // The Field Manager's late tap on «رفض»: refused, the worker stays active.
    expect((await post(ctx.tokens.manager, `/workers/${workerProfileId}/reject`, { reason: "Duplicate application" }).expect(409)).body.code).toBe("CONFLICT");
    expect((await prisma.organizationMembership.findUniqueOrThrow({ where: { id: applicant.membershipId } })).status).toBe("ACTIVE");
    expect(await prisma.auditLog.count({ where: { action: "WORKER_REJECTED" } })).toBe(0);
  });

  it("a temporary supervisor's report is resolved once with a note, shown on every manager's copy; the supervisor is told; another project's member never sees it", async () => {
    const ctx = await setup();
    const assignment = (await post(ctx.tokens.manager, `/shifts/${ctx.shiftB.id}/temporary-supervisors`, { workerProfileId: ctx.workerB.workerProfile.id }).expect(201)).body;
    await post(ctx.tokens.workerB, `/temporary-supervisors/${assignment.id}/report-issue`, { text: "The arrow board battery is flat" }).expect(201);

    const ownerRow = one(await notificationsOf(ctx.tokens.owner), "TEMPORARY_SUPERVISOR_ISSUE_REPORTED");
    const managerRow = one(await notificationsOf(ctx.tokens.manager), "TEMPORARY_SUPERVISOR_ISSUE_REPORTED");
    const issueId = ownerRow.action?.issueId as string;
    expect(ownerRow.action).toEqual({ kind: "RESOLVE_SUPERVISOR_ISSUE", issueId: expect.any(String) });
    expect(managerRow.action).toEqual(ownerRow.action);
    expect(managerRow.subjectId).toBe(ownerRow.subjectId);

    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: ctx.shiftB.id } });
    expect((await get(ctx.tokens.manager, `/supervisor-issues/${issueId}`).expect(200)).body).toEqual({
      id: issueId,
      text: "The arrow board battery is flat",
      reportedAt: expect.stringMatching(ISO),
      shift: { id: shift.id, title: "Shift of project B", siteName: "Test Site", scheduledStart: shift.scheduledStart.toISOString(), scheduledEnd: shift.scheduledEnd.toISOString() },
      supervisor: { workerProfileId: ctx.workerB.workerProfile.id, fullLegalName: "Worker Beta", phoneNumber: WORKER_B_PHONE },
      resolved: null,
    });
    await get(ctx.tokens.scoped, `/supervisor-issues/${issueId}`).expect(404);
    await get(ctx.tokens.workerB, `/supervisor-issues/${issueId}`).expect(403);
    await get(ctx.tokens.accountant, `/supervisor-issues/${issueId}`).expect(403);
    expect((await post(ctx.tokens.owner, `/notification-subjects/${ownerRow.subjectId}/handle`).expect(409)).body.code).toBe("NOTIFICATION_SUBJECT_NOT_HANDLED_HERE");
    await post(ctx.tokens.manager, `/supervisor-issues/${issueId}/resolve`, { note: "   " }).expect(400);
    await post(ctx.tokens.scoped, `/supervisor-issues/${issueId}/resolve`, { note: "Done" }).expect(404);

    const resolved = (await post(ctx.tokens.manager, `/supervisor-issues/${issueId}/resolve`, { note: "Swapped the battery" }).expect(200)).body;
    const by = { userId: ctx.manager.user.id, fullLegalName: "Yossi Manager" };
    expect(resolved.resolved).toEqual({ at: expect.stringMatching(ISO), by, note: "Swapped the battery" });
    expect(one(await notificationsOf(ctx.tokens.owner), "TEMPORARY_SUPERVISOR_ISSUE_REPORTED").handled).toEqual({
      at: resolved.resolved.at,
      by,
      outcome: "RESOLVED",
      note: "Swapped the battery",
    });
    expect((await post(ctx.tokens.owner, `/supervisor-issues/${issueId}/resolve`, { note: "Again" }).expect(409)).body.code).toBe("CONFLICT");

    const told = one(await notificationsOf(ctx.tokens.workerB), "TEMPORARY_SUPERVISOR_ISSUE_RESOLVED");
    expect(told.dataJson).toEqual({
      issueId,
      assignmentId: assignment.id,
      shiftId: ctx.shiftB.id,
      shiftTitle: "Shift of project B",
      resolverName: "Yossi Manager",
      note: "Swapped the battery",
    });
    expect(told.action).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "SUPERVISOR_ISSUE_RESOLVED", entityId: issueId } })).toBe(1);
  });

  it("a work location is saved in one transaction (with a new project when asked), a budget only with financial permission; edits are audited field by field and a new radius or center is a new geofence version", async () => {
    const ctx = await setup();
    const settings = await prisma.organizationSettings.findFirstOrThrow({ where: { organizationId: ctx.organizationId } });
    expect((await get(ctx.tokens.manager, "/work-locations/defaults").expect(200)).body).toEqual({
      defaultGeofenceRadiusMeters: settings.defaultGeofenceRadiusMeters,
      minRadiusMeters: 10,
      maxRadiusMeters: 5000,
    });
    await get(ctx.tokens.workerA, "/work-locations/defaults").expect(403);
    await get(ctx.tokens.accountant, "/work-locations/defaults").expect(403);

    const counts = async () => ({ projects: await prisma.project.count(), sites: await prisma.site.count(), geofences: await prisma.geofence.count() });
    const before = await counts();
    const body = {
      name: "North junction",
      address: "Route 4, km 12",
      latitude: 32.3,
      longitude: 34.9,
      geofenceRadiusMeters: 150,
      instructions: "Enter from the service road",
      emergencyContact: "050-0000000",
    };

    // A budget needs the permission to see money; a restricted member cannot start a project or use another one.
    expect((await post(ctx.tokens.manager, "/work-locations", { ...body, newProject: { name: "Ring road", budgetAgorot: 1_000_000 } }).expect(403)).body.code).toBe("FORBIDDEN");
    expect((await post(ctx.tokens.scoped, "/work-locations", { ...body, newProject: { name: "Ring road" } }).expect(403)).body.code).toBe("SCOPE_RESTRICTED");
    await post(ctx.tokens.scoped, "/work-locations", { ...body, projectId: ctx.projectB.id }).expect(404);
    // Exactly one of projectId and newProject; a radius within its bounds; a name.
    await post(ctx.tokens.owner, "/work-locations", body).expect(400);
    await post(ctx.tokens.owner, "/work-locations", { ...body, projectId: ctx.projectA.id, newProject: { name: "Ring road" } }).expect(400);
    await post(ctx.tokens.owner, "/work-locations", { ...body, projectId: ctx.projectA.id, geofenceRadiusMeters: 5 }).expect(400);
    await post(ctx.tokens.owner, "/work-locations", { ...body, projectId: ctx.projectA.id, name: "   " }).expect(400);
    await post(ctx.tokens.workerA, "/work-locations", { ...body, projectId: ctx.projectA.id }).expect(403);
    expect(await counts()).toEqual(before);

    // A step that fails takes the others with it: no project or site without its geofence.
    const audit = app.get(AuditService);
    const record = audit.record.bind(audit);
    const failing = jest.spyOn(audit, "record").mockImplementation(async (entry, tx) => {
      if (entry.action === "GEOFENCE_CREATED") throw new Error("Simulated failure while saving the geofence");
      return record(entry, tx);
    });
    try {
      await post(ctx.tokens.owner, "/work-locations", { ...body, newProject: { name: "Ring road" } }).expect(500);
    } finally {
      failing.mockRestore();
    }
    expect(await counts()).toEqual(before);

    const created = await post(ctx.tokens.owner, "/work-locations", { ...body, newProject: { name: "Ring road", client: "City of Netanya", budgetAgorot: 1_000_000 } }).expect(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      projectId: expect.any(String),
      projectName: "Ring road",
      name: "North junction",
      address: "Route 4, km 12",
      latitude: 32.3,
      longitude: 34.9,
      instructions: "Enter from the service road",
      emergencyContact: "050-0000000",
      geofence: { id: expect.any(String), centerLatitude: 32.3, centerLongitude: 34.9, radiusMeters: 150, version: 1 },
    });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: created.body.projectId } })).toMatchObject({ name: "Ring road", client: "City of Netanya", budgetAgorot: 1_000_000 });
    const createdAudit = await prisma.auditLog.findMany({
      where: { action: { in: ["PROJECT_CREATED", "SITE_CREATED", "GEOFENCE_CREATED"] }, actorUserId: ctx.owner.user.id },
      orderBy: { sequenceNumber: "asc" },
    });
    expect(createdAudit.map((row) => row.action)).toEqual(["PROJECT_CREATED", "SITE_CREATED", "GEOFENCE_CREATED"]);
    expect(new Set(createdAudit.map((row) => row.correlationId)).size).toBe(1);

    // The Field Manager starts a project without a budget; the restricted member adds a site to their own project.
    await post(ctx.tokens.manager, "/work-locations", { ...body, name: "South gate", newProject: { name: "Bridge works" } }).expect(201);
    const scopedSite = (await post(ctx.tokens.scoped, "/work-locations", { ...body, name: "East ramp", projectId: ctx.projectA.id }).expect(201)).body;
    expect(scopedSite).toMatchObject({ projectId: ctx.projectA.id, projectName: "Project A" });

    // Editing: only what changes, each field audited with the reason; the radius makes geofence version 2.
    const siteId: string = created.body.id;
    await patch(ctx.tokens.manager, `/work-locations/${siteId}`, { name: "North junction" }).expect(400);
    await patch(ctx.tokens.manager, `/work-locations/${siteId}`, { name: "  " }).expect(400);
    const edited = await patch(ctx.tokens.manager, `/work-locations/${siteId}`, { geofenceRadiusMeters: 200, instructions: "Use the east gate", address: null, reason: "The lane moved" }).expect(200);
    expect(edited.body).toMatchObject({ address: null, instructions: "Use the east gate", geofence: { radiusMeters: 200, version: 2 } });
    const updates = await prisma.auditLog.findMany({ where: { action: "SITE_UPDATED", entityId: siteId }, orderBy: { sequenceNumber: "asc" } });
    expect(updates.map((row) => ({ field: row.field, oldValue: row.oldValue, newValue: row.newValue, reason: row.reason, actorUserId: row.actorUserId }))).toEqual([
      { field: "address", oldValue: "Route 4, km 12", newValue: null, reason: "The lane moved", actorUserId: ctx.manager.user.id },
      { field: "instructions", oldValue: "Enter from the service road", newValue: "Use the east gate", reason: "The lane moved", actorUserId: ctx.manager.user.id },
      { field: "defaultGeofenceRadiusMeters", oldValue: "150", newValue: "200", reason: "The lane moved", actorUserId: ctx.manager.user.id },
    ]);
    // A text-only edit keeps the geofence; moving the pin is version 3 at the new center.
    expect((await patch(ctx.tokens.manager, `/work-locations/${siteId}`, { emergencyContact: "052-1111111" }).expect(200)).body.geofence).toMatchObject({ version: 2 });
    expect((await patch(ctx.tokens.manager, `/work-locations/${siteId}`, { latitude: 32.31, longitude: 34.91 }).expect(200)).body.geofence).toEqual({
      id: expect.any(String),
      centerLatitude: 32.31,
      centerLongitude: 34.91,
      radiusMeters: 200,
      version: 3,
    });

    // The restricted member: their project's sites only.
    await get(ctx.tokens.scoped, `/work-locations/${siteId}`).expect(404);
    await patch(ctx.tokens.scoped, `/work-locations/${ctx.siteB.id}`, { name: "Renamed" }).expect(404);
    await get(ctx.tokens.scoped, `/work-locations/${scopedSite.id}`).expect(200);
  });

  it("a new shift with its workers: conflicts are listed beforehand and refused together; the shift takes its site's project and geofence", async () => {
    const ctx = await setup();
    // Worker B's shift moves to tomorrow: only worker A is busy during the new shift.
    const tomorrow = (hours: number) => new Date(Date.now() + (24 + hours) * 3_600_000);
    await prisma.shift.update({ where: { id: ctx.shiftB.id }, data: { scheduledStart: tomorrow(0), scheduledEnd: tomorrow(8) } });
    const shiftA = await prisma.shift.findUniqueOrThrow({ where: { id: ctx.shiftA.id } });
    const start = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const end = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const window = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const busyA = { shiftId: shiftA.id, title: "Shift of project A", scheduledStart: shiftA.scheduledStart.toISOString(), scheduledEnd: shiftA.scheduledEnd.toISOString() };

    expect((await get(ctx.tokens.manager, `/shifts/assignable-workers?${window}`).expect(200)).body).toEqual([
      { workerProfileId: ctx.workerA.workerProfile.id, fullLegalName: "Worker Alpha", conflicts: [busyA] },
      { workerProfileId: ctx.workerB.workerProfile.id, fullLegalName: "Worker Beta", conflicts: [] },
    ]);
    expect((await get(ctx.tokens.scoped, `/shifts/assignable-workers?${window}`).expect(200)).body.map((row: { workerProfileId: string }) => row.workerProfileId)).toEqual([
      ctx.workerA.workerProfile.id,
    ]);
    await get(ctx.tokens.manager, "/shifts/assignable-workers").expect(400);
    await get(ctx.tokens.manager, `/shifts/assignable-workers?start=${encodeURIComponent(end)}&end=${encodeURIComponent(start)}`).expect(400);
    await get(ctx.tokens.workerA, `/shifts/assignable-workers?${window}`).expect(403);

    // A member who plans shifts without managing sites still picks the site.
    await get(ctx.tokens.planner, "/sites").expect(200);
    await get(ctx.tokens.accountant, "/sites").expect(403);

    const shiftsBefore = await prisma.shift.count();
    const body = { siteId: ctx.siteA.id, shiftType: "STANDARD", title: "Night lane closure", scheduledStart: start, scheduledEnd: end, checkInMethod: "GEOFENCED" };
    const refused = await post(ctx.tokens.manager, "/shifts", { ...body, workerProfileIds: [ctx.workerA.workerProfile.id, ctx.workerB.workerProfile.id] }).expect(409);
    expect(refused.body.code).toBe("SHIFT_ASSIGNMENT_CONFLICT");
    expect(refused.body.details.conflicts).toEqual([{ workerProfileId: ctx.workerA.workerProfile.id, shifts: [busyA] }]);
    await post(ctx.tokens.manager, "/shifts", { ...body, workerProfileIds: [uuidv7()] }).expect(404);
    await post(ctx.tokens.manager, "/shifts", { ...body, workerProfileIds: ["not-an-id"] }).expect(400);
    await post(ctx.tokens.scoped, "/shifts", { ...body, siteId: ctx.siteB.id, workerProfileIds: [] }).expect(403);
    expect(await prisma.shift.count()).toBe(shiftsBefore);

    const created = (await post(ctx.tokens.manager, "/shifts", { ...body, workerProfileIds: [ctx.workerB.workerProfile.id] }).expect(201)).body;
    expect(created).toMatchObject({
      projectId: ctx.projectA.id,
      siteId: ctx.siteA.id,
      geofenceId: ctx.geofenceA.id,
      status: "PUBLISHED",
      managerId: ctx.manager.user.id,
      checkInMethod: "GEOFENCED",
      title: "Night lane closure",
    });
    expect((await prisma.shiftAssignment.findMany({ where: { shiftId: created.id } })).map((row) => [row.workerProfileId, row.assignedBy])).toEqual([
      [ctx.workerB.workerProfile.id, ctx.manager.user.id],
    ]);
    const told = (await notificationsOf(ctx.tokens.workerB)).filter((row) => row.type === "TURAN_ASSIGNMENT_CREATED").map((row) => row.dataJson);
    expect(told).toEqual([{ assignmentKind: "SHIFT", shiftId: created.id, shiftTitle: "Night lane closure", startAt: start, endAt: end }]);
    expect(await prisma.auditLog.count({ where: { action: "SHIFT_CREATED", entityId: created.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "SHIFT_WORKER_ASSIGNED" } })).toBe(1);
  });

  it("an entry's photo opens on its own, within the member's projects, and every view is audited", async () => {
    const ctx = await setup();
    const entryA = await workDay(ctx, "A");
    const entryB = await workDay(ctx, "B");
    const photo = await prisma.fileAsset.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.organizationId,
        purpose: "ATTENDANCE_PHOTO",
        storageKey: `attendance/${ctx.organizationId}/${entryB}/${uuidv7()}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: BASELINE_JPEG.length,
        sha256: "0".repeat(64),
        scanResult: "CLEAN",
        timeEntryId: entryB,
        workerProfileId: ctx.workerB.workerProfile.id,
      },
    });
    // The evidence lists it without any address to open it.
    expect((await get(ctx.tokens.manager, `/time-entries/${entryB}/evidence`).expect(200)).body.photos).toEqual([
      { id: photo.id, contentType: "image/jpeg", uploadedAt: photo.createdAt.toISOString(), eventType: null },
    ]);

    const path = `/time-entries/${entryB}/photos/${photo.id}/view-url`;
    const view = await get(ctx.tokens.manager, path).expect(200);
    expect(view.headers["cache-control"]).toBe("no-store");
    expect(view.body).toEqual({ url: expect.stringMatching(/^https?:\/\//), expiresInSeconds: expect.any(Number), contentType: "image/jpeg" });
    expect(await prisma.auditLog.count({ where: { action: "FILE_ASSET_VIEWED", entityId: photo.id, actorUserId: ctx.manager.user.id } })).toBe(1);

    await get(ctx.tokens.scoped, path).expect(404);
    await get(ctx.tokens.workerB, path).expect(403);
    await get(ctx.tokens.manager, `/time-entries/${entryB}/photos/${uuidv7()}/view-url`).expect(404);
    await get(ctx.tokens.manager, `/time-entries/${entryA}/photos/${photo.id}/view-url`).expect(404);
    expect(await prisma.auditLog.count({ where: { action: "FILE_ASSET_VIEWED" } })).toBe(1);
  });

  it("a worker's offline records for the review screen: one worker's, within the member's projects; a worker only ever gets their own", async () => {
    const ctx = await setup();
    const entryA = await workDay(ctx, "A");
    const batch = (workerProfileId: string, status: "REJECTED" | "FLAGGED", resultTimeEntryId: string | null) =>
      prisma.offlineSyncBatch.create({
        data: {
          id: uuidv7(),
          organizationId: ctx.organizationId,
          workerProfileId,
          deviceId: "device-1",
          eventCount: 1,
          events: {
            create: [
              {
                id: uuidv7(),
                clientEventId: uuidv7(),
                eventType: "CLOCK_IN",
                deviceTimestamp: new Date(),
                status,
                rejectionReason: status === "REJECTED" ? "OUTSIDE_GEOFENCE" : null,
                resultTimeEntryId,
                payload: {},
              },
            ],
          },
        },
      });
    const ofA = await batch(ctx.workerA.workerProfile.id, "FLAGGED", entryA);
    const ofB = await batch(ctx.workerB.workerProfile.id, "REJECTED", null);
    const ids = (body: { id: string }[]) => body.map((row) => row.id);

    const forA = (await get(ctx.tokens.manager, `/offline-sync/batches?workerProfileId=${ctx.workerA.workerProfile.id}`).expect(200)).body;
    expect(ids(forA)).toEqual([ofA.id]);
    expect(forA[0].events).toEqual([expect.objectContaining({ status: "FLAGGED", resultTimeEntryId: entryA })]);
    expect(ids((await get(ctx.tokens.manager, "/offline-sync/batches").expect(200)).body).sort()).toEqual([ofA.id, ofB.id].sort());
    expect(ids((await get(ctx.tokens.scoped, `/offline-sync/batches?workerProfileId=${ctx.workerB.workerProfile.id}`).expect(200)).body)).toEqual([]);
    await get(ctx.tokens.manager, "/offline-sync/batches?workerProfileId=not-an-id").expect(400);
    expect(ids((await get(ctx.tokens.workerA, `/offline-sync/batches?workerProfileId=${ctx.workerB.workerProfile.id}`).expect(200)).body)).toEqual([ofA.id]);
  });
});
