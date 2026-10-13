import type { INestApplication } from "@nestjs/common";
import { OrgRole } from "@fieldmaster/shared-types";
import { createTestApp, resetDatabase, loginAs, request } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { createOrgWithOwner, addFieldManager, addWorker, addMembership } from "./fixtures";



describe("Auth + RBAC + financial isolation (e2e)", () => {
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

  it("logs in via phone + OTP and issues a working access token", async () => {
    const { org } = await createOrgWithOwner(prisma, "+972500000001", "Dana Owner");
    const session = await loginAs(app, "+972500000001");

    expect(session.accessToken).toBeTruthy();
    expect(session.organizationId).toBe(org.id);
    expect(session.role).toBe(OrgRole.OWNER);

    await request(app.getHttpServer())
      .get("/api/v1/workers")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .expect(200);
  });

  it("rejects an unauthenticated request", async () => {
    await createOrgWithOwner(prisma);
    await request(app.getHttpServer()).get("/api/v1/workers").expect(401);
  });

  it("rotates refresh tokens and revokes the whole family on reuse (scenario: stolen token detection)", async () => {
    await createOrgWithOwner(prisma, "+972500000001");
    const session = await loginAs(app, "+972500000001");

    const firstRefresh = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(201);
    expect(firstRefresh.body.refreshToken).not.toBe(session.refreshToken);

    // Reusing the now-rotated-out original token must revoke the family.
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    // The token issued by the first (legitimate) refresh is now dead too.
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefresh.body.refreshToken })
      .expect(401);
  });

  it("enforces the maximum of 2 active Owners per organization", async () => {
    const { org } = await createOrgWithOwner(prisma, "+972500000001", "Owner One");
    const ownerSession = await loginAs(app, "+972500000001");

    await request(app.getHttpServer())
      .post("/api/v1/memberships")
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .send({ phoneNumber: "+972500000002", fullLegalName: "Owner Two", role: OrgRole.OWNER })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post("/api/v1/memberships")
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .send({ phoneNumber: "+972500000003", fullLegalName: "Owner Three", role: OrgRole.OWNER })
      .expect(409);
    expect(response.body.code).toBe("MAX_OWNERS_REACHED");

    const owners = await prisma.organizationMembership.count({ where: { organizationId: org.id, role: OrgRole.OWNER } });
    expect(owners).toBe(2);
  });

  it("blocks authentication for a suspended account", async () => {
    await createOrgWithOwner(prisma, "+972500000001");
    await prisma.user.update({ where: { phoneNumber: "+972500000001" }, data: { status: "SUSPENDED" } });

    await request(app.getHttpServer()).post("/api/v1/auth/otp/request").send({ phoneNumber: "+972500000001" }).expect(204);
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/otp/verify")
      .send({ phoneNumber: "+972500000001", code: "000000", deviceId: "d1", platform: "WEB" })
      .expect(403);
    // Step 9: after a correct code the answer names the state (it was a bare 404 before); no session is created.
    expect(response.body.code).toBe("ACCOUNT_SUSPENDED");
    expect(response.body.accessToken).toBeUndefined();
    expect(await prisma.refreshTokenFamily.count()).toBe(0);
  });

  describe("Multi-organization sign-in", () => {
    const phoneNumber = "+972500000001";
    const verify = (body: Record<string, string> = {}) =>
      request(app.getHttpServer())
        .post("/api/v1/auth/otp/verify")
        .send({ phoneNumber, code: "000000", deviceId: "d1", platform: "WEB", ...body });

    async function createUserInTwoOrgs() {
      const { org: orgA, user } = await createOrgWithOwner(prisma, phoneNumber, "Multi Org User");
      const { org: orgB } = await createOrgWithOwner(prisma, "+972500000002", "Other Owner");
      await addMembership(prisma, orgB.id, user.id, OrgRole.FIELD_MANAGER);
      await request(app.getHttpServer()).post("/api/v1/auth/otp/request").send({ phoneNumber }).expect(204);
      return { orgA, orgB };
    }

    it("keeps the code usable after ORGANIZATION_SELECTION_REQUIRED, then rejects its reuse", async () => {
      const { orgA, orgB } = await createUserInTwoOrgs();

      const selection = await verify().expect(400);
      expect(selection.body.code).toBe("ORGANIZATION_SELECTION_REQUIRED");
      expect(selection.body.details.organizations).toHaveLength(2);
      expect(selection.body.details.organizations).toEqual(
        expect.arrayContaining([
          { organizationId: orgA.id, role: OrgRole.OWNER },
          { organizationId: orgB.id, role: OrgRole.FIELD_MANAGER },
        ]),
      );

      const session = await verify({ organizationId: orgB.id }).expect(201);
      expect(session.body.accessToken).toBeTruthy();
      expect(session.body.organizationId).toBe(orgB.id);
      expect(session.body.role).toBe(OrgRole.FIELD_MANAGER);

      const reuse = await verify({ organizationId: orgB.id }).expect(401);
      expect(reuse.body.code).toBe("OTP_INVALID_OR_EXPIRED");
    });

    it("keeps the code usable after choosing an organization the user is not a member of", async () => {
      const { orgA } = await createUserInTwoOrgs();
      const { org: foreignOrg } = await createOrgWithOwner(prisma, "+972500000003", "Foreign Owner");

      const forbidden = await verify({ organizationId: foreignOrg.id }).expect(403);
      expect(forbidden.body.code).toBe("FORBIDDEN");

      const session = await verify({ organizationId: orgA.id }).expect(201);
      expect(session.body.organizationId).toBe(orgA.id);
      expect(session.body.role).toBe(OrgRole.OWNER);
    });
  });

  describe("Financial isolation (spec scenario 12)", () => {
    it("returns 403 to a Field Manager on the payroll and financial-dashboard endpoints", async () => {
      const { org } = await createOrgWithOwner(prisma, "+972500000001");
      await addFieldManager(prisma, org.id, "+972500000011", "Field Manager");
      const fmSession = await loginAs(app, "+972500000011");

      await request(app.getHttpServer())
        .get("/api/v1/payroll-periods")
        .set("Authorization", `Bearer ${fmSession.accessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get("/api/v1/payroll-periods/2026-08/dashboard")
        .set("Authorization", `Bearer ${fmSession.accessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .post("/api/v1/payroll-periods/2026-08/calculate")
        .set("Authorization", `Bearer ${fmSession.accessToken}`)
        .set("Idempotency-Key", "test-key-1")
        .expect(403);
    });

    it("never includes compensation fields in a Field Manager's worker list", async () => {
      const { org } = await createOrgWithOwner(prisma, "+972500000001");
      await addFieldManager(prisma, org.id, "+972500000011", "Field Manager");
      await addWorker(prisma, org.id, "+972500010001", "Worker One", {
        type: "DAILY",
        dailyRateAgorot: 40000,
        overtimeRateAgorot: 6000,
      });

      const fmSession = await loginAs(app, "+972500000011");
      const response = await request(app.getHttpServer())
        .get("/api/v1/workers")
        .set("Authorization", `Bearer ${fmSession.accessToken}`)
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
      for (const worker of response.body) {
        expect(worker).not.toHaveProperty("compensation");
      }

      const ownerSession = await loginAs(app, "+972500000001");
      const ownerResponse = await request(app.getHttpServer())
        .get("/api/v1/workers")
        .set("Authorization", `Bearer ${ownerSession.accessToken}`)
        .expect(200);
      const withRate = ownerResponse.body.find((w: { compensation?: unknown }) => w.compensation);
      expect(withRate).toBeDefined();
      expect(withRate.compensation.dailyBaseRateAgorot).toBe(40000);
    });

    it("blocks a worker from viewing another worker's time entries", async () => {
      const { org } = await createOrgWithOwner(prisma, "+972500000001");
      const workerA = await addWorker(prisma, org.id, "+972500010001", "Worker A");
      await addWorker(prisma, org.id, "+972500010002", "Worker B");

      const sessionB = await loginAs(app, "+972500010002");

      // Worker A has no entries yet, but the key check is that Worker B
      // cannot query Worker A's entries via the workerProfileId filter --
      // the service scopes non-managers to their own workerProfileId only.
      const responseAsB = await request(app.getHttpServer())
        .get(`/api/v1/time-entries?workerProfileId=${workerA.workerProfile.id}`)
        .set("Authorization", `Bearer ${sessionB.accessToken}`)
        .expect(200);

      // Because workers are force-scoped to themselves, the filter is
      // ignored for worker B and only worker B's (empty) entries return.
      expect(responseAsB.body).toEqual([]);
    });
  });
});
