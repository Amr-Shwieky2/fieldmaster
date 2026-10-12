import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import {
  AccountStatus,
  AttendanceFlag,
  LocationValidationStatus,
  NotificationType,
  ShiftStatus,
  ShiftWorkerPresence,
  TemporaryPointStatus,
  TemporarySupervisorState,
} from "@fieldmaster/shared-types";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";

/**
 * Step 6: temporary supervisors -- a worker of a shift who, for a time
 * window, sees that shift's workers (operational data only: no money, no
 * phone numbers), may open and close its temporary check-in points, and can
 * report an issue to management. The capability is checked live on every
 * call: revoking it, its window ending or the shift closing ends access at once.
 */

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~300 m north of the site center: outside the 100 m geofence. The temporary point is opened here.
const POINT_LAT = 32.088;
// ~2.2 km north: a second site.
const OTHER_SITE_LAT = 32.105;

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const OTHER_MANAGER_PHONE = "+972500000012";
const SUPERVISOR_PHONE = "+972500010001";
const WORKER_PHONE = "+972500010002";
const OTHER_SUPERVISOR_PHONE = "+972500010003";
const OFF_SHIFT_PHONE = "+972500010004";
const OTHER_ORG_OWNER_PHONE = "+972500000099";
const OTHER_ORG_WORKER_PHONE = "+972500010099";

/**
 * The financial leak scanner's rule (financial-leak-scanner.e2e-spec.ts): a key is forbidden if it ends in
 * "Agorot" or "rate" (rate, hourlyRate, dailyRate, overtimeRate, ...) or contains one of these words, case-insensitively.
 */
const FORBIDDEN_KEY_PARTS = ["budget", "bank", "accountnumber", "branch", "netpay", "grosspay", "estimatedcost", "amount"];

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.endsWith("agorot") || lower.endsWith("rate") || FORBIDDEN_KEY_PARTS.some((part) => lower.includes(part));
}

/** JSON paths (e.g. `$.workers[0].phoneNumber`) of every key of `value`, at any depth, that `matches`. */
function findKeys(value: unknown, matches: (key: string) => boolean, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findKeys(item, matches, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [...(matches(key) ? [`${path}.${key}`] : []), ...findKeys(nested, matches, `${path}.${key}`)]);
}

const findForbiddenKeys = (value: unknown) => findKeys(value, isForbiddenKey);
const findPhoneKeys = (value: unknown) => findKeys(value, (key) => key.toLowerCase().includes("phone"));

interface ShiftViewWorker {
  workerProfileId: string;
  fullLegalName: string;
}

const byName = (a: ShiftViewWorker, b: ShiftViewWorker) => a.fullLegalName.localeCompare(b.fullLegalName);

/** A worker of the shift as the supervisor sees them before they clock in. */
const notClockedIn = (workerProfileId: string, fullLegalName: string) => ({
  workerProfileId,
  fullLegalName,
  presence: ShiftWorkerPresence.NOT_CLOCKED_IN,
  clockInAt: null,
  clockOutAt: null,
  locationOutcome: null,
  flags: [],
});

