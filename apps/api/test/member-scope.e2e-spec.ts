import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { io, type Socket } from "socket.io-client";
import { v7 as uuidv7 } from "uuid";
import { CorrectionReason, NotificationType, OrgRole, Permission, ShiftStatus } from "@fieldmaster/shared-types";
import { createTestApp, resetDatabase, request, loginAs } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";
import { waitForReport } from "./reports-helpers";

/**
 * A member restricted to some projects (flexible organization model) sees
 * only those projects -- in lists, by id, in the operations page, in reports,
 * in notifications and on the real-time channels -- and has none of the
 * organization-wide permissions, whatever their role says.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_A_PHONE = "+972500010001";
const WORKER_B_PHONE = "+972500010002";
const SCOPED_PHONE = "+972500020001";
const UNSCOPED_PHONE = "+972500020002";

const SITE_A = { lat: 32.0853, lng: 34.7818 };
const SITE_B = { lat: 32.1853, lng: 34.8818 };

/** What a project manager's role holds: operations, attendance, scheduling and sites; plus two organization-wide ones the restriction must take away. */
const PROJECT_MANAGER_PERMISSIONS: Permission[] = [
  Permission.CLOCK_IN_OUT,
  Permission.VIEW_OWN_ATTENDANCE,
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
  Permission.GENERATE_OPERATIONAL_REPORTS,
  Permission.VIEW_ORG_SETTINGS,
  Permission.MANAGE_ORG_USERS,
  Permission.VIEW_AUDIT_LOG,
];

