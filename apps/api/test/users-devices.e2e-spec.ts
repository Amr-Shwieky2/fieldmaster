import { randomBytes } from "node:crypto";
import { get as httpGet } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import type { Response } from "supertest";
import { io, type Socket } from "socket.io-client";
import { v7 as uuidv7 } from "uuid";
import { AccountStatus, NotificationType, OrgRole } from "@fieldmaster/shared-types";
import { canonicalizeOfflineEvent, generateOfflineSigningKeyPair, signOfflineEvent, type OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import { createTestApp, loginAs, request, resetDatabase, type LoggedInUser } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { NotificationsGateway } from "../src/modules/notifications/notifications.gateway";
import { NotificationsService } from "../src/modules/notifications/notifications.service";
import {
  addFieldManager,
  addMembership,
  addWorker,
  assignWorkerToShift,
  createOrgWithOwner,
  createProject,
  createSiteWithGeofence,
  createStandardShift,
} from "./fixtures";

/**
 * Step 6: the users page -- members, roles, suspension, archiving, time
 * tracking, sessions and devices. Owners only; every change needs a reason
 * and is audited. Taking access away is immediate: the guard reads the
 * membership (status, role, time tracking) and the session from the database
 * on every request, and the member's open WebSocket / SSE connections are
 * closed.
 */

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center: inside the 100 m geofence.
const NEARBY_LAT = 32.0858;

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const SECOND_MANAGER_PHONE = "+972500000012";
const WORKER_PHONE = "+972500010001";
const FORMER_WORKER_PHONE = "+972500010002";
const OTHER_ORG_OWNER_PHONE = "+972500000099";
const OTHER_ORG_WORKER_PHONE = "+972500010099";

const OFFLINE_DEVICE = "worker-offline-phone";

/** The audit actions of the users page. */
const MEMBER_ACTIONS = [
  "MEMBERSHIP_ROLE_CHANGED",
  "MEMBERSHIP_SUSPENDED",
  "MEMBERSHIP_REACTIVATED",
  "MEMBERSHIP_ARCHIVED",
  "MEMBERSHIP_TIME_TRACKING_CHANGED",
  "MEMBER_SESSION_REVOKED",
  "DEVICE_PUBLIC_KEY_REVOKED",
];

const testRandomBytes = (n: number) => new Uint8Array(randomBytes(n));

/** A session's id: its refresh-token family, the first part of the refresh token (and the access token's `sid`). */
const sessionIdOf = (session: LoggedInUser) => session.refreshToken.split(":")[0];

/** One device of `GET /memberships/:id/devices`. */
interface DeviceRow {
  id: string;
  clientDeviceId: string;
  key: { status: string };
}

const deviceIn = (devices: DeviceRow[], clientDeviceId: string) => devices.find((device) => device.clientDeviceId === clientDeviceId);

/** A notifications socket.io connection, recording what the server sends it. */
interface TestSocket {
  socket: Socket;
  received: Array<{ event: string; payload: Record<string, unknown> }>;
  /** Why the connection closed, once it has ("io server disconnect" when the server closed it). */
  disconnectReason?: string;
}

/** An SSE notification stream. */
interface TestStream {
  status?: number;
  /** The server ended the response. */
  ended: boolean;
}

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("Users and devices (Step 6)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const sockets: Socket[] = [];
  const cleanups: Array<() => void> = [];

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

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  const http = () => app.getHttpServer();
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(http()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", uuidv7()).send(body);
  const patch = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(http()).patch(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).send(body);
  const refresh = (refreshToken: string) => request(http()).post("/api/v1/auth/refresh").send({ refreshToken });

  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker");
    const project = await createProject(prisma, organizationId);
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const start = new Date(Date.now() - 60 * 60_000);
    const end = new Date(Date.now() + 8 * 60 * 60_000);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, start, end);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);

    const sessions = {
      owner: await loginAs(app, OWNER_PHONE),
      manager: await loginAs(app, MANAGER_PHONE),
      worker: await loginAs(app, WORKER_PHONE),
    };
    const tokens = { owner: sessions.owner.accessToken, manager: sessions.manager.accessToken, worker: sessions.worker.accessToken };
    return { organizationId, owner, manager, worker, shift, sessions, tokens };
  }

  /** A second organization whose Owner must never reach the first one's members. */
  async function otherOrganization() {
    const owner = await createOrgWithOwner(prisma, OTHER_ORG_OWNER_PHONE, "Other Owner");
    const worker = await addWorker(prisma, owner.org.id, OTHER_ORG_WORKER_PHONE, "Other Worker");
    return { owner, worker, ownerToken: (await loginAs(app, OTHER_ORG_OWNER_PHONE)).accessToken };
  }

  /** OTP sign-in with the test code, choosing the organization when the person belongs to several. */
  async function verifyOtp(phoneNumber: string, deviceId: string, organizationId?: string) {
    await request(http()).post("/api/v1/auth/otp/request").send({ phoneNumber }).expect(204);
    return request(http())
      .post("/api/v1/auth/otp/verify")
      .send({ phoneNumber, code: "000000", deviceId, platform: "ANDROID", ...(organizationId ? { organizationId } : {}) });
  }

  /** The audit rows one request wrote (matched by its correlation id). */
  const auditOf = (response: Response) => prisma.auditLog.findMany({ where: { correlationId: response.headers["x-correlation-id"] } });
  const membershipOf = (id: string) => prisma.organizationMembership.findUniqueOrThrow({ where: { id } });

  function clock(token: string, kind: "clock-in" | "clock-out", body: Record<string, unknown>) {
    return post(token, `/clock-events/${kind}`, {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
      ...body,
    });
  }

  // ── Real-time connections ──────────────────────────────────────────────

  function openSocket(accessToken: string): TestSocket {
    const socket = io(`${baseUrl}/notifications`, { auth: { token: accessToken }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(socket);
    const live: TestSocket = { socket, received: [] };
    socket.onAny((event: string, payload: Record<string, unknown>) => live.received.push({ event, payload }));
    socket.on("disconnect", (reason) => {
      live.disconnectReason = reason;
    });
    return live;
  }

  /**
   * A socket the server has accepted: it authenticates a connection and joins
   * it to its rooms asynchronously, after the client's "connect".
   */
  async function connectSocket(accessToken: string, membershipId: string): Promise<TestSocket> {
    const live = openSocket(accessToken);
    const gateway = app.get(NotificationsGateway);
    await waitFor(async () => {
      if (live.disconnectReason !== undefined) throw new Error(`The server closed the socket instead of accepting it (${live.disconnectReason}).`);
      if (!live.socket.connected) return false;
      return (await gateway.server.in(`membership:${membershipId}`).fetchSockets()).some((socket) => socket.id === live.socket.id);
    }, "the server to accept the socket");
    return live;
  }

  async function disconnectReasonOf(live: TestSocket): Promise<string | undefined> {
    await waitFor(() => live.disconnectReason !== undefined, "the socket to be closed");
    return live.disconnectReason;
  }

  /** A new connection with this token is closed by the server as soon as it has checked it. */
  async function expectSocketRefused(accessToken: string) {
    expect(await disconnectReasonOf(openSocket(accessToken))).toBe("io server disconnect");
  }

  async function waitForEvent(live: TestSocket, event: string, matches: (payload: Record<string, unknown>) => boolean) {
    await waitFor(() => live.received.some((entry) => entry.event === event && matches(entry.payload)), `a "${event}" event`);
  }

  function openSse(accessToken: string): TestStream {
    const stream: TestStream = { ended: false };
    const req = httpGet(`${baseUrl}/api/v1/notifications/stream?token=${encodeURIComponent(accessToken)}`, { headers: { Accept: "text/event-stream" } });
    req.on("error", () => undefined);
    req.on("response", (res) => {
      stream.status = res.statusCode;
      res.on("error", () => undefined);
      res.on("end", () => {
        stream.ended = true;
      });
      res.resume();
      cleanups.push(() => res.destroy());
    });
    cleanups.push(() => req.destroy());
    return stream;
  }

  async function sseStatus(stream: TestStream) {
    await waitFor(() => stream.status !== undefined, "the SSE response");
    return stream.status;
  }

  // ── Members ────────────────────────────────────────────────────────────

  it("lists every member, archived included, with role, status, time tracking, worker profile, last activity and isSelf", async () => {
    const ctx = await setup();
    // A worker who never signed in, then left: still listed.
    const former = await addWorker(prisma, ctx.organizationId, FORMER_WORKER_PHONE, "Rami Former");
    await post(ctx.tokens.owner, `/memberships/${former.membership.id}/archive`, { reason: "Left the company" }).expect(201);
    /** The member's latest sign-in or refresh, from their sessions. */
    const lastUse = async (membershipId: string) =>
      (await prisma.refreshTokenFamily.findFirstOrThrow({ where: { membershipId }, orderBy: { lastUsedAt: "desc" } })).lastUsedAt.toISOString();

    const list = await get(ctx.tokens.owner, "/memberships").expect(200);
    expect(list.body).toHaveLength(4);
    const listed = (rows: Array<{ id: string; lastActiveAt: string }>, membershipId: string) => rows.find((row) => row.id === membershipId);
    expect(listed(list.body, ctx.owner.membership.id)).toEqual({
      id: ctx.owner.membership.id,
      userId: ctx.owner.user.id,
      fullLegalName: "Dana Owner",
      phoneNumber: OWNER_PHONE,
      role: OrgRole.OWNER,
      status: AccountStatus.ACTIVE,
      isTimeTrackable: false,
      workerProfileId: null,
      lastActiveAt: await lastUse(ctx.owner.membership.id),
      createdAt: expect.any(String),
      archivedAt: null,
      isSelf: true,
    });
    expect(listed(list.body, ctx.manager.membership.id)).toMatchObject({
      userId: ctx.manager.user.id,
      fullLegalName: "Yossi Manager",
      phoneNumber: MANAGER_PHONE,
      role: OrgRole.FIELD_MANAGER,
      status: AccountStatus.ACTIVE,
      isTimeTrackable: false,
      workerProfileId: null,
      lastActiveAt: await lastUse(ctx.manager.membership.id),
      archivedAt: null,
      isSelf: false,
    });
    expect(listed(list.body, ctx.worker.membership.id)).toMatchObject({
      role: OrgRole.WORKER,
      status: AccountStatus.ACTIVE,
      isTimeTrackable: true,
      workerProfileId: ctx.worker.workerProfile.id,
      lastActiveAt: await lastUse(ctx.worker.membership.id),
      isSelf: false,
    });
    expect(listed(list.body, former.membership.id)).toMatchObject({
      fullLegalName: "Rami Former",
      role: OrgRole.WORKER,
      status: AccountStatus.ARCHIVED,
      archivedAt: expect.any(String),
      workerProfileId: former.workerProfile.id,
      lastActiveAt: null,
      isSelf: false,
    });

    // A refresh is activity too.
    const refreshedAt = Date.now();
    await refresh(ctx.sessions.manager.refreshToken).expect(201);
    const afterRefresh = listed((await get(ctx.tokens.owner, "/memberships").expect(200)).body, ctx.manager.membership.id)!;
    expect(afterRefresh.lastActiveAt).not.toBe(listed(list.body, ctx.manager.membership.id)!.lastActiveAt);
    expect(new Date(afterRefresh.lastActiveAt).getTime()).toBeGreaterThanOrEqual(refreshedAt);
    expect(afterRefresh.lastActiveAt).toBe(await lastUse(ctx.manager.membership.id));

    // Owners only; another organization's Owner lists only their own members.
    await get(ctx.tokens.manager, "/memberships").expect(403);
    await get(ctx.tokens.worker, "/memberships").expect(403);
    const other = await otherOrganization();
    const otherList = await get(other.ownerToken, "/memberships").expect(200);
    expect(otherList.body.map((row: { id: string }) => row.id).sort()).toEqual([other.owner.membership.id, other.worker.membership.id].sort());
  });

  it("every member action returns the member's real last activity (their latest sign-in or refresh), as the list shows it", async () => {
    // Regression: the action responses had `lastActiveAt: null` even for a member who had signed in.
    const ctx = await setup();
    const id = ctx.manager.membership.id;
    // Two sessions (two sign-ins). Pinning when each was last used makes "the latest" unambiguous: here the older
    // session was used most recently, so it is the latest use -- not the newest session.
    const tablet = await loginAs(app, MANAGER_PHONE, "manager-tablet");
    const latestUse = new Date(Date.now() - 5 * 60_000);
    await prisma.refreshTokenFamily.update({ where: { id: sessionIdOf(ctx.sessions.manager) }, data: { lastUsedAt: latestUse } });
    await prisma.refreshTokenFamily.update({ where: { id: sessionIdOf(tablet) }, data: { lastUsedAt: new Date(Date.now() - 60 * 60_000) } });
    const listedLastActive = async () =>
      (await get(ctx.tokens.owner, "/memberships").expect(200)).body.find((row: { id: string }) => row.id === id).lastActiveAt;
    expect(await listedLastActive()).toBe(latestUse.toISOString());

    const memberPath = (action: string) => `/memberships/${id}/${action}`;
    const responses: Array<[string, Response]> = [
      ["time tracking on", await patch(ctx.tokens.owner, memberPath("time-tracking"), { isTimeTrackable: true, reason: "Works shifts too" }).expect(200)],
      ["time tracking unchanged", await patch(ctx.tokens.owner, memberPath("time-tracking"), { isTimeTrackable: true, reason: "No change" }).expect(200)],
      ["role", await patch(ctx.tokens.owner, memberPath("role"), { role: OrgRole.WORKER, reason: "Back to field work" }).expect(200)],
      ["role unchanged", await patch(ctx.tokens.owner, memberPath("role"), { role: OrgRole.WORKER, reason: "No change" }).expect(200)],
      // Suspending ends the sessions, but their history stays: the last activity is unchanged.
      ["suspend", await post(ctx.tokens.owner, memberPath("suspend"), { reason: "Under investigation" }).expect(201)],
      ["reactivate", await post(ctx.tokens.owner, memberPath("reactivate"), { reason: "Investigation closed" }).expect(201)],
      ["archive", await post(ctx.tokens.owner, memberPath("archive"), { reason: "Left the company" }).expect(201)],
    ];
    for (const [action, response] of responses) {
      expect({ action, lastActiveAt: response.body.lastActiveAt }).toEqual({ action, lastActiveAt: latestUse.toISOString() });
    }
    expect(await listedLastActive()).toBe(latestUse.toISOString());

    // A member who never signed in has no last activity.
    const second = await addFieldManager(prisma, ctx.organizationId, SECOND_MANAGER_PHONE, "Rina Manager");
    const neverSignedIn = await patch(ctx.tokens.owner, `/memberships/${second.membership.id}/role`, { role: OrgRole.OWNER, reason: "Co-owner" }).expect(200);
    expect(neverSignedIn.body).toMatchObject({ id: second.membership.id, role: OrgRole.OWNER, lastActiveAt: null });
  });

  it("a role change needs a reason (non-blank, at most 500 characters) and is audited old -> new with it; a third active Owner is refused", async () => {
    const ctx = await setup();
    const second = await addFieldManager(prisma, ctx.organizationId, SECOND_MANAGER_PHONE, "Rina Manager");
    const rolePath = (membershipId: string) => `/memberships/${membershipId}/role`;

    const invalid = [
      { role: OrgRole.OWNER },
      { role: OrgRole.OWNER, reason: "" },
      { role: OrgRole.OWNER, reason: "   " },
      { role: OrgRole.OWNER, reason: "r".repeat(501) },
      { role: "SUPERVISOR", reason: "Promotion" },
      { reason: "Promotion" },
    ];
    for (const body of invalid) {
      const response = await patch(ctx.tokens.owner, rolePath(ctx.manager.membership.id), body);
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
    }
    expect((await membershipOf(ctx.manager.membership.id)).role).toBe(OrgRole.FIELD_MANAGER);

    const promoted = await patch(ctx.tokens.owner, rolePath(ctx.manager.membership.id), { role: OrgRole.OWNER, reason: "Co-owner from January" }).expect(200);
    expect(promoted.body).toMatchObject({ id: ctx.manager.membership.id, role: OrgRole.OWNER, status: AccountStatus.ACTIVE, isSelf: false });
    expect(await auditOf(promoted)).toEqual([
      expect.objectContaining({
        organizationId: ctx.organizationId,
        actorUserId: ctx.owner.user.id,
        action: "MEMBERSHIP_ROLE_CHANGED",
        entityType: "OrganizationMembership",
        entityId: ctx.manager.membership.id,
        field: "role",
        oldValue: OrgRole.FIELD_MANAGER,
        newValue: OrgRole.OWNER,
        reason: "Co-owner from January",
      }),
    ]);

    // Two active Owners: a third is refused, and nothing changes.
    const third = await patch(ctx.tokens.owner, rolePath(second.membership.id), { role: OrgRole.OWNER, reason: "Third partner" }).expect(409);
    expect(third.body.code).toBe("MAX_OWNERS_REACHED");
    expect((await membershipOf(second.membership.id)).role).toBe(OrgRole.FIELD_MANAGER);

    // The longest reason allowed is accepted and stored whole.
    const longReason = "r".repeat(500);
    const demoted = await patch(ctx.tokens.owner, rolePath(ctx.manager.membership.id), { role: OrgRole.FIELD_MANAGER, reason: longReason }).expect(200);
    expect(await auditOf(demoted)).toEqual([
      expect.objectContaining({ field: "role", oldValue: OrgRole.OWNER, newValue: OrgRole.FIELD_MANAGER, reason: longReason }),
    ]);

    // The member's current role again: nothing to change, nothing audited.
    const same = await patch(ctx.tokens.owner, rolePath(second.membership.id), { role: OrgRole.FIELD_MANAGER, reason: "No change" }).expect(200);
    expect(same.body.role).toBe(OrgRole.FIELD_MANAGER);
    expect(await auditOf(same)).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_ROLE_CHANGED" } })).toBe(2);
  });

  it("an organization keeps one or two active Owners: the last can't be demoted, suspended or archived; a suspended Owner doesn't count, and reactivating a third is refused", async () => {
    const ctx = await setup();
    const second = await addFieldManager(prisma, ctx.organizationId, SECOND_MANAGER_PHONE, "Rina Manager");
    const self = ctx.owner.membership.id;

    /** The caller is the only active Owner: they can't demote, suspend or archive themselves. */
    async function expectLastActiveOwner() {
      const attempts = [
        await patch(ctx.tokens.owner, `/memberships/${self}/role`, { role: OrgRole.FIELD_MANAGER, reason: "Stepping back" }),
        await post(ctx.tokens.owner, `/memberships/${self}/suspend`, { reason: "Long holiday" }),
        await post(ctx.tokens.owner, `/memberships/${self}/archive`, { reason: "Leaving" }),
      ];
      for (const response of attempts) expect({ status: response.status, code: response.body.code }).toEqual({ status: 409, code: "LAST_ACTIVE_OWNER" });
      expect(await membershipOf(self)).toMatchObject({ role: OrgRole.OWNER, status: AccountStatus.ACTIVE, archivedAt: null });
    }

    await expectLastActiveOwner();

    // A second Owner, then suspended: the first is again the only active one.
    await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/role`, { role: OrgRole.OWNER, reason: "Co-owner" }).expect(200);
    await post(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/suspend`, { reason: "Under investigation" }).expect(201);
    await expectLastActiveOwner();

    // The suspended Owner leaves room for another active one; reactivating them would then make a third.
    await patch(ctx.tokens.owner, `/memberships/${second.membership.id}/role`, { role: OrgRole.OWNER, reason: "Co-owner" }).expect(200);
    const third = await post(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/reactivate`, { reason: "Investigation closed" }).expect(409);
    expect(third.body.code).toBe("MAX_OWNERS_REACHED");
    expect((await membershipOf(ctx.manager.membership.id)).status).toBe(AccountStatus.SUSPENDED);

    // With another active Owner, an Owner may step down -- and loses the users page on their very next request.
    const stepDown = await patch(ctx.tokens.owner, `/memberships/${self}/role`, { role: OrgRole.FIELD_MANAGER, reason: "Stepping back" }).expect(200);
    expect(stepDown.body).toMatchObject({ id: self, role: OrgRole.FIELD_MANAGER, isSelf: true });
    await get(ctx.tokens.owner, "/memberships").expect(403);
  });

  it("a Worker always has time tracking: becoming a Worker needs it, and it can't be turned off for one", async () => {
    const ctx = await setup();
    const toWorker = await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/role`, {
      role: OrgRole.WORKER,
      reason: "Back to field work",
    }).expect(409);
    expect(toWorker.body.code).toBe("ROLE_REQUIRES_TIME_TRACKING");
    const off = await patch(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/time-tracking`, {
      isTimeTrackable: false,
      reason: "Office work",
    }).expect(409);
    expect(off.body.code).toBe("ROLE_REQUIRES_TIME_TRACKING");
    expect(await membershipOf(ctx.manager.membership.id)).toMatchObject({ role: OrgRole.FIELD_MANAGER, isTimeTrackable: false });
    expect(await membershipOf(ctx.worker.membership.id)).toMatchObject({ role: OrgRole.WORKER, isTimeTrackable: true });

    // With time tracking on first, the Field Manager can become a Worker.
    await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/time-tracking`, { isTimeTrackable: true, reason: "Works shifts too" }).expect(200);
    const changed = await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/role`, {
      role: OrgRole.WORKER,
      reason: "Back to field work",
    }).expect(200);
    expect(changed.body).toMatchObject({ role: OrgRole.WORKER, isTimeTrackable: true, workerProfileId: expect.any(String) });
  });

  it("time tracking: on creates a worker profile and the member can clock in at once; off is refused during an open entry, and then refuses clock-in", async () => {
    const ctx = await setup();
    const path = `/memberships/${ctx.manager.membership.id}/time-tracking`;
    expect(await prisma.workerProfile.count({ where: { membershipId: ctx.manager.membership.id } })).toBe(0);

    await patch(ctx.tokens.owner, path, { isTimeTrackable: true }).expect(400);
    await patch(ctx.tokens.owner, path, { isTimeTrackable: true, reason: " " }).expect(400);
    await patch(ctx.tokens.owner, path, { reason: "Works shifts too" }).expect(400);
    const on = await patch(ctx.tokens.owner, path, { isTimeTrackable: true, reason: "Works shifts too" }).expect(200);
    const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { membershipId: ctx.manager.membership.id } });
    expect(profile.organizationId).toBe(ctx.organizationId);
    expect(on.body).toMatchObject({ id: ctx.manager.membership.id, role: OrgRole.FIELD_MANAGER, isTimeTrackable: true, workerProfileId: profile.id });
    expect(await auditOf(on)).toEqual([
      expect.objectContaining({
        actorUserId: ctx.owner.user.id,
        action: "MEMBERSHIP_TIME_TRACKING_CHANGED",
        entityType: "OrganizationMembership",
        entityId: ctx.manager.membership.id,
        field: "isTimeTrackable",
        oldValue: "false",
        newValue: "true",
        reason: "Works shifts too",
      }),
    ]);

    // On a shift, the manager clocks in with the token issued before time tracking was on (it is read live).
    await assignWorkerToShift(prisma, ctx.shift.id, profile.id, ctx.owner.user.id);
    await clock(ctx.tokens.manager, "clock-in", { shiftId: ctx.shift.id }).expect(201);
    const open = await patch(ctx.tokens.owner, path, { isTimeTrackable: false, reason: "Office only" }).expect(409);
    expect(open.body.code).toBe("ACTIVE_TIME_ENTRY_EXISTS");
    expect((await membershipOf(ctx.manager.membership.id)).isTimeTrackable).toBe(true);
    await clock(ctx.tokens.manager, "clock-out", { summaryText: "Supervised the lane closure.", taskCategory: "TRAFFIC_CONTROL" }).expect(201);

    // Off: the worker profile stays (history), but the member can no longer clock in.
    const off = await patch(ctx.tokens.owner, path, { isTimeTrackable: false, reason: "Office only" }).expect(200);
    expect(off.body).toMatchObject({ isTimeTrackable: false, workerProfileId: profile.id });
    expect(await auditOf(off)).toEqual([expect.objectContaining({ field: "isTimeTrackable", oldValue: "true", newValue: "false", reason: "Office only" })]);
    const refused = await clock(ctx.tokens.manager, "clock-in", { shiftId: ctx.shift.id }).expect(403);
    expect(refused.body.code).toBe("FORBIDDEN");
    expect(await prisma.timeEntry.count({ where: { workerProfileId: profile.id } })).toBe(1);

    // On again: the same profile, and clock-in works again.
    await patch(ctx.tokens.owner, path, { isTimeTrackable: true, reason: "Back on shifts" }).expect(200);
    expect(await prisma.workerProfile.count({ where: { membershipId: ctx.manager.membership.id } })).toBe(1);
    await clock(ctx.tokens.manager, "clock-in", { shiftId: ctx.shift.id }).expect(201);
  });

  it("the role is read live: the same token follows a role change on its very next request, and an open socket reconnects with the new role", async () => {
    const ctx = await setup();
    // A Worker needs time tracking: the Field Manager gets it first.
    await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/time-tracking`, { isTimeTrackable: true, reason: "Works shifts too" }).expect(200);
    await get(ctx.tokens.manager, "/attendance/entries").expect(200);
    await get(ctx.tokens.worker, "/attendance/entries").expect(403);
    const managerSocket = await connectSocket(ctx.tokens.manager, ctx.manager.membership.id);
    const workerSocket = await connectSocket(ctx.tokens.worker, ctx.worker.membership.id);

    await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/role`, { role: OrgRole.WORKER, reason: "Back to field work" }).expect(200);
    await patch(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/role`, { role: OrgRole.FIELD_MANAGER, reason: "Promoted" }).expect(200);

    // The very next request with the same tokens has the new role.
    await get(ctx.tokens.manager, "/attendance/entries").expect(403);
    await get(ctx.tokens.manager, "/organizations/me/settings").expect(403);
    await get(ctx.tokens.worker, "/attendance/entries").expect(200);
    await get(ctx.tokens.worker, "/organizations/me/settings").expect(200);
    await get(ctx.tokens.worker, "/memberships").expect(403);

    // Their open sockets were closed; the sessions themselves are valid, so they reconnect -- with the new roles.
    expect(await disconnectReasonOf(managerSocket)).toBe("io server disconnect");
    expect(await disconnectReasonOf(workerSocket)).toBe("io server disconnect");
    const demoted = await connectSocket(ctx.tokens.manager, ctx.manager.membership.id);
    const promoted = await connectSocket(ctx.tokens.worker, ctx.worker.membership.id);
    // The promoted one now gets the live operations events...
    await post(ctx.tokens.owner, "/shifts/temporary-check-in-points", {
      shiftId: ctx.shift.id,
      name: "North gate",
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
    }).expect(201);
    await waitForEvent(promoted, "operations", (payload) => payload.kind === "TEMPORARY_POINT");
    // ...the demoted one no longer does (one socket's messages arrive in order: a notification sent afterwards marks the point).
    await app.get(NotificationsService).notify({
      organizationId: ctx.organizationId,
      recipientUserId: ctx.manager.user.id,
      type: NotificationType.SHIFT_APPROVED,
      title: "Marker",
      body: "Sent after the operations event.",
    });
    await waitForEvent(demoted, "notification", (payload) => payload.title === "Marker");
    expect(demoted.received.map(({ event }) => event)).toEqual(["notification"]);
  });

  // ── Suspension and archiving ───────────────────────────────────────────

  it("suspending a member ends every session at once (REST, refresh, socket.io, SSE); reactivation is only from SUSPENDED, and the member then signs in again", async () => {
    const ctx = await setup();
    const phone = ctx.sessions.manager;
    const tablet = await loginAs(app, MANAGER_PHONE, "manager-tablet");
    const socket = await connectSocket(phone.accessToken, ctx.manager.membership.id);
    const stream = openSse(tablet.accessToken);
    expect(await sseStatus(stream)).toBe(200);
    await get(phone.accessToken, "/shifts").expect(200);

    await post(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/suspend`, { reason: "" }).expect(400);
    const suspended = await post(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/suspend`, { reason: "Under investigation" }).expect(201);
    expect(suspended.body).toMatchObject({ id: ctx.manager.membership.id, status: AccountStatus.SUSPENDED });
    expect(await auditOf(suspended)).toEqual([
      expect.objectContaining({
        actorUserId: ctx.owner.user.id,
        action: "MEMBERSHIP_SUSPENDED",
        entityType: "OrganizationMembership",
        entityId: ctx.manager.membership.id,
        field: "status",
        oldValue: AccountStatus.ACTIVE,
        newValue: AccountStatus.SUSPENDED,
        reason: "Under investigation",
      }),
    ]);

    // Open connections are closed...
    expect(await disconnectReasonOf(socket)).toBe("io server disconnect");
    await waitFor(() => stream.ended, "the server to end the SSE stream");
    // ...every access token is refused on its next call, every refresh token is dead, and the sessions are revoked in the database.
    for (const session of [phone, tablet]) {
      expect((await get(session.accessToken, "/shifts").expect(401)).body.code).toBe("UNAUTHENTICATED");
      expect((await refresh(session.refreshToken).expect(401)).body.code).toBe("REFRESH_TOKEN_REVOKED");
    }
    const families = await prisma.refreshTokenFamily.findMany({ where: { membershipId: ctx.manager.membership.id } });
    expect(families.map((family) => family.id).sort()).toEqual([sessionIdOf(phone), sessionIdOf(tablet)].sort());
    for (const family of families) expect(family).toMatchObject({ revokedAt: expect.any(Date), revokedReason: "MEMBERSHIP_SUSPENDED" });
    // The old token can't open a new connection or stream, and the member can't sign in.
    await expectSocketRefused(phone.accessToken);
    expect(await sseStatus(openSse(phone.accessToken))).toBe(401);
    const signIn = await verifyOtp(MANAGER_PHONE, "manager-phone-2");
    expect({ status: signIn.status, code: signIn.body.code }).toEqual({ status: 403, code: "NO_ACTIVE_MEMBERSHIP" });

    // Other members are not affected; suspending again is a conflict.
    await get(ctx.tokens.owner, "/memberships").expect(200);
    await get(ctx.tokens.worker, "/shifts").expect(200);
    expect((await post(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/suspend`, { reason: "Again" }).expect(409)).body.code).toBe("CONFLICT");

    // Reactivation: only from SUSPENDED, with a reason, audited.
    const notSuspended = await post(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/reactivate`, { reason: "Not suspended" }).expect(409);
    expect(notSuspended.body.code).toBe("CONFLICT");
    await post(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/reactivate`, {}).expect(400);
    const reactivated = await post(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/reactivate`, { reason: "Investigation closed" }).expect(201);
    expect(reactivated.body).toMatchObject({ id: ctx.manager.membership.id, status: AccountStatus.ACTIVE });
    expect(await auditOf(reactivated)).toEqual([
      expect.objectContaining({
        action: "MEMBERSHIP_REACTIVATED",
        entityId: ctx.manager.membership.id,
        field: "status",
        oldValue: AccountStatus.SUSPENDED,
        newValue: AccountStatus.ACTIVE,
        reason: "Investigation closed",
      }),
    ]);
    // The ended sessions stay ended; signing in again works.
    await get(phone.accessToken, "/shifts").expect(401);
    const fresh = await loginAs(app, MANAGER_PHONE, "manager-phone-2");
    await get(fresh.accessToken, "/shifts").expect(200);
  });

  it("archiving ends the member's sessions like a suspension and is final: every later action on them is refused with MEMBERSHIP_ARCHIVED", async () => {
    const ctx = await setup();
    const socket = await connectSocket(ctx.tokens.worker, ctx.worker.membership.id);
    const path = (action: string) => `/memberships/${ctx.worker.membership.id}/${action}`;

    await post(ctx.tokens.owner, path("archive"), {}).expect(400);
    const archived = await post(ctx.tokens.owner, path("archive"), { reason: "Left the company" }).expect(201);
    expect(archived.body).toMatchObject({ id: ctx.worker.membership.id, status: AccountStatus.ARCHIVED, archivedAt: expect.any(String) });
    expect(await auditOf(archived)).toEqual([
      expect.objectContaining({
        actorUserId: ctx.owner.user.id,
        action: "MEMBERSHIP_ARCHIVED",
        entityId: ctx.worker.membership.id,
        field: "status",
        oldValue: AccountStatus.ACTIVE,
        newValue: AccountStatus.ARCHIVED,
        reason: "Left the company",
      }),
    ]);

    // The sessions end at once, and the member can't sign in.
    expect(await disconnectReasonOf(socket)).toBe("io server disconnect");
    await get(ctx.tokens.worker, "/shifts").expect(401);
    expect((await refresh(ctx.sessions.worker.refreshToken).expect(401)).body.code).toBe("REFRESH_TOKEN_REVOKED");
    expect(await prisma.refreshTokenFamily.findMany({ where: { membershipId: ctx.worker.membership.id } })).toEqual([
      expect.objectContaining({ id: sessionIdOf(ctx.sessions.worker), revokedAt: expect.any(Date), revokedReason: "MEMBERSHIP_ARCHIVED" }),
    ]);
    const signIn = await verifyOtp(WORKER_PHONE, "worker-phone-2");
    expect({ status: signIn.status, code: signIn.body.code }).toEqual({ status: 403, code: "NO_ACTIVE_MEMBERSHIP" });

    // Final: every action on the member is refused, and nothing changes.
    const attempts: Array<[string, Response]> = [
      ["role", await patch(ctx.tokens.owner, path("role"), { role: OrgRole.FIELD_MANAGER, reason: "Rehired" })],
      ["suspend", await post(ctx.tokens.owner, path("suspend"), { reason: "Again" })],
      ["reactivate", await post(ctx.tokens.owner, path("reactivate"), { reason: "Rehired" })],
      ["archive", await post(ctx.tokens.owner, path("archive"), { reason: "Again" })],
      ["time-tracking", await patch(ctx.tokens.owner, path("time-tracking"), { isTimeTrackable: false, reason: "Rehired" })],
    ];
    for (const [action, response] of attempts) {
      expect({ action, status: response.status, code: response.body.code }).toEqual({ action, status: 409, code: "MEMBERSHIP_ARCHIVED" });
    }
    expect(await membershipOf(ctx.worker.membership.id)).toMatchObject({ role: OrgRole.WORKER, status: AccountStatus.ARCHIVED, isTimeTrackable: true });
    expect(await prisma.auditLog.count({ where: { action: { in: MEMBER_ACTIONS } } })).toBe(1);
  });

  // ── Sessions and devices ───────────────────────────────────────────────

  it("devices and sessions: each device with its sessions and key; ending one session cuts its tokens and socket at once and leaves the member's others", async () => {
    const ctx = await setup();
    const phone = await loginAs(app, WORKER_PHONE, "worker-phone");
    const tablet = await loginAs(app, WORKER_PHONE, "worker-tablet");
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    await post(phone.accessToken, "/devices/public-key", { deviceId: "worker-phone", publicKey: keyPair.publicKeyBase64 }).expect(201);
    const devicesPath = `/memberships/${ctx.worker.membership.id}/devices`;

    const devices = await get(ctx.tokens.owner, devicesPath).expect(200);
    expect(devices.body.map((device: { clientDeviceId: string }) => device.clientDeviceId).sort()).toEqual(["test-device", "worker-phone", "worker-tablet"]);
    const phoneDevice = await prisma.userDevice.findFirstOrThrow({ where: { userId: ctx.worker.user.id, clientDeviceId: "worker-phone" } });
    expect(deviceIn(devices.body, "worker-phone")).toEqual({
      id: phoneDevice.id,
      clientDeviceId: "worker-phone",
      platform: "WEB",
      appVersion: null,
      osVersion: null,
      lastActiveAt: expect.any(String),
      key: { status: "ACTIVE", registeredAt: expect.any(String), revokedAt: null },
      sessions: [
        {
          id: sessionIdOf(phone),
          origin: "OTP",
          createdAt: expect.any(String),
          lastUsedAt: expect.any(String),
          revokedAt: null,
          revokedReason: null,
          active: true,
        },
      ],
    });
    expect(deviceIn(devices.body, "worker-tablet")).toMatchObject({
      key: { status: "NONE", registeredAt: null, revokedAt: null },
      sessions: [{ id: sessionIdOf(tablet), revokedAt: null, active: true }],
    });

    const phoneSocket = await connectSocket(phone.accessToken, ctx.worker.membership.id);
    const tabletSocket = await connectSocket(tablet.accessToken, ctx.worker.membership.id);
    const revokePath = (sessionId: string) => `/memberships/${ctx.worker.membership.id}/sessions/${sessionId}/revoke`;

    await post(ctx.tokens.owner, revokePath(sessionIdOf(phone)), {}).expect(400);
    const revoked = await post(ctx.tokens.owner, revokePath(sessionIdOf(phone)), { reason: "Phone lost" }).expect(201);
    expect(revoked.body).toEqual({ id: sessionIdOf(phone), revokedAt: expect.any(String) });
    expect(await auditOf(revoked)).toEqual([
      expect.objectContaining({
        actorUserId: ctx.owner.user.id,
        action: "MEMBER_SESSION_REVOKED",
        entityType: "RefreshTokenFamily",
        entityId: sessionIdOf(phone),
        reason: "Phone lost",
      }),
    ]);

    // That session ends at once: its access token (which carries the session id), its refresh token, its socket.
    const refused = await get(phone.accessToken, "/shifts").expect(401);
    expect(refused.body.message).toMatch(/session has ended/);
    expect((await refresh(phone.refreshToken).expect(401)).body.code).toBe("REFRESH_TOKEN_REVOKED");
    expect(await disconnectReasonOf(phoneSocket)).toBe("io server disconnect");
    await expectSocketRefused(phone.accessToken);

    // The member's other sessions keep working: REST, refresh, and the open socket still gets notifications.
    await get(tablet.accessToken, "/shifts").expect(200);
    await get(ctx.tokens.worker, "/shifts").expect(200);
    await refresh(tablet.refreshToken).expect(201);
    await app.get(NotificationsService).notify({
      organizationId: ctx.organizationId,
      recipientUserId: ctx.worker.user.id,
      type: NotificationType.SHIFT_APPROVED,
      title: "Still connected",
      body: "The tablet's session was not ended.",
    });
    await waitForEvent(tabletSocket, "notification", (payload) => payload.title === "Still connected");
    expect(tabletSocket.disconnectReason).toBeUndefined();

    // The devices list shows the ended session.
    const after = await get(ctx.tokens.owner, devicesPath).expect(200);
    expect(deviceIn(after.body, "worker-phone")).toMatchObject({
      sessions: [{ id: sessionIdOf(phone), revokedAt: expect.any(String), revokedReason: "REVOKED_BY_OWNER", active: false }],
    });
    expect(deviceIn(after.body, "worker-tablet")).toMatchObject({ sessions: [{ id: sessionIdOf(tablet), revokedAt: null, active: true }] });

    // Ending it again is a conflict; another member's session, an unknown or a malformed id are not found.
    expect((await post(ctx.tokens.owner, revokePath(sessionIdOf(phone)), { reason: "Again" }).expect(409)).body.code).toBe("CONFLICT");
    await post(ctx.tokens.owner, revokePath(sessionIdOf(ctx.sessions.manager)), { reason: "Wrong member" }).expect(404);
    await post(ctx.tokens.owner, revokePath(uuidv7()), { reason: "Unknown" }).expect(404);
    await post(ctx.tokens.owner, revokePath("not-a-uuid"), { reason: "Malformed" }).expect(404);
    await get(ctx.tokens.manager, "/shifts").expect(200);
  });

  it("revoking a device's offline-signing key: offline events signed with it are refused from then on", async () => {
    const ctx = await setup();
    const session = await loginAs(app, WORKER_PHONE, OFFLINE_DEVICE);
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    await post(session.accessToken, "/devices/public-key", { deviceId: OFFLINE_DEVICE, publicKey: keyPair.publicKeyBase64 }).expect(201);
    const sync = async (payload: OfflineEventSignablePayload) => {
      const signature = signOfflineEvent(canonicalizeOfflineEvent(payload), keyPair.secretKeyBase64);
      const response = await post(session.accessToken, "/offline-sync/batches", { deviceId: OFFLINE_DEVICE, events: [{ ...payload, signature }] }).expect(201);
      return response.body.results[0];
    };
    const offlineEvent = (secondsAgo: number) => ({
      clientEventId: uuidv7(),
      deviceTimestamp: new Date(Date.now() - secondsAgo * 1_000).toISOString(),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 12,
    });

    // Before: the device's signed offline clock-in is accepted.
    const clockIn = await sync({ ...offlineEvent(20), eventType: "CLOCK_IN", shiftId: ctx.shift.id });
    expect(clockIn).toMatchObject({ status: "VERIFIED", timeEntryId: expect.any(String) });

    const devicesPath = `/memberships/${ctx.worker.membership.id}/devices`;
    const device = deviceIn((await get(ctx.tokens.owner, devicesPath).expect(200)).body, OFFLINE_DEVICE)!;
    expect(device.key.status).toBe("ACTIVE");
    const revokeKeyPath = (deviceId: string) => `/memberships/${ctx.worker.membership.id}/devices/${deviceId}/revoke-key`;

    await post(ctx.tokens.owner, revokeKeyPath(device.id), { reason: "  " }).expect(400);
    const revoked = await post(ctx.tokens.owner, revokeKeyPath(device.id), { reason: "Phone stolen" }).expect(201);
    const key = await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: ctx.worker.user.id, deviceId: OFFLINE_DEVICE } });
    expect(key.revokedAt).not.toBeNull();
    expect(revoked.body).toEqual({ id: key.id, revokedAt: key.revokedAt!.toISOString() });
    expect(await auditOf(revoked)).toEqual([
      expect.objectContaining({
        actorUserId: ctx.owner.user.id,
        action: "DEVICE_PUBLIC_KEY_REVOKED",
        entityType: "DevicePublicKey",
        entityId: key.id,
        reason: "Phone stolen",
      }),
    ]);
    expect(deviceIn((await get(ctx.tokens.owner, devicesPath).expect(200)).body, OFFLINE_DEVICE)).toMatchObject({
      key: { status: "REVOKED", registeredAt: expect.any(String), revokedAt: key.revokedAt!.toISOString() },
    });
    expect((await post(ctx.tokens.owner, revokeKeyPath(device.id), { reason: "Again" }).expect(409)).body.code).toBe("CONFLICT");

    // After: the same device's signed clock-out is refused, and the entry stays open.
    const clockOutEvent = { ...offlineEvent(5), eventType: "CLOCK_OUT", summaryText: "Repaired a damaged sign while offline.", taskCategory: "TRAFFIC_SIGN" };
    expect(await sync(clockOutEvent)).toEqual({ clientEventId: clockOutEvent.clientEventId, status: "REJECTED", reason: "DEVICE_KEY_NOT_REGISTERED" });
    expect(await prisma.timeEntry.findUniqueOrThrow({ where: { id: clockIn.timeEntryId } })).toMatchObject({ status: "ACTIVE", clockOutAt: null });
    // The key is not the session: the device stays signed in.
    await get(session.accessToken, "/shifts").expect(200);

    // A device without a key, an unknown device and another member's device are not found.
    const keyless = deviceIn((await get(ctx.tokens.owner, devicesPath).expect(200)).body, "test-device")!;
    await post(ctx.tokens.owner, revokeKeyPath(keyless.id), { reason: "No key" }).expect(404);
    await post(ctx.tokens.owner, revokeKeyPath(uuidv7()), { reason: "Unknown" }).expect(404);
    const managerDevice = await prisma.userDevice.findFirstOrThrow({ where: { userId: ctx.manager.user.id } });
    await post(ctx.tokens.owner, revokeKeyPath(managerDevice.id), { reason: "Wrong member" }).expect(404);
  });

  // ── Access and organization scoping ────────────────────────────────────

  it("every users-page route is Owner-only, and another organization's Owner gets 404 for this organization's members on every route and changes nothing", async () => {
    const ctx = await setup();
    const phone = await loginAs(app, WORKER_PHONE, "worker-phone");
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    await post(phone.accessToken, "/devices/public-key", { deviceId: "worker-phone", publicKey: keyPair.publicKeyBase64 }).expect(201);
    const device = await prisma.userDevice.findFirstOrThrow({ where: { userId: ctx.worker.user.id, clientDeviceId: "worker-phone" } });
    const id = ctx.worker.membership.id;
    const reason = "Checking access";
    type Route = [method: "GET" | "PATCH" | "POST", path: string, body?: Record<string, unknown>];
    const memberRoutes: Route[] = [
      ["GET", `/memberships/${id}/devices`],
      ["PATCH", `/memberships/${id}/role`, { role: OrgRole.FIELD_MANAGER, reason }],
      ["POST", `/memberships/${id}/suspend`, { reason }],
      ["POST", `/memberships/${id}/reactivate`, { reason }],
      ["POST", `/memberships/${id}/archive`, { reason }],
      ["PATCH", `/memberships/${id}/time-tracking`, { isTimeTrackable: false, reason }],
      ["POST", `/memberships/${id}/sessions/${sessionIdOf(phone)}/revoke`, { reason }],
      ["POST", `/memberships/${id}/devices/${device.id}/revoke-key`, { reason }],
      // The older route: the member's user id and the client's own device id.
      ["POST", `/devices/${ctx.worker.user.id}/worker-phone/revoke-key`],
    ];
    const call = (token: string, [method, path, body = {}]: Route) =>
      method === "GET" ? get(token, path) : method === "PATCH" ? patch(token, path, body) : post(token, path, body);

    for (const route of [["GET", "/memberships"] as Route, ...memberRoutes]) {
      for (const [role, token] of [
        ["manager", ctx.tokens.manager],
        ["worker", ctx.tokens.worker],
      ]) {
        const response = await call(token, route);
        expect({ role, route: route.slice(0, 2), status: response.status }).toEqual({ role, route: route.slice(0, 2), status: 403 });
      }
    }

    const other = await otherOrganization();
    for (const route of memberRoutes) {
      const response = await call(other.ownerToken, route);
      expect({ route: route.slice(0, 2), status: response.status }).toEqual({ route: route.slice(0, 2), status: 404 });
    }
    // Nor through one of their own members: this organization's session and device are not theirs.
    await post(other.ownerToken, `/memberships/${other.worker.membership.id}/sessions/${sessionIdOf(phone)}/revoke`, { reason }).expect(404);
    await post(other.ownerToken, `/memberships/${other.worker.membership.id}/devices/${device.id}/revoke-key`, { reason }).expect(404);

    // Nothing changed: still an active, time-tracked Worker with a live session and key, and nothing audited.
    expect(await membershipOf(id)).toMatchObject({ role: OrgRole.WORKER, status: AccountStatus.ACTIVE, isTimeTrackable: true, archivedAt: null });
    expect(await prisma.refreshTokenFamily.count({ where: { membershipId: id, revokedAt: { not: null } } })).toBe(0);
    expect(await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: ctx.worker.user.id, deviceId: "worker-phone" } })).toMatchObject({
      revokedAt: null,
    });
    expect(await prisma.auditLog.count({ where: { action: { in: MEMBER_ACTIONS } } })).toBe(0);
    await get(phone.accessToken, "/shifts").expect(200);

    // Unknown and malformed member ids are 404 for this organization's Owner too.
    await get(ctx.tokens.owner, `/memberships/${uuidv7()}/devices`).expect(404);
    await get(ctx.tokens.owner, "/memberships/not-a-uuid/devices").expect(404);
    await patch(ctx.tokens.owner, "/memberships/not-a-uuid/role", { role: OrgRole.FIELD_MANAGER, reason }).expect(404);
    await post(ctx.tokens.owner, `/memberships/${uuidv7()}/suspend`, { reason }).expect(404);
    // The older revoke-key route still works for this organization's own Owner.
    await post(ctx.tokens.owner, `/devices/${ctx.worker.user.id}/worker-phone/revoke-key`).expect(201);
    expect((await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: ctx.worker.user.id, deviceId: "worker-phone" } })).revokedAt).not.toBeNull();
  });

  it("a member of two organizations: each organization sees and ends only the sessions and devices used in it", async () => {
    const ctx = await setup();
    const other = await otherOrganization();
    // The worker also manages for the other organization, from another phone.
    const elsewhereMembership = await addMembership(prisma, other.owner.org.id, ctx.worker.user.id, OrgRole.FIELD_MANAGER);
    const signedIn = await verifyOtp(WORKER_PHONE, "worker-other-phone", other.owner.org.id);
    expect(signedIn.status).toBe(201);
    const elsewhere: LoggedInUser = signedIn.body;
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    await post(elsewhere.accessToken, "/devices/public-key", { deviceId: "worker-other-phone", publicKey: keyPair.publicKeyBase64 }).expect(201);
    await get(elsewhere.accessToken, "/attendance/entries").expect(200);

    const clientIds = (devices: Array<{ clientDeviceId: string }>) => devices.map((device) => device.clientDeviceId);
    const here = await get(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/devices`).expect(200);
    expect(clientIds(here.body)).toEqual(["test-device"]);
    const there = await get(other.ownerToken, `/memberships/${elsewhereMembership.id}/devices`).expect(200);
    expect(clientIds(there.body)).toEqual(["worker-other-phone"]);

    // This organization can't end the other one's session or revoke the key of a device used only there.
    const reason = "Not this organization's";
    await post(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/sessions/${sessionIdOf(elsewhere)}/revoke`, { reason }).expect(404);
    await post(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/devices/${there.body[0].id}/revoke-key`, { reason }).expect(404);
    expect(await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: ctx.worker.user.id, deviceId: "worker-other-phone" } })).toMatchObject({
      revokedAt: null,
    });

    // Suspending the worker here ends only this organization's sessions.
    await post(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/suspend`, { reason: "Under investigation" }).expect(201);
    await get(ctx.tokens.worker, "/shifts").expect(401);
    await get(elsewhere.accessToken, "/attendance/entries").expect(200);
    await refresh(elsewhere.refreshToken).expect(201);
  });
});
