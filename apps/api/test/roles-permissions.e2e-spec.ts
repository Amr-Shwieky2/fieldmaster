import type { INestApplication } from "@nestjs/common";
import { ALL_PERMISSIONS, AccountStatus, OrgRole, PERMISSION_GROUPS, Permission, SYSTEM_ROLE_PERMISSIONS } from "@fieldmaster/shared-types";
import { createTestApp, resetDatabase, request, loginAs } from "./test-app";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { MembershipsService } from "../src/modules/memberships/memberships.service";
import type { AuthenticatedUser } from "../src/common/auth/auth-context";
import type { AppException } from "../src/common/errors/app-exception";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";

/**
 * Roles and permissions (flexible organization model): the built-in roles keep
 * their permissions, an Owner builds custom roles from the catalog, a role's
 * permissions apply to the very next request, every change is audited old ->
 * new, an organization always keeps an administrator, and money is behind one
 * financial permission.
 */

const OWNER_PHONE = "+972500000001";
const SECOND_OWNER_PHONE = "+972500000002";
const THIRD_OWNER_PHONE = "+972500000003";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";
const MEMBER_PHONE = "+972500020001";
const SECOND_MEMBER_PHONE = "+972500020002";

describe("Roles and permissions (flexible organization model)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => app.getHttpServer();

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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => request(http()).post(`/api/v1${path}`).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: object = {}) => request(http()).patch(`/api/v1${path}`).set(auth(token)).send(body);

  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker", { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
    const project = await createProject(prisma, organizationId);
    await prisma.project.update({ where: { id: project.id }, data: { budgetAgorot: 50_000_000 } });
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, 32.0853, 34.7818, 100);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, new Date(Date.now() - 3_600_000), new Date(Date.now() + 8 * 3_600_000));
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);
    const tokens = {
      owner: (await loginAs(app, OWNER_PHONE)).accessToken,
      manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
      worker: (await loginAs(app, WORKER_PHONE)).accessToken,
    };
    return { organizationId, owner, manager, worker, project, shift, tokens };
  }

  /** A custom role and a member holding it (a new person, created the way an Owner does). */
  async function customMember(ctx: Awaited<ReturnType<typeof setup>>, permissions: Permission[], name = "Accountant", phone = MEMBER_PHONE) {
    const role = await post(ctx.tokens.owner, "/roles", { name, permissions }).expect(201);
    const member = await post(ctx.tokens.owner, "/memberships", { phoneNumber: phone, fullLegalName: `${name} Person`, roleId: role.body.id }).expect(201);
    return { roleId: role.body.id as string, membershipId: member.body.id as string, token: (await loginAs(app, phone)).accessToken };
  }

  it("lists the built-in roles first with today's permissions and member counts, and the catalog in the groups' order", async () => {
    const ctx = await setup();
    const roles = await get(ctx.tokens.owner, "/roles").expect(200);
    expect(roles.body.map((role: { systemKey: string | null }) => role.systemKey)).toEqual(["OWNER", "FIELD_MANAGER", "WORKER"]);
    expect(roles.body.map((role: { name: string }) => role.name)).toEqual(["المالك", "مدير ميدان", "عامل"]);
    for (const role of roles.body as { systemKey: "OWNER" | "FIELD_MANAGER" | "WORKER"; isSystem: boolean; permissions: string[]; memberCount: number }[]) {
      expect(role.isSystem).toBe(true);
      expect(role.permissions.sort()).toEqual([...SYSTEM_ROLE_PERMISSIONS[role.systemKey]].sort());
    }
    expect(roles.body.map((role: { memberCount: number }) => role.memberCount)).toEqual([1, 1, 1]);
    // Every existing member points at the role of their kind.
    const memberships = await prisma.organizationMembership.findMany({ where: { organizationId: ctx.organizationId }, include: { roleRecord: true } });
    for (const member of memberships) expect(member.roleRecord?.systemKey).toBe(member.role);

    const catalog = await get(ctx.tokens.owner, "/roles/catalog").expect(200);
    expect(catalog.body.groups.map((group: { group: string }) => group.group)).toEqual(PERMISSION_GROUPS.map((group) => group.group));
    const entries = catalog.body.groups.flatMap((group: { permissions: { permission: string }[] }) => group.permissions);
    expect(entries.map((entry: { permission: string }) => entry.permission).sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(entries.find((entry: { permission: string }) => entry.permission === Permission.VIEW_PAYROLL)).toMatchObject({ financial: true, organizationWide: true, requires: [Permission.VIEW_FINANCIALS] });

    // A Field Manager and a Worker cannot read the roles at all.
    await get(ctx.tokens.manager, "/roles").expect(403);
    await get(ctx.tokens.worker, "/roles/catalog").expect(403);
  });

  it("creates a custom role: the permissions must be complete and known, the name unique among active roles; every creation is audited", async () => {
    const ctx = await setup();
    const created = await post(ctx.tokens.owner, "/roles", {
      name: "  محاسب  ",
      description: "يرى المبالغ",
      permissions: [Permission.VIEW_PAYROLL, Permission.VIEW_FINANCIALS, Permission.VIEW_ATTENDANCE, Permission.VIEW_PAYROLL],
    }).expect(201);
    expect(created.body).toMatchObject({ name: "محاسب", description: "يرى المبالغ", isSystem: false, systemKey: null, memberCount: 0 });
    // Clean, de-duplicated, in the catalog's order.
    expect(created.body.permissions).toEqual([Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ROLE_CREATED", entityId: created.body.id } });
    expect(audit).toMatchObject({ actorUserId: ctx.owner.user.id, entityType: "Role", field: "permissions", newValue: created.body.permissions.join(","), note: "محاسب" });

    const incomplete = await post(ctx.tokens.owner, "/roles", { name: "Payroll clerk", permissions: [Permission.MANAGE_PAYROLL] }).expect(400);
    expect(incomplete.body.code).toBe("INVALID_ROLE_PERMISSIONS");
    expect(incomplete.body.details.problems).toEqual([{ permission: Permission.MANAGE_PAYROLL, kind: "MISSING_REQUIRED", missing: [Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL] }]);
    const unknown = await post(ctx.tokens.owner, "/roles", { name: "Pilot", permissions: ["FLY_THE_PLANE"] }).expect(400);
    expect(unknown.body.details.problems).toEqual([{ permission: "FLY_THE_PLANE", kind: "UNKNOWN" }]);
    await post(ctx.tokens.owner, "/roles", { name: "x", permissions: [] }).expect(400);
    await post(ctx.tokens.owner, "/roles", { name: "   ", permissions: [] }).expect(400);

    // Case-insensitive duplicates of an active role are refused; the Arabic name of a built-in role is free to reuse as a custom name only when no active role has it.
    expect((await post(ctx.tokens.owner, "/roles", { name: "محاسب", permissions: [] }).expect(409)).body.code).toBe("ROLE_NAME_TAKEN");
    await post(ctx.tokens.owner, "/roles", { name: "Site clerk", permissions: [] }).expect(201);
    expect((await post(ctx.tokens.owner, "/roles", { name: "SITE CLERK", permissions: [] }).expect(409)).body.code).toBe("ROLE_NAME_TAKEN");

    // Only whoever manages roles creates them.
    await post(ctx.tokens.manager, "/roles", { name: "Nope", permissions: [] }).expect(403);
  });

  it("a role's permissions apply to the very next request, and every change is audited old -> new; a member's role change is too", async () => {
    const ctx = await setup();
    const clerk = await customMember(ctx, [Permission.VIEW_ATTENDANCE]);

    // Nothing financial yet.
    await get(clerk.token, "/payroll-periods").expect(403);
    const before = await get(clerk.token, "/auth/me").expect(200);
    expect(before.body).toMatchObject({ role: OrgRole.CUSTOM, roleId: clerk.roleId, roleName: "Accountant", permissions: [Permission.VIEW_ATTENDANCE], workerProfileId: null });
    expect(before.body.scope).toEqual({ restricted: false, projectIds: [], siteIds: [], visibleProjectIds: [] });
    // The rules in force today are there for the apps, without the money rule.
    expect(before.body.workRules).toEqual({ standardDayMinutes: 540, overtimeThresholdMinutes: 540, emergencyMinutesBefore: 60, emergencyMinutesAfter: 15, clockInEarlyWindowMinutes: 60 });

    const granted = await patch(ctx.tokens.owner, `/roles/${clerk.roleId}`, {
      permissions: [Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL],
      reason: "Needs the payroll",
    }).expect(200);
    expect(granted.body.permissions).toEqual([Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL]);
    // The same access token, the very next request.
    await get(clerk.token, "/payroll-periods").expect(200);
    expect((await get(clerk.token, "/auth/me").expect(200)).body.permissions).toEqual([Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL]);

    await patch(ctx.tokens.owner, `/roles/${clerk.roleId}`, { permissions: [Permission.VIEW_ATTENDANCE], reason: "Not any more" }).expect(200);
    await get(clerk.token, "/payroll-periods").expect(403);

    await patch(ctx.tokens.owner, `/roles/${clerk.roleId}`, { name: "Payroll viewer", description: "Reads payroll" }).expect(200);
    const updates = await prisma.auditLog.findMany({ where: { action: "ROLE_UPDATED", entityId: clerk.roleId }, orderBy: { sequenceNumber: "asc" } });
    expect(updates.map((row) => ({ field: row.field, oldValue: row.oldValue, newValue: row.newValue, reason: row.reason }))).toEqual([
      { field: "permissions", oldValue: [Permission.VIEW_ATTENDANCE].join(","), newValue: [Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL].sort().join(","), reason: "Needs the payroll" },
      { field: "permissions", oldValue: [Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL].sort().join(","), newValue: [Permission.VIEW_ATTENDANCE].join(","), reason: "Not any more" },
      { field: "name", oldValue: "Accountant", newValue: "Payroll viewer", reason: null },
      { field: "description", oldValue: "", newValue: "Reads payroll", reason: null },
    ]);
    // Nothing changed: nothing audited.
    await patch(ctx.tokens.owner, `/roles/${clerk.roleId}`, { name: "Payroll viewer" }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: "ROLE_UPDATED", entityId: clerk.roleId } })).toBe(4);

    // Moving a Field Manager to the custom role, and back: audited old -> new, effective at once.
    const moved = await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/role`, { roleId: clerk.roleId, reason: "Reassigned" }).expect(200);
    expect(moved.body).toMatchObject({ role: OrgRole.CUSTOM });
    await get(ctx.tokens.manager, "/workers").expect(403);
    const roleAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBERSHIP_ROLE_CHANGED", entityId: ctx.manager.membership.id } });
    expect(roleAudit).toMatchObject({ field: "role", oldValue: OrgRole.FIELD_MANAGER, newValue: "CUSTOM:Payroll viewer", reason: "Reassigned" });
    await patch(ctx.tokens.owner, `/memberships/${ctx.manager.membership.id}/role`, { role: OrgRole.FIELD_MANAGER, reason: "Back" }).expect(200);
    await get(ctx.tokens.manager, "/workers").expect(200);
    // Both the kind and the role record follow.
    const row = await prisma.organizationMembership.findUniqueOrThrow({ where: { id: ctx.manager.membership.id }, include: { roleRecord: true } });
    expect(row).toMatchObject({ role: OrgRole.FIELD_MANAGER });
    expect(row.roleRecord?.systemKey).toBe("FIELD_MANAGER");
  });

  it("built-in roles cannot be edited or archived, a role with members cannot be archived, and an archived role's name is free again", async () => {
    const ctx = await setup();
    const roles = (await get(ctx.tokens.owner, "/roles").expect(200)).body as { id: string; systemKey: string | null }[];
    for (const role of roles) {
      expect((await patch(ctx.tokens.owner, `/roles/${role.id}`, { name: "Renamed" }).expect(409)).body.code).toBe("SYSTEM_ROLE_IMMUTABLE");
      expect((await post(ctx.tokens.owner, `/roles/${role.id}/archive`).expect(409)).body.code).toBe("SYSTEM_ROLE_IMMUTABLE");
    }

    const clerk = await customMember(ctx, [Permission.VIEW_ATTENDANCE], "Clerk");
    const detail = await get(ctx.tokens.owner, `/roles/${clerk.roleId}`).expect(200);
    expect(detail.body).toMatchObject({ memberCount: 1, members: [{ membershipId: clerk.membershipId, status: AccountStatus.ACTIVE }] });
    const blocked = await post(ctx.tokens.owner, `/roles/${clerk.roleId}/archive`, { reason: "Tidy up" }).expect(409);
    expect(blocked.body).toMatchObject({ code: "ROLE_IN_USE", details: { memberCount: 1 } });

    await patch(ctx.tokens.owner, `/memberships/${clerk.membershipId}/role`, { role: OrgRole.FIELD_MANAGER, reason: "Promoted" }).expect(200);
    const archived = await post(ctx.tokens.owner, `/roles/${clerk.roleId}/archive`, { reason: "Tidy up" }).expect(201);
    expect(archived.body.archivedAt).not.toBeNull();
    expect((await get(ctx.tokens.owner, "/roles").expect(200)).body.map((role: { id: string }) => role.id)).not.toContain(clerk.roleId);
    expect((await get(ctx.tokens.owner, "/roles?includeArchived=true").expect(200)).body.map((role: { id: string }) => role.id)).toContain(clerk.roleId);
    await post(ctx.tokens.owner, "/roles", { name: "Clerk", permissions: [] }).expect(201);
    // An archived role cannot be given to anyone.
    await patch(ctx.tokens.owner, `/memberships/${ctx.worker.membership.id}/role`, { roleId: clerk.roleId, reason: "x" }).expect(404);
    expect(await prisma.auditLog.count({ where: { action: "ROLE_ARCHIVED", entityId: clerk.roleId } })).toBe(1);
  });

  it("an organization always keeps one active administrator: nobody can demote, suspend, archive or strip the last one", async () => {
    const ctx = await setup();
    const admin = await customMember(ctx, [Permission.VIEW_ORG_SETTINGS, Permission.MANAGE_ORG_SETTINGS, Permission.MANAGE_ROLES, Permission.MANAGE_ORG_USERS], "Administrator");

    // The Owner is no longer needed: with the custom administrator in place the Owner may step down.
    await patch(admin.token, `/memberships/${ctx.owner.membership.id}/role`, { role: OrgRole.FIELD_MANAGER, reason: "Handing over" }).expect(200);

    // Now the custom administrator is the last one.
    for (const attempt of [
      () => patch(admin.token, `/memberships/${admin.membershipId}/role`, { role: OrgRole.FIELD_MANAGER, reason: "Stepping back" }),
      () => post(admin.token, `/memberships/${admin.membershipId}/suspend`, { reason: "Holiday" }),
      () => post(admin.token, `/memberships/${admin.membershipId}/archive`, { reason: "Leaving" }),
      () => patch(admin.token, `/roles/${admin.roleId}`, { permissions: [Permission.VIEW_ORG_SETTINGS, Permission.MANAGE_ORG_USERS], reason: "Oops" }),
    ]) {
      const response = await attempt();
      expect({ status: response.status, code: response.body.code }).toEqual({ status: 409, code: "LAST_ADMIN" });
    }
    // Restricting the last administrator to a project would take their organization-wide permissions away too.
    const scoped = await patch(admin.token, `/memberships/${admin.membershipId}/scope`, { restricted: true, projectIds: [ctx.project.id], reason: "Oops" });
    expect({ status: scoped.status, code: scoped.body.code }).toEqual({ status: 409, code: "LAST_ADMIN" });
    // Nothing changed.
    expect((await get(admin.token, "/auth/me").expect(200)).body.permissions).toContain(Permission.MANAGE_ROLES);

    // A second administrator makes the first one free to go; changing a role that leaves another administrator is fine.
    await patch(admin.token, `/memberships/${ctx.owner.membership.id}/role`, { role: OrgRole.OWNER, reason: "Back" }).expect(200);
    await patch(admin.token, `/roles/${admin.roleId}`, { permissions: [Permission.VIEW_ORG_SETTINGS, Permission.MANAGE_ORG_USERS], reason: "Fine now" }).expect(200);
    // (Still reads the roles through MANAGE_ORG_USERS, but no longer changes them.)
    await get(admin.token, "/roles").expect(200);
    await patch(admin.token, `/roles/${admin.roleId}`, { name: "Renamed" }).expect(403);
    await patch(ctx.tokens.owner, `/roles/${admin.roleId}`, { permissions: [Permission.VIEW_ORG_SETTINGS], reason: "Fine too" }).expect(200);
    await get(admin.token, "/roles").expect(403);
  });

  it("two simultaneous attempts to remove the only two administrators leave one", async () => {
    const ctx = await setup();
    const second = await createOrgSecondOwner(ctx);
    const secondUserId = (await prisma.organizationMembership.findUniqueOrThrow({ where: { id: second.membershipId } })).userId;
    const activeOwners = () => prisma.organizationMembership.count({ where: { organizationId: ctx.organizationId, role: OrgRole.OWNER, status: AccountStatus.ACTIVE } });

    // On the service, both changes are past the permission check before either commits: the advisory lock alone decides.
    const memberships = app.get(MembershipsService);
    const actor = (sub: string, membershipId: string) =>
      ({ sub, organizationId: ctx.organizationId, membershipId, role: OrgRole.OWNER, workerProfileId: null, permissions: new Set(ALL_PERMISSIONS), scope: { restricted: false } }) as unknown as AuthenticatedUser;
    const results = await Promise.allSettled([
      memberships.changeRole(ctx.organizationId, second.membershipId, { role: OrgRole.FIELD_MANAGER, reason: "A" }, actor(ctx.owner.user.id, ctx.owner.membership.id), uuidv7()),
      memberships.changeRole(ctx.organizationId, ctx.owner.membership.id, { role: OrgRole.FIELD_MANAGER, reason: "B" }, actor(secondUserId, second.membershipId), uuidv7()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refusals = results.flatMap((result) => (result.status === "rejected" ? [result.reason as AppException] : []));
    expect(refusals.map((error) => ({ status: error.getStatus(), code: error.code }))).toEqual([{ status: 409, code: "LAST_ACTIVE_OWNER" }]);
    expect(await activeOwners()).toBe(1);

    // Over HTTP the same race ends the same way: one change passes, the other is refused -- by the lock (409), or by
    // the guard (403) when the first change was committed before the second request was authorized.
    const remaining = results[0].status === "fulfilled" ? ctx.tokens.owner : second.token;
    const remainingMembershipId = results[0].status === "fulfilled" ? ctx.owner.membership.id : second.membershipId;
    const third = await createOrgSecondOwner(ctx, THIRD_OWNER_PHONE, remaining);
    const responses = await Promise.all([
      patch(remaining, `/memberships/${third.membershipId}/role`, { role: OrgRole.FIELD_MANAGER, reason: "C" }),
      patch(third.token, `/memberships/${remainingMembershipId}/role`, { role: OrgRole.FIELD_MANAGER, reason: "D" }),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect([[200, 403], [200, 409]]).toContainEqual(statuses);
    expect(await activeOwners()).toBe(1);
  });

  async function createOrgSecondOwner(ctx: Awaited<ReturnType<typeof setup>>, phoneNumber = SECOND_OWNER_PHONE, byToken = ctx.tokens.owner) {
    const created = await post(byToken, "/memberships", { phoneNumber, fullLegalName: "Another Owner", role: OrgRole.OWNER }).expect(201);
    return { membershipId: created.body.id as string, token: (await loginAs(app, phoneNumber)).accessToken };
  }

  it("money is behind the one financial permission: a project's budget, a worker's pay and the penalty only with it", async () => {
    const ctx = await setup();
    const noMoney = await customMember(ctx, [Permission.VIEW_SHIFTS, Permission.MANAGE_WORKERS, Permission.MANAGE_SITES, Permission.VIEW_ATTENDANCE, Permission.VIEW_ORG_SETTINGS], "No money", MEMBER_PHONE);
    const withMoney = await customMember(
      ctx,
      [Permission.VIEW_SHIFTS, Permission.MANAGE_WORKERS, Permission.MANAGE_SITES, Permission.VIEW_ATTENDANCE, Permission.VIEW_ORG_SETTINGS, Permission.VIEW_FINANCIALS, Permission.VIEW_COMPENSATION],
      "With money",
      SECOND_MEMBER_PHONE,
    );

    for (const route of ["/shifts", "/projects"]) {
      expect(JSON.stringify((await get(noMoney.token, route).expect(200)).body)).not.toMatch(/budgetAgorot/);
      expect(JSON.stringify((await get(withMoney.token, route).expect(200)).body)).toMatch(/budgetAgorot/);
    }
    const workersNoMoney = (await get(noMoney.token, "/workers").expect(200)).body as { id: string; compensation?: unknown }[];
    expect(workersNoMoney.every((worker) => !("compensation" in worker))).toBe(true);
    const workersWithMoney = (await get(withMoney.token, "/workers").expect(200)).body as { id: string; compensation?: { dailyBaseRateAgorot: number | null } }[];
    expect(workersWithMoney.find((worker) => worker.id === ctx.worker.workerProfile.id)?.compensation?.dailyBaseRateAgorot).toBe(40_000);
    expect((await get(noMoney.token, "/organizations/me/settings").expect(200)).body.fixedRules).not.toHaveProperty("forgottenStampPenaltyAgorot");
    expect((await get(withMoney.token, "/organizations/me/settings").expect(200)).body.fixedRules).toHaveProperty("forgottenStampPenaltyAgorot", 1_000);
    // The money routes themselves.
    await get(noMoney.token, `/workers/${ctx.worker.workerProfile.id}/estimated-earnings?month=2026-10`).expect(403);
    await get(withMoney.token, `/workers/${ctx.worker.workerProfile.id}/compensation-profiles`).expect(200);
  });

  it("the built-in roles behave as before: an Owner sees payroll and the users page, a Field Manager neither", async () => {
    const ctx = await setup();
    await get(ctx.tokens.owner, "/payroll-periods").expect(200);
    await get(ctx.tokens.owner, "/memberships").expect(200);
    await get(ctx.tokens.manager, "/payroll-periods").expect(403);
    await get(ctx.tokens.manager, "/memberships").expect(403);
    expect((await get(ctx.tokens.owner, "/auth/me").expect(200)).body.permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect((await get(ctx.tokens.worker, "/auth/me").expect(200)).body).toMatchObject({ role: OrgRole.WORKER, permissions: [Permission.CLOCK_IN_OUT, Permission.VIEW_OWN_ATTENDANCE].sort(), workerProfileId: ctx.worker.workerProfile.id });
  });
});