describe("Members restricted to some projects", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => request(http()).post(`/api/v1${path}`).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: object = {}) => request(http()).patch(`/api/v1${path}`).set(auth(token)).send(body);

  function clockEvent(token: string, kind: "clock-in" | "clock-out", site: { lat: number; lng: number }, body: Record<string, unknown>) {
    return post(token, `/clock-events/${kind}`, { clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), latitude: site.lat, longitude: site.lng, accuracyMeters: 10, deviceId: `device-${body.shiftId ?? "x"}`, ...body }).set("Idempotency-Key", uuidv7());
  }

  /** Two projects, each with a site, a shift and a worker; a restricted project manager (project A) and the same role unrestricted. */
  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const projectA = await createProject(prisma, organizationId, "PRJ-A");
    const projectB = await createProject(prisma, organizationId, "PRJ-B");
    await prisma.project.update({ where: { id: projectA.id }, data: { name: "Project A" } });
    await prisma.project.update({ where: { id: projectB.id }, data: { name: "Project B" } });
    const a = await createSiteWithGeofence(prisma, organizationId, projectA.id, SITE_A.lat, SITE_A.lng, 100);
    const b = await createSiteWithGeofence(prisma, organizationId, projectB.id, SITE_B.lat, SITE_B.lng, 100);
    const start = new Date(Date.now() - 3_600_000);
    const end = new Date(Date.now() + 8 * 3_600_000);
    const shiftA = await createStandardShift(prisma, organizationId, projectA.id, a.site.id, a.geofence.id, manager.user.id, start, end);
    const shiftB = await createStandardShift(prisma, organizationId, projectB.id, b.site.id, b.geofence.id, manager.user.id, start, end);
    const workerA = await addWorker(prisma, organizationId, WORKER_A_PHONE, "Worker Alpha", { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
    const workerB = await addWorker(prisma, organizationId, WORKER_B_PHONE, "Worker Beta", { type: "DAILY", dailyRateAgorot: 41_000, overtimeRateAgorot: 6_000 });
    await assignWorkerToShift(prisma, shiftA.id, workerA.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shiftB.id, workerB.workerProfile.id, manager.user.id);
    await prisma.shift.update({ where: { id: shiftA.id }, data: { title: "Shift of project A" } });
    await prisma.shift.update({ where: { id: shiftB.id }, data: { title: "Shift of project B" } });

    const ownerToken = (await loginAs(app, OWNER_PHONE)).accessToken;
    const role = await post(ownerToken, "/roles", { name: "Project manager", permissions: PROJECT_MANAGER_PERMISSIONS }).expect(201);
    const addMember = async (phoneNumber: string, name: string) =>
      (await post(ownerToken, "/memberships", { phoneNumber, fullLegalName: name, roleId: role.body.id }).expect(201)).body.id as string;
    const scopedId = await addMember(SCOPED_PHONE, "Sara Scoped");
    const unscopedId = await addMember(UNSCOPED_PHONE, "Uri Unscoped");
    await patch(ownerToken, `/memberships/${scopedId}/scope`, { restricted: true, projectIds: [projectA.id], reason: "Runs project A" }).expect(200);

    return {
      organizationId,
      owner,
      manager,
      projectA,
      projectB,
      siteA: a.site,
      siteB: b.site,
      shiftA,
      shiftB,
      workerA,
      workerB,
      scopedId,
      unscopedId,
      tokens: {
        owner: ownerToken,
        manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
        workerA: (await loginAs(app, WORKER_A_PHONE)).accessToken,
        workerB: (await loginAs(app, WORKER_B_PHONE)).accessToken,
        scoped: (await loginAs(app, SCOPED_PHONE)).accessToken,
        unscoped: (await loginAs(app, UNSCOPED_PHONE)).accessToken,
      },
    };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** Both workers clock in and out: one pending entry per project. */
  async function workDay(ctx: Ctx) {
    const summary = { summaryText: "Set up the lane closure.", taskCategory: "TRAFFIC_CONTROL" };
    const entries: Record<"A" | "B", string> = { A: "", B: "" };
    for (const [key, token, shift, site] of [
      ["A", ctx.tokens.workerA, ctx.shiftA, SITE_A],
      ["B", ctx.tokens.workerB, ctx.shiftB, SITE_B],
    ] as const) {
      await clockEvent(token, "clock-in", site, { shiftId: shift.id }).expect(201);
      const out = await clockEvent(token, "clock-out", site, summary).expect(201);
      entries[key] = out.body.id;
    }
    return entries;
  }

  it("lists show the member's projects only; the same role without a restriction sees both", async () => {
    const ctx = await setup();
    const entries = await workDay(ctx);
    // A forgotten stamp in each project (the manager corrects the clock-in of each entry).
    for (const entry of [entries.A, entries.B]) {
      await post(ctx.tokens.manager, "/manual-corrections", {
        timeEntryId: entry,
        field: "CLOCK_IN",
        newValue: new Date(Date.now() - 4 * 3_600_000).toISOString(),
        reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
      }).expect(201);
    }

    const names = (body: unknown) => JSON.stringify(body);
    for (const [token, both] of [
      [ctx.tokens.scoped, false],
      [ctx.tokens.unscoped, true],
    ] as const) {
      const shifts = (await get(token, "/shifts").expect(200)).body as { id: string }[];
      expect(shifts.map((shift) => shift.id).sort()).toEqual((both ? [ctx.shiftA.id, ctx.shiftB.id] : [ctx.shiftA.id]).sort());
      const projects = (await get(token, "/projects").expect(200)).body as { id: string }[];
      expect(projects.map((project) => project.id).sort()).toEqual((both ? [ctx.projectA.id, ctx.projectB.id] : [ctx.projectA.id]).sort());
      const sites = (await get(token, "/sites").expect(200)).body as { id: string }[];
      expect(sites.map((site) => site.id).sort()).toEqual((both ? [ctx.siteA.id, ctx.siteB.id] : [ctx.siteA.id]).sort());
      const workers = (await get(token, "/workers").expect(200)).body as { id: string }[];
      expect(workers.map((worker) => worker.id).sort()).toEqual((both ? [ctx.workerA.workerProfile.id, ctx.workerB.workerProfile.id] : [ctx.workerA.workerProfile.id]).sort());
      const attendance = (await get(token, "/attendance/entries?tab=ALL").expect(200)).body as { items: { id: string }[]; tabCounts: { ALL: number } };
      expect(attendance.items.map((item) => item.id).sort()).toEqual((both ? [entries.A, entries.B] : [entries.A]).sort());
      expect(attendance.tabCounts.ALL).toBe(both ? 2 : 1);
      const pending = (await get(token, "/attendance-approvals/pending").expect(200)).body as { id: string }[];
      expect(pending.map((entry) => entry.id).sort()).toEqual((both ? [entries.A, entries.B] : [entries.A]).sort());
      const own = (await get(token, "/time-entries").expect(200)).body as { id: string }[];
      expect(own.map((entry) => entry.id).sort()).toEqual((both ? [entries.A, entries.B] : [entries.A]).sort());
      const stamps = (await get(token, "/forgotten-stamp-infractions").expect(200)).body as { timeEntry: { id: string } }[];
      expect(stamps.map((stamp) => stamp.timeEntry.id).sort()).toEqual((both ? [entries.A, entries.B] : [entries.A]).sort());
      expect(names(shifts) + names(attendance) + names(stamps)).toEqual(both ? expect.stringContaining("Worker Beta") : expect.not.stringContaining("Worker Beta"));
    }
    // The live operations page of the restricted member has none of project B's workers, shifts or places.
    const live = (await get(ctx.tokens.scoped, "/operations/live").expect(200)).body;
    expect(JSON.stringify(live)).not.toMatch(/Worker Beta|Shift of project B/);
    const liveUnscoped = (await get(ctx.tokens.unscoped, "/operations/live").expect(200)).body;
    expect(JSON.stringify(liveUnscoped)).toMatch(/Shift of project B/);
    expect((live as { activeShifts: { id: string }[] }).activeShifts.map((shift) => shift.id)).toEqual([ctx.shiftA.id]);
    expect((live as { sites: { siteId: string }[] }).sites.map((site) => site.siteId)).toEqual([ctx.siteA.id]);
  });

  it("another project's records are not found by id, and cannot be changed", async () => {
    const ctx = await setup();
    const entries = await workDay(ctx);
    const scoped = ctx.tokens.scoped;
    for (const path of [
      `/shifts/${ctx.shiftB.id}`,
      `/shifts/${ctx.shiftB.id}/temporary-supervisors`,
      `/shifts/${ctx.shiftB.id}/temporary-check-in-points`,
      `/sites/${ctx.siteB.id}`,
      `/projects/${ctx.projectB.id}`,
      `/workers/${ctx.workerB.workerProfile.id}`,
      `/time-entries/${entries.B}`,
      `/time-entries/${entries.B}/evidence`,
    ]) {
      expect({ path, status: (await get(scoped, path)).status }).toEqual({ path, status: 404 });
    }
    expect((await get(scoped, `/sites/${ctx.siteB.id}/geofences`).expect(200)).body).toEqual([]);
    // Their own project's records are there.
    for (const path of [`/shifts/${ctx.shiftA.id}`, `/sites/${ctx.siteA.id}`, `/projects/${ctx.projectA.id}`, `/workers/${ctx.workerA.workerProfile.id}`, `/time-entries/${entries.A}`, `/time-entries/${entries.A}/evidence`]) {
      expect({ path, status: (await get(scoped, path)).status }).toEqual({ path, status: 200 });
    }

    // Changes: another project's entry, shift and worker assignment answer 404; a shift in another project is refused.
    expect((await post(scoped, `/time-entries/${entries.B}/approve`).expect(404)).body.code).toBe("NOT_FOUND");
    await post(scoped, `/time-entries/${entries.B}/reject`, { reason: "No" }).expect(404);
    await post(scoped, `/time-entries/${entries.B}/request-correction`, { notes: "Check" }).expect(404);
    await post(scoped, `/time-entries/${entries.B}/full-day-credit`, { reason: "Rain" }).expect(404);
    await post(scoped, "/manual-corrections", { timeEntryId: entries.B, field: "CLOCK_IN", newValue: new Date().toISOString(), reason: CorrectionReason.DEVICE_FAILURE }).expect(404);
    await post(scoped, `/shifts/${ctx.shiftB.id}/assignments`, { workerProfileId: ctx.workerA.workerProfile.id }).expect(404);
    await post(scoped, `/shifts/${ctx.shiftB.id}/close`).expect(404);
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entries.B } })).status).toBe("PENDING_APPROVAL");
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: ctx.shiftB.id } })).status).toBe(ShiftStatus.PUBLISHED);

    const shiftBody = { shiftType: "STANDARD", title: "New shift", scheduledStart: new Date(Date.now() + 86_400_000).toISOString(), scheduledEnd: new Date(Date.now() + 2 * 86_400_000).toISOString() };
    await post(scoped, "/shifts", { ...shiftBody, projectId: ctx.projectB.id, siteId: ctx.siteB.id }).expect(403);
    await post(scoped, "/shifts", { ...shiftBody, projectId: ctx.projectA.id, siteId: ctx.siteA.id }).expect(201);
    expect((await post(scoped, "/projects", { name: "New project", projectCode: "NEW" }).expect(403)).body.code).toBe("SCOPE_RESTRICTED");
    await post(scoped, "/sites", { projectId: ctx.projectB.id, name: "New site", latitude: 32, longitude: 34 }).expect(404);
    // Approving their own project's entry works, as for the unrestricted copy of the role.
    await post(scoped, `/time-entries/${entries.A}/approve`).expect(201);
    await post(ctx.tokens.unscoped, `/time-entries/${entries.B}/approve`).expect(201);
  });

  it("the organization-wide permissions of the role are gone while restricted, and come back when the restriction is lifted", async () => {
    const ctx = await setup();
    const me = await get(ctx.tokens.scoped, "/auth/me").expect(200);
    expect(me.body.scope).toEqual({ restricted: true, projectIds: [ctx.projectA.id], siteIds: [ctx.siteA.id], visibleProjectIds: [ctx.projectA.id] });
    expect(me.body.permissions).not.toContain(Permission.MANAGE_ORG_USERS);
    expect(me.body.permissions).not.toContain(Permission.VIEW_AUDIT_LOG);
    expect(me.body.permissions).toContain(Permission.MANAGE_SHIFTS);
    for (const path of ["/memberships", "/audit-logs", "/roles"]) expect({ path, status: (await get(ctx.tokens.scoped, path)).status }).toEqual({ path, status: 403 });
    for (const path of ["/memberships", "/audit-logs", "/roles"]) expect({ path, status: (await get(ctx.tokens.unscoped, path)).status }).toEqual({ path, status: 200 });

    await patch(ctx.tokens.owner, `/memberships/${ctx.scopedId}/scope`, { restricted: false, reason: "Now runs everything" }).expect(200);
    await get(ctx.tokens.scoped, "/memberships").expect(200);
    expect((await get(ctx.tokens.scoped, "/shifts").expect(200)).body).toHaveLength(2);
    const audit = await prisma.auditLog.findMany({ where: { action: "MEMBERSHIP_SCOPE_CHANGED", entityId: ctx.scopedId }, orderBy: { sequenceNumber: "asc" } });
    expect(audit.map((row) => [row.oldValue, row.newValue, row.reason])).toEqual([
      ["all", `projects:${ctx.projectA.id};sites:`, "Runs project A"],
      [`projects:${ctx.projectA.id};sites:`, "all", "Now runs everything"],
    ]);

    // A scope needs something in it, and only things of this organization.
    await patch(ctx.tokens.owner, `/memberships/${ctx.scopedId}/scope`, { restricted: true, reason: "Nothing" }).expect(400);
    expect((await patch(ctx.tokens.owner, `/memberships/${ctx.scopedId}/scope`, { restricted: true, projectIds: [uuidv7()], reason: "Ghost" }).expect(404)).body.code).toBe("SCOPE_TARGET_NOT_FOUND");
    // One site of a project is enough: the member then sees the project and that site only.
    await patch(ctx.tokens.owner, `/memberships/${ctx.scopedId}/scope`, { restricted: true, siteIds: [ctx.siteB.id], reason: "One site" }).expect(200);
    expect((await get(ctx.tokens.scoped, "/projects").expect(200)).body.map((project: { id: string }) => project.id)).toEqual([ctx.projectB.id]);
    expect((await get(ctx.tokens.scoped, "/sites").expect(200)).body.map((site: { id: string }) => site.id)).toEqual([ctx.siteB.id]);
  });

  it("reports of a restricted member contain their projects only, and the organization-wide ones are refused", async () => {
    const ctx = await setup();
    await workDay(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const filters = { fromDate: today, toDate: today };
    const request1 = await post(ctx.tokens.scoped, "/reports", { reportType: "OPERATIONAL_ATTENDANCE", filters }).set("Idempotency-Key", uuidv7()).expect(202);
    const report = await waitForReport(app, ctx.tokens.scoped, request1.body.id);
    expect(report.status).toBe("READY");
    // The scope travels with the report to the job; it is not part of what clients see.
    expect(report.filters).toEqual(filters);
    const download = await get(ctx.tokens.scoped, `/reports/${request1.body.id}/download?format=csv`).expect(200);
    const csv = await (await fetch(download.body.downloadUrl)).text();
    expect(csv).toContain("Worker Alpha");
    expect(csv).not.toContain("Worker Beta");

    // The same request unrestricted has both.
    const full = await post(ctx.tokens.unscoped, "/reports", { reportType: "OPERATIONAL_ATTENDANCE", filters }).set("Idempotency-Key", uuidv7()).expect(202);
    expect((await waitForReport(app, ctx.tokens.unscoped, full.body.id)).status).toBe("READY");
    const fullCsv = await (await fetch((await get(ctx.tokens.unscoped, `/reports/${full.body.id}/download?format=csv`).expect(200)).body.downloadUrl)).text();
    expect(fullCsv).toContain("Worker Alpha");
    expect(fullCsv).toContain("Worker Beta");

    // Another project's filter, worker or site: not found. The organization-wide reports: refused.
    await post(ctx.tokens.scoped, "/reports", { reportType: "OPERATIONAL_ATTENDANCE", filters: { ...filters, projectId: ctx.projectB.id } }).set("Idempotency-Key", uuidv7()).expect(404);
    await post(ctx.tokens.scoped, "/reports", { reportType: "OPERATIONAL_ATTENDANCE", filters: { ...filters, workerProfileId: ctx.workerB.workerProfile.id } }).set("Idempotency-Key", uuidv7()).expect(404);
    await post(ctx.tokens.scoped, "/reports", { reportType: "WORKER_ATTENDANCE_LEDGER", filters: { ...filters, workerProfileId: ctx.workerB.workerProfile.id } }).set("Idempotency-Key", uuidv7()).expect(404);
    const emergency = await post(ctx.tokens.scoped, "/reports", { reportType: "EMERGENCY_CALLOUTS", filters }).set("Idempotency-Key", uuidv7()).expect(403);
    expect(emergency.body.code).toBe("SCOPE_RESTRICTED");
    await post(ctx.tokens.scoped, "/reports", { reportType: "PAYROLL", filters: { yearMonth: today.slice(0, 7) } }).set("Idempotency-Key", uuidv7()).expect(403);
    // Nobody else sees the restricted member's report but them and whoever may generate the financial ones.
    await get(ctx.tokens.unscoped, `/reports/${request1.body.id}`).expect(404);
    await get(ctx.tokens.owner, `/reports/${request1.body.id}`).expect(200);
  });

  it("notifications about another project never reach a restricted member, and an old one is hidden from the list", async () => {
    const ctx = await setup();
    await clockEvent(ctx.tokens.workerA, "clock-in", SITE_A, { shiftId: ctx.shiftA.id }).expect(201);
    await clockEvent(ctx.tokens.workerB, "clock-in", SITE_B, { shiftId: ctx.shiftB.id }).expect(201);

    const clockedIn = (body: { type: string; dataJson: { shiftId?: string } }[]) => body.filter((n) => n.type === NotificationType.WORKER_CLOCKED_IN).map((n) => n.dataJson.shiftId);
    const scopedList = (await get(ctx.tokens.scoped, "/notifications").expect(200)).body;
    expect(clockedIn(scopedList)).toEqual([ctx.shiftA.id]);
    expect(clockedIn((await get(ctx.tokens.unscoped, "/notifications").expect(200)).body).sort()).toEqual([ctx.shiftA.id, ctx.shiftB.id].sort());

    // A notification created before the restriction (about project B) is hidden too.
    await app.get(NotificationsService).notify({
      organizationId: ctx.organizationId,
      recipientUserId: (await prisma.organizationMembership.findUniqueOrThrow({ where: { id: ctx.scopedId } })).userId,
      type: NotificationType.WORKER_CLOCKED_OUT,
      title: "Older",
      body: "About project B",
      data: { shiftId: ctx.shiftB.id },
    });
    expect((await get(ctx.tokens.scoped, "/notifications").expect(200)).body.some((n: { title: string }) => n.title === "Older")).toBe(false);
    expect(await prisma.notification.count({ where: { title: "Older" } })).toBe(1);
  });

  it("the live channel of a restricted member carries only the events of their projects", async () => {
    const ctx = await setup();
    const connect = async (token: string) => {
      const events: { kind: string }[] = [];
      const socket: Socket = io(`${baseUrl}/notifications`, { auth: { token }, transports: ["websocket"], reconnection: false });
      socket.on("operations", (payload) => events.push(payload));
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      return { socket, events };
    };
    const scoped = await connect(ctx.tokens.scoped);
    const unscoped = await connect(ctx.tokens.unscoped);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      // An event of project B: the unrestricted copy of the role hears it, the restricted member does not.
      await clockEvent(ctx.tokens.workerB, "clock-in", SITE_B, { shiftId: ctx.shiftB.id }).expect(201);
      await pause(800);
      expect(unscoped.events.length).toBeGreaterThan(0);
      expect(scoped.events).toEqual([]);
      // An event of project A reaches both.
      await clockEvent(ctx.tokens.workerA, "clock-in", SITE_A, { shiftId: ctx.shiftA.id }).expect(201);
      await pause(800);
      expect(scoped.events.map((event) => event.kind)).toEqual(["CLOCK_IN"]);
    } finally {
      scoped.socket.disconnect();
      unscoped.socket.disconnect();
    }
  });

  it("a restricted member cannot see the Turan rota's call-outs or the onboarding applicants, and a worker in their project still can't read other workers' pay", async () => {
    const ctx = await setup();
    expect((await get(ctx.tokens.scoped, "/emergency-callouts").expect(200)).body).toMatchObject({ items: [], total: 0 });
    expect(JSON.stringify((await get(ctx.tokens.scoped, "/workers").expect(200)).body)).not.toMatch(/compensation|Agorot/);
    expect((await get(ctx.tokens.scoped, "/auth/me").expect(200)).body.role).toBe(OrgRole.CUSTOM);
    await get(ctx.tokens.scoped, "/workers/pending-approval").expect(403);
  });
});