describe("Temporary supervisors API (Step 6)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  const http = () => app.getHttpServer();
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(http()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", uuidv7()).send(body);
  const del = (token: string, path: string) => request(http()).delete(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);

  const assignPath = (shiftId: string) => `/shifts/${shiftId}/temporary-supervisors`;
  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  /** The response has this status and error code. */
  async function expectError(pending: PromiseLike<{ status: number; body: { code?: string } }>, status: number, code: string) {
    const response = await pending;
    expect({ status: response.status, code: response.body.code }).toEqual({ status, code });
  }

  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    // Rates and a project budget: money a leak would show.
    const supervisor = await addWorker(prisma, organizationId, SUPERVISOR_PHONE, "Sami Supervisor", {
      type: "HOURLY",
      hourlyRateAgorot: 6_000,
      overtimeRateAgorot: 9_000,
    });
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker", { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
    const project = await createProject(prisma, organizationId, "PRJ-MAIN");
    await prisma.project.update({ where: { id: project.id }, data: { budgetAgorot: 50_000_000 } });
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const start = inMinutes(-60);
    const end = inMinutes(8 * 60);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, start, end);
    await assignWorkerToShift(prisma, shift.id, supervisor.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);

    const tokens = {
      owner: (await loginAs(app, OWNER_PHONE)).accessToken,
      manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
      supervisor: (await loginAs(app, SUPERVISOR_PHONE)).accessToken,
      worker: (await loginAs(app, WORKER_PHONE)).accessToken,
    };
    return { organizationId, owner, manager, supervisor, worker, project, site, geofence, shift, start, end, tokens };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  /** A second organization, with its own shift and worker, whose people must never reach the first one's. */
  async function otherOrganization() {
    const owner = await createOrgWithOwner(prisma, OTHER_ORG_OWNER_PHONE, "Other Owner");
    const worker = await addWorker(prisma, owner.org.id, OTHER_ORG_WORKER_PHONE, "Other Worker");
    const project = await createProject(prisma, owner.org.id, "PRJ-OTHER-ORG");
    const { site, geofence } = await createSiteWithGeofence(prisma, owner.org.id, project.id, SITE_LAT, SITE_LNG, 100);
    const shift = await createStandardShift(prisma, owner.org.id, project.id, site.id, geofence.id, owner.user.id, inMinutes(-60), inMinutes(8 * 60));
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, owner.user.id);
    const tokens = { owner: (await loginAs(app, OTHER_ORG_OWNER_PHONE)).accessToken, worker: (await loginAs(app, OTHER_ORG_WORKER_PHONE)).accessToken };
    return { owner, worker, shift, tokens };
  }

  /** A worker of the organization assigned to the context's shift. */
  async function addCrewMember(ctx: Context, phoneNumber: string, name: string) {
    const member = await addWorker(prisma, ctx.organizationId, phoneNumber, name);
    await assignWorkerToShift(prisma, ctx.shift.id, member.workerProfile.id, ctx.manager.user.id);
    return member;
  }

  function clockIn(token: string, body: { shiftId: string; latitude: number } & Record<string, unknown>) {
    return post(token, "/clock-events/clock-in", {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      longitude: SITE_LNG,
      accuracyMeters: 10,
      ...body,
    });
  }

  const pointBody = (shiftId: string, name = "Bridge north") => ({ shiftId, name, latitude: POINT_LAT, longitude: SITE_LNG });

  it("assigning: managers only, an open shift, an active time-trackable worker of that shift, a window ending in the future, no overlap", async () => {
    const ctx = await setup();
    const path = assignPath(ctx.shift.id);
    const supervisorId = ctx.supervisor.workerProfile.id;

    // Workers -- the supervisor-to-be included -- may not assign, list or revoke.
    for (const token of [ctx.tokens.worker, ctx.tokens.supervisor]) {
      await expectError(post(token, path, { workerProfileId: supervisorId }), 403, "FORBIDDEN");
      await expectError(get(token, path), 403, "FORBIDDEN");
      await expectError(del(token, `/shifts/temporary-supervisors/${uuidv7()}`), 403, "FORBIDDEN");
    }

    // An unknown shift or worker, or another organization's: 404.
    const other = await otherOrganization();
    await expectError(post(ctx.tokens.manager, assignPath(uuidv7()), { workerProfileId: supervisorId }), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, assignPath("not-a-uuid"), { workerProfileId: supervisorId }), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, assignPath(other.shift.id), { workerProfileId: supervisorId }), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, assignPath(other.shift.id), { workerProfileId: other.worker.workerProfile.id }), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, path, { workerProfileId: uuidv7() }), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, path, { workerProfileId: other.worker.workerProfile.id }), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, path, { workerProfileId: "not-a-uuid" }), 400, "VALIDATION_FAILED");

    // Not an active, time-trackable worker assigned to this shift: 409.
    const notOnShift = await addWorker(prisma, ctx.organizationId, "+972500010011", "Not On Shift");
    const removed = await addCrewMember(ctx, "+972500010012", "Removed Worker");
    await prisma.shiftAssignment.updateMany({ where: { shiftId: ctx.shift.id, workerProfileId: removed.workerProfile.id }, data: { removedAt: new Date() } });
    const untracked = await addCrewMember(ctx, "+972500010013", "Untracked Worker");
    await prisma.organizationMembership.update({ where: { id: untracked.membership.id }, data: { isTimeTrackable: false } });
    const suspended = await addCrewMember(ctx, "+972500010014", "Suspended Worker");
    await prisma.organizationMembership.update({ where: { id: suspended.membership.id }, data: { status: AccountStatus.SUSPENDED } });
    const archived = await addCrewMember(ctx, "+972500010015", "Archived Worker");
    await prisma.organizationMembership.update({ where: { id: archived.membership.id }, data: { status: AccountStatus.ARCHIVED, archivedAt: new Date() } });
    for (const candidate of [notOnShift, removed, untracked, suspended, archived]) {
      await expectError(post(ctx.tokens.manager, path, { workerProfileId: candidate.workerProfile.id }), 409, "TEMPORARY_SUPERVISOR_NOT_ON_SHIFT");
    }

    // A closed or cancelled shift: 409, even for a worker assigned to it.
    for (const status of [ShiftStatus.CLOSED, ShiftStatus.CANCELLED]) {
      const ended = await createStandardShift(
        prisma,
        ctx.organizationId,
        ctx.project.id,
        ctx.site.id,
        ctx.geofence.id,
        ctx.manager.user.id,
        ctx.start,
        ctx.end,
      );
      await assignWorkerToShift(prisma, ended.id, supervisorId, ctx.manager.user.id);
      await prisma.shift.update({ where: { id: ended.id }, data: { status } });
      await expectError(post(ctx.tokens.manager, assignPath(ended.id), { workerProfileId: supervisorId }), 409, "SHIFT_NOT_OPEN");
    }

    // The window must end after it starts, and in the future: 400.
    const sameInstant = inMinutes(60).toISOString();
    const badWindows = [
      { activatedAt: inMinutes(120).toISOString(), expiresAt: inMinutes(60).toISOString() },
      { activatedAt: sameInstant, expiresAt: sameInstant },
      { activatedAt: inMinutes(-180).toISOString(), expiresAt: inMinutes(-60).toISOString() },
      // Starts now by default: an end in the past is before it.
      { expiresAt: inMinutes(-1).toISOString() },
    ];
    for (const window of badWindows) {
      await expectError(post(ctx.tokens.manager, path, { workerProfileId: supervisorId, ...window }), 400, "VALIDATION_FAILED");
    }
    await expectError(post(ctx.tokens.manager, path, { workerProfileId: supervisorId, activatedAt: "yesterday" }), 400, "VALIDATION_FAILED");
    expect(await prisma.temporarySupervisorAssignment.count()).toBe(0);

    // Assigned by the Field Manager: from now until the shift's scheduled end, allowed to open points by default.
    const requestedAt = Date.now();
    const assigned = await post(ctx.tokens.manager, path, { workerProfileId: supervisorId }).expect(201);
    expect(assigned.body).toEqual({
      id: expect.any(String),
      shiftId: ctx.shift.id,
      workerProfileId: supervisorId,
      activatedAt: expect.any(String),
      expiresAt: ctx.end.toISOString(),
      revokedAt: null,
      revokedBy: null,
      assignedBy: ctx.manager.user.id,
      canOpenCheckInPoints: true,
      createdAt: expect.any(String),
    });
    const activatedAt = new Date(assigned.body.activatedAt).getTime();
    expect(activatedAt).toBeGreaterThanOrEqual(requestedAt);
    expect(activatedAt).toBeLessThanOrEqual(Date.now());

    // The same worker again for an overlapping time: 409, whoever asks.
    for (const token of [ctx.tokens.manager, ctx.tokens.owner]) {
      await expectError(
        post(token, path, { workerProfileId: supervisorId, activatedAt: inMinutes(60).toISOString(), expiresAt: inMinutes(120).toISOString() }),
        409,
        "TEMPORARY_SUPERVISOR_ALREADY_ASSIGNED",
      );
    }

    // Another worker of the shift, by the Owner, without the right to open points.
    const second = await post(ctx.tokens.owner, path, { workerProfileId: ctx.worker.workerProfile.id, canOpenCheckInPoints: false }).expect(201);
    expect(second.body).toMatchObject({ workerProfileId: ctx.worker.workerProfile.id, canOpenCheckInPoints: false, assignedBy: ctx.owner.user.id });

    // The shift's list (newest first), the same for the Owner and the Field Manager: both ACTIVE.
    const list = await get(ctx.tokens.manager, path).expect(200);
    expect(list.body).toEqual([
      {
        id: second.body.id,
        shiftId: ctx.shift.id,
        worker: { id: ctx.worker.workerProfile.id, fullLegalName: "Eli Worker" },
        activatedAt: second.body.activatedAt,
        expiresAt: ctx.end.toISOString(),
        canOpenCheckInPoints: false,
        state: TemporarySupervisorState.ACTIVE,
        assignedByName: "Dana Owner",
        revokedAt: null,
        revokedByName: null,
        createdAt: second.body.createdAt,
      },
      {
        id: assigned.body.id,
        shiftId: ctx.shift.id,
        worker: { id: supervisorId, fullLegalName: "Sami Supervisor" },
        activatedAt: assigned.body.activatedAt,
        expiresAt: ctx.end.toISOString(),
        canOpenCheckInPoints: true,
        state: TemporarySupervisorState.ACTIVE,
        assignedByName: "Yossi Manager",
        revokedAt: null,
        revokedByName: null,
        createdAt: assigned.body.createdAt,
      },
    ]);
    expect((await get(ctx.tokens.owner, path).expect(200)).body).toEqual(list.body);

    // Only the two assignments exist, each audited once with who made it.
    expect(await prisma.temporarySupervisorAssignment.count()).toBe(2);
    const audit = await prisma.auditLog.findMany({ where: { action: "TEMPORARY_SUPERVISOR_ASSIGNED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(
      audit.map((row) => ({ actorUserId: row.actorUserId, entityType: row.entityType, entityId: row.entityId, field: row.field, newValue: row.newValue })),
    ).toEqual([
      {
        actorUserId: ctx.manager.user.id,
        entityType: "TemporarySupervisorAssignment",
        entityId: assigned.body.id,
        field: "canOpenCheckInPoints",
        newValue: "true",
      },
      {
        actorUserId: ctx.owner.user.id,
        entityType: "TemporarySupervisorAssignment",
        entityId: second.body.id,
        field: "canOpenCheckInPoints",
        newValue: "false",
      },
    ]);
  });

  it("lifecycle: assign, the supervisor's view, a point a worker clocks in at, an issue report, the shift closes and access ends; every step audited", async () => {
    const ctx = await setup();
    // A Field Manager who is not this shift's manager: not told about its issues.
    await addFieldManager(prisma, ctx.organizationId, OTHER_MANAGER_PHONE, "Other Manager");
    const supervisorId = ctx.supervisor.workerProfile.id;
    const workerId = ctx.worker.workerProfile.id;

    // 1. The Field Manager assigns the supervisor.
    const assignment = (await post(ctx.tokens.manager, assignPath(ctx.shift.id), { workerProfileId: supervisorId }).expect(201)).body;
    const viewPath = `/temporary-supervisors/${assignment.id}/shift`;
    const reportPath = `/temporary-supervisors/${assignment.id}/report-issue`;

    // 2. The supervisor sees the assignment and the shift's workers: operational data only.
    const mine = await get(ctx.tokens.supervisor, "/temporary-supervisors/me").expect(200);
    expect(mine.body).toEqual([
      {
        id: assignment.id,
        activatedAt: assignment.activatedAt,
        expiresAt: ctx.end.toISOString(),
        canOpenCheckInPoints: true,
        shift: {
          id: ctx.shift.id,
          title: "Test Shift",
          shiftType: "STANDARD",
          scheduledStart: ctx.start.toISOString(),
          scheduledEnd: ctx.end.toISOString(),
          siteName: "Test Site",
        },
      },
    ]);
    expect((await get(ctx.tokens.worker, "/temporary-supervisors/me").expect(200)).body).toEqual([]);

    const before = await get(ctx.tokens.supervisor, viewPath).expect(200);
    expect({ ...before.body, workers: [...before.body.workers].sort(byName) }).toEqual({
      assignment: { id: assignment.id, activatedAt: assignment.activatedAt, expiresAt: ctx.end.toISOString(), canOpenCheckInPoints: true },
      shift: {
        id: ctx.shift.id,
        title: "Test Shift",
        shiftType: "STANDARD",
        status: ShiftStatus.PUBLISHED,
        scheduledStart: ctx.start.toISOString(),
        scheduledEnd: ctx.end.toISOString(),
        businessDate: ctx.shift.businessDate,
        checkInMethod: "GEOFENCED",
        projectName: "Test Project",
        site: { name: "Test Site", latitude: SITE_LAT, longitude: SITE_LNG },
        geofence: { centerLatitude: SITE_LAT, centerLongitude: SITE_LNG, radiusMeters: 100 },
      },
      workers: [notClockedIn(workerId, "Eli Worker"), notClockedIn(supervisorId, "Sami Supervisor")],
      temporaryCheckInPoints: [],
    });
    expect(findForbiddenKeys(before.body)).toEqual([]);
    expect(findPhoneKeys(before.body)).toEqual([]);
    expect(JSON.stringify(before.body)).not.toContain("+9725");

    // 3. The other worker is at the bridge, outside the shift's geofence: refused, and the supervisor sees it.
    const refused = await clockIn(ctx.tokens.worker, { shiftId: ctx.shift.id, latitude: POINT_LAT }).expect(400);
    expect(refused.body.code).toBe("GEOFENCE_OUTSIDE_ALLOWED_RADIUS");
    const afterRefusal = await get(ctx.tokens.supervisor, viewPath).expect(200);
    expect([...afterRefusal.body.workers].sort(byName)).toEqual([
      { ...notClockedIn(workerId, "Eli Worker"), flags: [AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT] },
      notClockedIn(supervisorId, "Sami Supervisor"),
    ]);

    // 4. So the supervisor opens a temporary point there; the shift's manager is recorded as authorizing it.
    const point = await post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)).expect(201);
    expect(point.body).toMatchObject({
      shiftId: ctx.shift.id,
      name: "Bridge north",
      latitude: POINT_LAT,
      longitude: SITE_LNG,
      // The organization's default radius (settings).
      radiusMeters: 100,
      status: TemporaryPointStatus.ACTIVE,
      createdBy: ctx.supervisor.user.id,
      managerAuthorizedBy: ctx.manager.user.id,
      expiresAt: ctx.end.toISOString(),
      revokedAt: null,
    });

    // 5. The worker clocks in at the point: outside the shift's geofence, inside the point, with 60 m
    //    accuracy (a temporary point accepts up to 75 m; the geofence only 50 m).
    const clockedIn = await clockIn(ctx.tokens.worker, {
      shiftId: ctx.shift.id,
      temporaryCheckInPointId: point.body.id,
      latitude: POINT_LAT,
      accuracyMeters: 60,
    }).expect(201);
    expect(clockedIn.body.clockEvent).toMatchObject({ temporaryCheckInPointId: point.body.id, locationValidationStatus: LocationValidationStatus.PASSED });

    const during = await get(ctx.tokens.supervisor, viewPath).expect(200);
    expect([...during.body.workers].sort(byName)).toEqual([
      {
        workerProfileId: workerId,
        fullLegalName: "Eli Worker",
        presence: ShiftWorkerPresence.CLOCKED_IN,
        clockInAt: clockedIn.body.timeEntry.clockInAt,
        clockOutAt: null,
        locationOutcome: LocationValidationStatus.PASSED,
        flags: [AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT, AttendanceFlag.TEMPORARY_POINT],
      },
      notClockedIn(supervisorId, "Sami Supervisor"),
    ]);
    expect(during.body.temporaryCheckInPoints).toEqual([
      {
        id: point.body.id,
        name: "Bridge north",
        latitude: POINT_LAT,
        longitude: SITE_LNG,
        radiusMeters: 100,
        expiresAt: ctx.end.toISOString(),
        createdAt: point.body.createdAt,
      },
    ]);
    expect(findForbiddenKeys(during.body)).toEqual([]);
    expect(findPhoneKeys(during.body)).toEqual([]);
    expect(JSON.stringify(during.body)).not.toContain("+9725");

    // 6. An issue report reaches the shift's manager and the Owner (trimmed), and is audited.
    await expectError(post(ctx.tokens.supervisor, reportPath, { text: "   " }), 400, "VALIDATION_FAILED");
    await expectError(post(ctx.tokens.supervisor, reportPath, {}), 400, "VALIDATION_FAILED");
    const issueText = "The north gate is blocked by a truck.";
    const reported = await post(ctx.tokens.supervisor, reportPath, { text: `  ${issueText}  ` }).expect(201);
    expect(reported.body).toEqual({ reportedAt: expect.any(String), notifiedCount: 2 });

    const issueType = NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED;
    const issueData = {
      assignmentId: assignment.id,
      shiftId: ctx.shift.id,
      shiftTitle: "Test Shift",
      workerProfileId: supervisorId,
      workerName: "Sami Supervisor",
      issueText,
    };
    const stored = await prisma.notification.findMany({ where: { type: issueType } });
    expect(stored.map((row) => row.recipientUserId).sort()).toEqual([ctx.manager.user.id, ctx.owner.user.id].sort());
    for (const row of stored) {
      expect(row.dataJson).toEqual(issueData);
      expect(row.body).toContain(issueText);
    }
    for (const token of [ctx.tokens.manager, ctx.tokens.owner]) {
      const rows = (await get(token, "/notifications").expect(200)).body.filter((row: { type: string }) => row.type === issueType);
      expect(rows).toHaveLength(1);
      expect(rows[0].dataJson).toEqual(issueData);
      expect(findForbiddenKeys(rows)).toEqual([]);
    }
    const otherManagerToken = (await loginAs(app, OTHER_MANAGER_PHONE)).accessToken;
    for (const token of [otherManagerToken, ctx.tokens.worker, ctx.tokens.supervisor]) {
      expect((await get(token, "/notifications").expect(200)).body.filter((row: { type: string }) => row.type === issueType)).toEqual([]);
    }

    // 7. The worker clocks out (anywhere): the supervisor sees it.
    const clockedOut = await post(ctx.tokens.worker, "/clock-events/clock-out", {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      latitude: POINT_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
      summaryText: "Directed traffic around the blocked gate.",
      taskCategory: "TRAFFIC_CONTROL",
    }).expect(201);
    const afterClockOut = await get(ctx.tokens.supervisor, viewPath).expect(200);
    expect(afterClockOut.body.workers.find((worker: ShiftViewWorker) => worker.workerProfileId === workerId)).toMatchObject({
      presence: ShiftWorkerPresence.CLOCKED_OUT,
      clockInAt: clockedIn.body.timeEntry.clockInAt,
      clockOutAt: clockedOut.body.clockOutAt,
      locationOutcome: LocationValidationStatus.PASSED,
    });

    // 8. The manager closes the shift: its point expires and the supervisor's access ends at once.
    await post(ctx.tokens.manager, `/shifts/${ctx.shift.id}/close`).expect(201);
    expect(await prisma.temporaryCheckInPoint.findUniqueOrThrow({ where: { id: point.body.id } })).toMatchObject({
      status: TemporaryPointStatus.EXPIRED,
      revokedAt: null,
    });
    await expectError(get(ctx.tokens.supervisor, viewPath), 403, "TEMPORARY_SUPERVISOR_INACTIVE");
    await expectError(post(ctx.tokens.supervisor, reportPath, { text: "Is anyone there?" }), 403, "TEMPORARY_SUPERVISOR_INACTIVE");
    expect((await get(ctx.tokens.supervisor, "/temporary-supervisors/me").expect(200)).body).toEqual([]);
    // No more points on this shift: the supervisor has no active assignment, a manager meets the closed shift.
    await expectError(post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)), 403, "FORBIDDEN");
    await expectError(post(ctx.tokens.manager, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)), 409, "SHIFT_NOT_OPEN");
    await expectError(del(ctx.tokens.manager, `/shifts/temporary-check-in-points/${point.body.id}`), 409, "CONFLICT");
    const list = await get(ctx.tokens.manager, assignPath(ctx.shift.id)).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id: assignment.id, state: TemporarySupervisorState.EXPIRED, revokedAt: null })]);
    // The refused report notified nobody.
    expect(await prisma.notification.count({ where: { type: issueType } })).toBe(2);

    // 9. Every step is in the audit log, in order, with its actor.
    const audit = await prisma.auditLog.findMany({ where: { organizationId: ctx.organizationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(audit.map((row) => [row.action, row.entityId, row.actorUserId])).toEqual([
      ["TEMPORARY_SUPERVISOR_ASSIGNED", assignment.id, ctx.manager.user.id],
      ["TEMPORARY_CHECK_IN_POINT_CREATED", point.body.id, ctx.supervisor.user.id],
      ["CLOCK_IN", clockedIn.body.timeEntry.id, ctx.worker.user.id],
      ["TEMPORARY_SUPERVISOR_ISSUE_REPORTED", assignment.id, ctx.supervisor.user.id],
      ["CLOCK_OUT", clockedIn.body.timeEntry.id, ctx.worker.user.id],
      ["SHIFT_CLOSED", ctx.shift.id, ctx.manager.user.id],
    ]);
    expect(audit[3]).toMatchObject({ entityType: "TemporarySupervisorAssignment", note: issueText });
  });

  it("a temporary supervisor reaches only the supervised shift: not another supervisor's assignment, another shift, a project or its points", async () => {
    const ctx = await setup();
    // A second shift, in another project and site, with its own temporary supervisor and point.
    const otherProject = await createProject(prisma, ctx.organizationId, "PRJ-OTHER");
    const otherSite = await createSiteWithGeofence(prisma, ctx.organizationId, otherProject.id, OTHER_SITE_LAT, SITE_LNG, 100);
    const otherShift = await createStandardShift(
      prisma,
      ctx.organizationId,
      otherProject.id,
      otherSite.site.id,
      otherSite.geofence.id,
      ctx.manager.user.id,
      ctx.start,
      ctx.end,
    );
    const otherSupervisor = await addWorker(prisma, ctx.organizationId, OTHER_SUPERVISOR_PHONE, "Other Supervisor");
    await assignWorkerToShift(prisma, otherShift.id, otherSupervisor.workerProfile.id, ctx.manager.user.id);

    const mine = (await post(ctx.tokens.manager, assignPath(ctx.shift.id), { workerProfileId: ctx.supervisor.workerProfile.id }).expect(201)).body;
    const theirs = (await post(ctx.tokens.manager, assignPath(otherShift.id), { workerProfileId: otherSupervisor.workerProfile.id }).expect(201)).body;
    const theirPoint = (
      await post(ctx.tokens.manager, "/shifts/temporary-check-in-points", {
        shiftId: otherShift.id,
        name: "Depot gate",
        latitude: OTHER_SITE_LAT,
        longitude: SITE_LNG,
      }).expect(201)
    ).body;

    // Their own shift: only its two workers, none of the other shift's.
    const view = await get(ctx.tokens.supervisor, `/temporary-supervisors/${mine.id}/shift`).expect(200);
    expect(view.body.shift.id).toBe(ctx.shift.id);
    expect(view.body.workers.map((worker: ShiftViewWorker) => worker.workerProfileId).sort()).toEqual(
      [ctx.supervisor.workerProfile.id, ctx.worker.workerProfile.id].sort(),
    );
    expect(view.body.temporaryCheckInPoints).toEqual([]);

    // Another supervisor's assignment does not exist for them; nor does any assignment for a manager.
    await expectError(get(ctx.tokens.supervisor, `/temporary-supervisors/${theirs.id}/shift`), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.supervisor, `/temporary-supervisors/${theirs.id}/report-issue`, { text: "Hello?" }), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.supervisor, `/temporary-supervisors/${uuidv7()}/shift`), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.manager, `/temporary-supervisors/${mine.id}/shift`), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.owner, `/temporary-supervisors/${mine.id}/shift`), 404, "NOT_FOUND");
    expect(await prisma.notification.count({ where: { type: NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED } })).toBe(0);

    // The other shift and the projects stay closed to them: a supervisor is still a Worker.
    await expectError(get(ctx.tokens.supervisor, `/shifts/${otherShift.id}`), 404, "NOT_FOUND");
    expect((await get(ctx.tokens.supervisor, "/shifts").expect(200)).body.map((shift: { id: string }) => shift.id)).toEqual([ctx.shift.id]);
    await expectError(get(ctx.tokens.supervisor, `/projects/${otherProject.id}`), 403, "FORBIDDEN");
    await expectError(get(ctx.tokens.supervisor, `/projects/${ctx.project.id}`), 403, "FORBIDDEN");
    await expectError(get(ctx.tokens.supervisor, "/projects"), 403, "FORBIDDEN");
    await expectError(get(ctx.tokens.supervisor, assignPath(otherShift.id)), 403, "FORBIDDEN");
    await expectError(get(ctx.tokens.supervisor, "/operations/live"), 403, "FORBIDDEN");

    // Nor can they open or close a point on the other shift.
    await expectError(
      post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", {
        shiftId: otherShift.id,
        name: "Sneaky",
        latitude: OTHER_SITE_LAT,
        longitude: SITE_LNG,
      }),
      403,
      "FORBIDDEN",
    );
    await expectError(del(ctx.tokens.supervisor, `/shifts/temporary-check-in-points/${theirPoint.id}`), 403, "FORBIDDEN");
    const otherShiftPoints = await prisma.temporaryCheckInPoint.findMany({ where: { shiftId: otherShift.id } });
    expect(otherShiftPoints.map((point) => [point.id, point.status])).toEqual([[theirPoint.id, TemporaryPointStatus.ACTIVE]]);
  });

  it("without canOpenCheckInPoints the supervisor can neither open nor close a point, but still sees the shift", async () => {
    const ctx = await setup();
    const limited = (
      await post(ctx.tokens.manager, assignPath(ctx.shift.id), { workerProfileId: ctx.supervisor.workerProfile.id, canOpenCheckInPoints: false }).expect(201)
    ).body;
    expect(limited.canOpenCheckInPoints).toBe(false);
    expect((await get(ctx.tokens.supervisor, "/temporary-supervisors/me").expect(200)).body).toEqual([
      expect.objectContaining({ id: limited.id, canOpenCheckInPoints: false }),
    ]);

    await expectError(
      post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)),
      403,
      "TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS",
    );
    const managersPoint = (await post(ctx.tokens.manager, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id, "Manager's point")).expect(201)).body;
    await expectError(del(ctx.tokens.supervisor, `/shifts/temporary-check-in-points/${managersPoint.id}`), 403, "TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS");
    expect(await prisma.temporaryCheckInPoint.findMany()).toEqual([
      expect.objectContaining({ id: managersPoint.id, status: TemporaryPointStatus.ACTIVE, revokedAt: null }),
    ]);

    // The view itself is unaffected, and lists the manager's point.
    const view = await get(ctx.tokens.supervisor, `/temporary-supervisors/${limited.id}/shift`).expect(200);
    expect(view.body.assignment).toMatchObject({ id: limited.id, canOpenCheckInPoints: false });
    expect(view.body.temporaryCheckInPoints.map((point: { id: string }) => point.id)).toEqual([managersPoint.id]);

    // Re-assigned with the right (the default), the supervisor may close the manager's point -- once.
    await del(ctx.tokens.manager, `/shifts/temporary-supervisors/${limited.id}`).expect(200);
    await post(ctx.tokens.manager, assignPath(ctx.shift.id), { workerProfileId: ctx.supervisor.workerProfile.id }).expect(201);
    const closed = await del(ctx.tokens.supervisor, `/shifts/temporary-check-in-points/${managersPoint.id}`).expect(200);
    expect(closed.body).toMatchObject({ id: managersPoint.id, status: TemporaryPointStatus.REVOKED, revokedBy: ctx.supervisor.user.id });
    await expectError(del(ctx.tokens.supervisor, `/shifts/temporary-check-in-points/${managersPoint.id}`), 409, "CONFLICT");
    await expectError(del(ctx.tokens.manager, `/shifts/temporary-check-in-points/${managersPoint.id}`), 409, "CONFLICT");
    expect(
      (await prisma.auditLog.findMany({ where: { entityId: managersPoint.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((row) => row.action),
    ).toEqual(["TEMPORARY_CHECK_IN_POINT_CREATED", "TEMPORARY_CHECK_IN_POINT_REVOKED"]);
  });

  it("access is checked live: a revoked, expired or not yet started assignment, or a cancelled shift, gives no access", async () => {
    const ctx = await setup();
    const path = assignPath(ctx.shift.id);
    const supervisorId = ctx.supervisor.workerProfile.id;
    const view = (assignmentId: string) => get(ctx.tokens.supervisor, `/temporary-supervisors/${assignmentId}/shift`);
    const mine = async () => (await get(ctx.tokens.supervisor, "/temporary-supervisors/me").expect(200)).body.map((row: { id: string }) => row.id);

    // Revoked: the next call is refused; revoking again is a conflict.
    const revoked = (await post(ctx.tokens.manager, path, { workerProfileId: supervisorId }).expect(201)).body;
    await view(revoked.id).expect(200);
    const revocation = await del(ctx.tokens.manager, `/shifts/temporary-supervisors/${revoked.id}`).expect(200);
    expect(revocation.body).toMatchObject({ id: revoked.id, revokedAt: expect.any(String), revokedBy: ctx.manager.user.id });
    await expectError(view(revoked.id), 403, "TEMPORARY_SUPERVISOR_INACTIVE");
    await expectError(
      post(ctx.tokens.supervisor, `/temporary-supervisors/${revoked.id}/report-issue`, { text: "Still here?" }),
      403,
      "TEMPORARY_SUPERVISOR_INACTIVE",
    );
    await expectError(post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)), 403, "FORBIDDEN");
    expect(await mine()).toEqual([]);
    await expectError(del(ctx.tokens.manager, `/shifts/temporary-supervisors/${revoked.id}`), 409, "CONFLICT");
    await expectError(del(ctx.tokens.owner, `/shifts/temporary-supervisors/${revoked.id}`), 409, "CONFLICT");
    await expectError(del(ctx.tokens.manager, `/shifts/temporary-supervisors/${uuidv7()}`), 404, "NOT_FOUND");
    expect(await prisma.auditLog.count({ where: { action: "TEMPORARY_SUPERVISOR_REVOKED", entityId: revoked.id, actorUserId: ctx.manager.user.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "TEMPORARY_SUPERVISOR_REVOKED" } })).toBe(1);

    // A revoked assignment does not block a new one for the same time. This one then expires.
    const expired = (await post(ctx.tokens.manager, path, { workerProfileId: supervisorId }).expect(201)).body;
    await view(expired.id).expect(200);
    await prisma.temporarySupervisorAssignment.update({ where: { id: expired.id }, data: { activatedAt: inMinutes(-120), expiresAt: inMinutes(-1) } });
    await expectError(view(expired.id), 403, "TEMPORARY_SUPERVISOR_INACTIVE");
    expect(await mine()).toEqual([]);

    // Not started yet: it starts in an hour.
    const upcoming = (await post(ctx.tokens.owner, path, { workerProfileId: supervisorId, activatedAt: inMinutes(60).toISOString() }).expect(201)).body;
    await expectError(view(upcoming.id), 403, "TEMPORARY_SUPERVISOR_INACTIVE");
    await expectError(post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)), 403, "FORBIDDEN");
    expect(await mine()).toEqual([]);

    const states = async () =>
      Object.fromEntries(
        (await get(ctx.tokens.manager, path).expect(200)).body.map((row: { id: string; state: string; revokedByName: string | null }) => [
          row.id,
          [row.state, row.revokedByName],
        ]),
      );
    expect(await states()).toEqual({
      [revoked.id]: [TemporarySupervisorState.REVOKED, "Yossi Manager"],
      [expired.id]: [TemporarySupervisorState.EXPIRED, null],
      [upcoming.id]: [TemporarySupervisorState.UPCOMING, null],
    });

    // The same assignment gives access once its window has started (no new token)...
    await prisma.temporarySupervisorAssignment.update({ where: { id: upcoming.id }, data: { activatedAt: inMinutes(-1) } });
    await view(upcoming.id).expect(200);
    expect(await mine()).toEqual([upcoming.id]);
    // ...and loses it the moment its shift is cancelled.
    await prisma.shift.update({ where: { id: ctx.shift.id }, data: { status: ShiftStatus.CANCELLED, cancelledAt: new Date() } });
    await expectError(view(upcoming.id), 403, "TEMPORARY_SUPERVISOR_INACTIVE");
    expect(await mine()).toEqual([]);
    expect((await states())[upcoming.id]).toEqual([TemporarySupervisorState.EXPIRED, null]);
  });

  it("organization scoping: another organization's Owner gets 404 for this organization's shift, assignments and points", async () => {
    const ctx = await setup();
    const path = assignPath(ctx.shift.id);
    const assignment = (await post(ctx.tokens.manager, path, { workerProfileId: ctx.supervisor.workerProfile.id }).expect(201)).body;
    const point = (await post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)).expect(201)).body;
    const other = await otherOrganization();

    await expectError(get(other.tokens.owner, path), 404, "NOT_FOUND");
    await expectError(post(other.tokens.owner, path, { workerProfileId: ctx.supervisor.workerProfile.id }), 404, "NOT_FOUND");
    await expectError(post(other.tokens.owner, path, { workerProfileId: other.worker.workerProfile.id }), 404, "NOT_FOUND");
    await expectError(del(other.tokens.owner, `/shifts/temporary-supervisors/${assignment.id}`), 404, "NOT_FOUND");
    await expectError(post(other.tokens.owner, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)), 404, "NOT_FOUND");
    await expectError(del(other.tokens.owner, `/shifts/temporary-check-in-points/${point.id}`), 404, "NOT_FOUND");
    await expectError(get(other.tokens.worker, `/temporary-supervisors/${assignment.id}/shift`), 404, "NOT_FOUND");
    expect((await get(other.tokens.worker, "/temporary-supervisors/me").expect(200)).body).toEqual([]);

    // Nothing changed: the assignment and the point are intact, and the supervisor still has access.
    expect(await prisma.temporarySupervisorAssignment.findMany()).toEqual([expect.objectContaining({ id: assignment.id, revokedAt: null })]);
    expect(await prisma.temporaryCheckInPoint.findMany()).toEqual([
      expect.objectContaining({ id: point.id, status: TemporaryPointStatus.ACTIVE, revokedAt: null }),
    ]);
    await get(ctx.tokens.supervisor, `/temporary-supervisors/${assignment.id}/shift`).expect(200);

    // The other way round too: the other organization's assignment is invisible to this organization's managers.
    expect((await get(other.tokens.owner, assignPath(other.shift.id)).expect(200)).body).toEqual([]);
    const theirs = (await post(other.tokens.owner, assignPath(other.shift.id), { workerProfileId: other.worker.workerProfile.id }).expect(201)).body;
    await expectError(get(ctx.tokens.owner, assignPath(other.shift.id)), 404, "NOT_FOUND");
    await expectError(del(ctx.tokens.owner, `/shifts/temporary-supervisors/${theirs.id}`), 404, "NOT_FOUND");
    await expectError(del(ctx.tokens.manager, `/shifts/temporary-supervisors/${theirs.id}`), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.supervisor, `/temporary-supervisors/${theirs.id}/shift`), 404, "NOT_FOUND");
    expect((await prisma.temporarySupervisorAssignment.findUniqueOrThrow({ where: { id: theirs.id } })).revokedAt).toBeNull();
  });

  it("regression: a shift's temporary points list is visible exactly like the shift (a Worker only on their own shift; 404 otherwise)", async () => {
    const ctx = await setup();
    // Shift B: another shift of the organization, in another project and site, with a point of its own.
    const otherProject = await createProject(prisma, ctx.organizationId, "PRJ-OTHER");
    const otherSite = await createSiteWithGeofence(prisma, ctx.organizationId, otherProject.id, OTHER_SITE_LAT, SITE_LNG, 100);
    const otherShift = await createStandardShift(
      prisma,
      ctx.organizationId,
      otherProject.id,
      otherSite.site.id,
      otherSite.geofence.id,
      ctx.manager.user.id,
      ctx.start,
      ctx.end,
    );
    const theirPoint = (
      await post(ctx.tokens.manager, "/shifts/temporary-check-in-points", {
        shiftId: otherShift.id,
        name: "Depot gate",
        latitude: OTHER_SITE_LAT,
        longitude: SITE_LNG,
      }).expect(201)
    ).body;
    // Shift A: its temporary supervisor opens a point on it.
    await post(ctx.tokens.manager, assignPath(ctx.shift.id), { workerProfileId: ctx.supervisor.workerProfile.id }).expect(201);
    const ownPoint = (await post(ctx.tokens.supervisor, "/shifts/temporary-check-in-points", pointBody(ctx.shift.id)).expect(201)).body;
    // A worker of the organization on neither shift, and another organization.
    await addWorker(prisma, ctx.organizationId, OFF_SHIFT_PHONE, "Off Shift Worker");
    const offShiftToken = (await loginAs(app, OFF_SHIFT_PHONE)).accessToken;
    const other = await otherOrganization();

    const pointsPath = (shiftId: string) => `/shifts/${shiftId}/temporary-check-in-points`;
    const pointIds = async (token: string, shiftId: string) =>
      (await get(token, pointsPath(shiftId)).expect(200)).body.map((point: { id: string }) => point.id);

    // The supervisor's own shift: 200 with its points (and only its). Its other worker sees them too, as with GET /shifts/:id.
    const own = await get(ctx.tokens.supervisor, pointsPath(ctx.shift.id)).expect(200);
    expect(own.body).toEqual([
      expect.objectContaining({
        id: ownPoint.id,
        shiftId: ctx.shift.id,
        name: "Bridge north",
        status: TemporaryPointStatus.ACTIVE,
        createdBy: ctx.supervisor.user.id,
      }),
    ]);
    expect(await pointIds(ctx.tokens.worker, ctx.shift.id)).toEqual([ownPoint.id]);

    // Any other shift is 404 for a Worker: the supervisor of A on B, a worker of A on B, a worker on no shift.
    await expectError(get(ctx.tokens.supervisor, pointsPath(otherShift.id)), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.worker, pointsPath(otherShift.id)), 404, "NOT_FOUND");
    await expectError(get(offShiftToken, pointsPath(otherShift.id)), 404, "NOT_FOUND");
    await expectError(get(offShiftToken, pointsPath(ctx.shift.id)), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.supervisor, pointsPath(uuidv7())), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.supervisor, pointsPath("not-a-uuid")), 404, "NOT_FOUND");

    // Managers: every shift of their organization.
    for (const token of [ctx.tokens.manager, ctx.tokens.owner]) {
      expect(await pointIds(token, otherShift.id)).toEqual([theirPoint.id]);
      expect(await pointIds(token, ctx.shift.id)).toEqual([ownPoint.id]);
    }
    // Another organization's shift, an unknown id or a malformed one: 404.
    await expectError(get(other.tokens.owner, pointsPath(ctx.shift.id)), 404, "NOT_FOUND");
    await expectError(get(other.tokens.owner, pointsPath(otherShift.id)), 404, "NOT_FOUND");
    await expectError(get(other.tokens.worker, pointsPath(ctx.shift.id)), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.manager, pointsPath(other.shift.id)), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.manager, pointsPath(uuidv7())), 404, "NOT_FOUND");
    await expectError(get(ctx.tokens.manager, pointsPath("not-a-uuid")), 404, "NOT_FOUND");
  });

  it("regression: closing an already closed or a cancelled shift is refused with 409 SHIFT_NOT_OPEN and changes nothing", async () => {
    const ctx = await setup();
    const closePath = `/shifts/${ctx.shift.id}/close`;

    // The first close works and is audited once.
    const closed = await post(ctx.tokens.manager, closePath).expect(201);
    expect(closed.body).toMatchObject({ id: ctx.shift.id, status: ShiftStatus.CLOSED, closedBy: ctx.manager.user.id, closedAt: expect.any(String) });
    const afterFirstClose = await prisma.shift.findUniqueOrThrow({ where: { id: ctx.shift.id } });

    // Closing it again -- the Field Manager or the Owner -- is refused: closedAt/closedBy stay, no second audit row.
    for (const token of [ctx.tokens.manager, ctx.tokens.owner]) {
      await expectError(post(token, closePath), 409, "SHIFT_NOT_OPEN");
    }
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: ctx.shift.id } })).toEqual(afterFirstClose);
    expect(await prisma.auditLog.count({ where: { action: "SHIFT_CLOSED", entityId: ctx.shift.id } })).toBe(1);

    // A cancelled shift stays cancelled: not closed, its point not expired, nothing audited.
    const cancelled = await createStandardShift(
      prisma,
      ctx.organizationId,
      ctx.project.id,
      ctx.site.id,
      ctx.geofence.id,
      ctx.manager.user.id,
      ctx.start,
      ctx.end,
    );
    const point = (await post(ctx.tokens.manager, "/shifts/temporary-check-in-points", pointBody(cancelled.id)).expect(201)).body;
    await prisma.shift.update({ where: { id: cancelled.id }, data: { status: ShiftStatus.CANCELLED, cancelledAt: new Date() } });
    const beforeClose = await prisma.shift.findUniqueOrThrow({ where: { id: cancelled.id } });
    for (const token of [ctx.tokens.manager, ctx.tokens.owner]) {
      await expectError(post(token, `/shifts/${cancelled.id}/close`), 409, "SHIFT_NOT_OPEN");
    }
    const afterClose = await prisma.shift.findUniqueOrThrow({ where: { id: cancelled.id } });
    expect(afterClose).toEqual(beforeClose);
    expect(afterClose).toMatchObject({ status: ShiftStatus.CANCELLED, closedAt: null, closedBy: null });
    expect(await prisma.temporaryCheckInPoint.findUniqueOrThrow({ where: { id: point.id } })).toMatchObject({ status: TemporaryPointStatus.ACTIVE });
    expect(await prisma.auditLog.count({ where: { action: "SHIFT_CLOSED", entityId: cancelled.id } })).toBe(0);
  });

  it("regression: a malformed shift id is a 404 (never a 500) on the shift, its points, its supervisors, assigning workers and closing", async () => {
    const ctx = await setup();
    for (const token of [ctx.tokens.manager, ctx.tokens.supervisor]) {
      await expectError(get(token, "/shifts/not-a-uuid"), 404, "NOT_FOUND");
      await expectError(get(token, "/shifts/not-a-uuid/temporary-check-in-points"), 404, "NOT_FOUND");
    }
    await expectError(get(ctx.tokens.manager, "/shifts/not-a-uuid/temporary-supervisors"), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, "/shifts/not-a-uuid/assignments", { workerProfileId: ctx.worker.workerProfile.id }), 404, "NOT_FOUND");
    await expectError(post(ctx.tokens.manager, "/shifts/not-a-uuid/close"), 404, "NOT_FOUND");
  });
});
