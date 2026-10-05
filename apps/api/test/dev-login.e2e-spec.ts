import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { INestApplication, RequestMethod } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { v7 as uuidv7 } from "uuid";
import { createTestApp, resetDatabase, request } from "./test-app";
import { addFieldManager, addWorker, createOrgWithOwner } from "./fixtures";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { AppConfigModule } from "../src/common/config/app-config.module";
import { PERMISSIONS_KEY } from "../src/common/decorators/require-permissions.decorator";
import { FINANCIAL_PERMISSIONS, type Permission } from "../src/common/auth/permissions";

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";

/** Sets env vars for the duration of a describe block (the API reads them when the app module is created). */
function useEnv(vars: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [key, value] of Object.entries(vars)) {
      previous[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function seedMembers(app: INestApplication) {
  await resetDatabase(app);
  const prisma = app.get(PrismaService);
  const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
  const manager = await addFieldManager(prisma, owner.org.id, MANAGER_PHONE, "Yossi Manager");
  const worker = await addWorker(prisma, owner.org.id, WORKER_PHONE, "Eli Worker", {
    type: "DAILY",
    dailyRateAgorot: 50_000,
    overtimeRateAgorot: 7_000,
  });
  return { owner, manager, worker };
}

interface DiscoveredRoute {
  method: string;
  /** Route template, e.g. "/api/v1/payroll-periods/:yearMonth". */
  template: string;
  /** Template with params filled in for a request. */
  path: string;
  permissions: Permission[];
}

/**
 * The financial routes that must carry a financial @RequirePermissions,
 * maintained by hand on purpose: the discovered set below must match it
 * exactly, so removing a decorator (or adding a financial route without one)
 * fails this test instead of silently shrinking what it checks.
 */
const EXPECTED_DECORATED_FINANCIAL_ROUTES = [
  "GET /api/v1/payroll-periods",
  "GET /api/v1/payroll-periods/:yearMonth",
  "GET /api/v1/payroll-periods/:yearMonth/dashboard",
  "POST /api/v1/payroll-periods/:yearMonth/calculate",
  "POST /api/v1/payroll-periods/:yearMonth/finalize",
  "POST /api/v1/payroll-periods/:yearMonth/reopen",
  "POST /api/v1/payroll-periods/:yearMonth/adjustments",
  "POST /api/v1/workers/:id/approve",
  "POST /api/v1/workers/:id/compensation-profiles",
  "POST /api/v1/forgotten-stamp-infractions/:id/reverse",
].sort();

/**
 * Every route whose @RequirePermissions includes a financial permission,
 * discovered from Nest's own route metadata. Routes whose financial check
 * lives in the service layer instead of a decorator (GET
 * /workers/:id/compensation-profiles) are not discoverable this way and are
 * tested explicitly below.
 */
function discoverFinancialRoutes(app: INestApplication): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
      if (!controller) continue;
      const basePath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");
      const classPermissions: Permission[] = Reflect.getMetadata(PERMISSIONS_KEY, controller) ?? [];
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") continue;
        const handler = controller.prototype[name];
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler);
        if (methodPath === undefined) continue;
        const permissions: Permission[] = Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? classPermissions;
        if (!permissions.some((p) => FINANCIAL_PERMISSIONS.has(p))) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        const segments = [basePath, String(methodPath)].flatMap((part) => part.split("/")).filter(Boolean);
        const filled = segments.map((segment) => (segment === ":yearMonth" ? "2026-09" : segment.startsWith(":") ? uuidv7() : segment));
        routes.push({ method, template: `/api/v1/${segments.join("/")}`, path: `/api/v1/${filled.join("/")}`, permissions });
      }
    }
  }
  return routes;
}

describe("Dev login (enabled: APP_ENV=development, DEV_LOGIN_ENABLED=true)", () => {
  useEnv({ APP_ENV: "development", DEV_LOGIN_ENABLED: "true", OTP_PROVIDER: undefined });
  let app: INestApplication;
  let members: Awaited<ReturnType<typeof seedMembers>>;

  beforeAll(async () => {
    app = await createTestApp();
    members = await seedMembers(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists every active member with name, role, phone and organization, Owners first", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/auth/dev/users").expect(200);
    expect(response.body.map((u: { role: string }) => u.role)).toEqual(["OWNER", "FIELD_MANAGER", "WORKER"]);
    expect(response.body[0]).toEqual({
      membershipId: members.owner.membership.id,
      userId: members.owner.user.id,
      fullLegalName: "Dana Owner",
      preferredName: null,
      phoneNumber: OWNER_PHONE,
      role: "OWNER",
      organizationId: members.owner.org.id,
      organizationName: "Test Org",
    });
  });

  it("signs in without SMS and returns the same session payload as OTP verification", async () => {
    const http = app.getHttpServer();
    const response = await request(http)
      .post("/api/v1/auth/dev/login")
      .send({ membershipId: members.manager.membership.id, deviceId: "e2e-dev-device", platform: "WEB" })
      .expect(201);

    expect(Object.keys(response.body).sort()).toEqual(["accessToken", "expiresIn", "organizationId", "refreshToken", "role"]);
    expect(response.body.role).toBe("FIELD_MANAGER");
    expect(response.body.organizationId).toBe(members.owner.org.id);

    // The access token works like any other.
    await request(http).get("/api/v1/shifts").set("Authorization", `Bearer ${response.body.accessToken}`).expect(200);

    // The device was registered exactly like an OTP login.
    const prisma = app.get(PrismaService);
    const device = await prisma.userDevice.findFirst({ where: { userId: members.manager.user.id, clientDeviceId: "e2e-dev-device" } });
    expect(device?.platform).toBe("WEB");

    // A DEV_LOGIN audit event was recorded.
    const audit = await prisma.auditLog.findFirst({ where: { action: "DEV_LOGIN", entityId: members.manager.membership.id } });
    expect(audit?.actorUserId).toBe(members.manager.user.id);
    expect(audit?.organizationId).toBe(members.owner.org.id);

    // Refresh rotation and reuse detection behave exactly as for OTP sessions.
    const rotated = await request(http).post("/api/v1/auth/refresh").send({ refreshToken: response.body.refreshToken }).expect(201);
    expect(rotated.body.refreshToken).not.toBe(response.body.refreshToken);
    const reused = await request(http).post("/api/v1/auth/refresh").send({ refreshToken: response.body.refreshToken }).expect(401);
    expect(reused.body.code).toBe("REFRESH_TOKEN_REUSED");
  });

  it("accepts the fixed code 123456 for any seeded phone number through the normal OTP flow", async () => {
    const http = app.getHttpServer();
    await request(http).post("/api/v1/auth/otp/request").send({ phoneNumber: WORKER_PHONE }).expect(204);
    const response = await request(http)
      .post("/api/v1/auth/otp/verify")
      .send({ phoneNumber: WORKER_PHONE, code: "123456", deviceId: "e2e-otp-device", platform: "ANDROID" })
      .expect(201);
    expect(response.body.role).toBe("WORKER");
  });

  it("rejects unknown or inactive memberships and malformed ids", async () => {
    const http = app.getHttpServer();
    const unknown = await request(http).post("/api/v1/auth/dev/login").send({ membershipId: uuidv7() }).expect(404);
    expect(unknown.body.code).toBe("NOT_FOUND");

    const prisma = app.get(PrismaService);
    await prisma.organizationMembership.update({ where: { id: members.worker.membership.id }, data: { status: "SUSPENDED" } });
    await request(http).post("/api/v1/auth/dev/login").send({ membershipId: members.worker.membership.id }).expect(404);
    const listed = await request(http).get("/api/v1/auth/dev/users").expect(200);
    expect(listed.body.map((u: { membershipId: string }) => u.membershipId)).not.toContain(members.worker.membership.id);
    await prisma.organizationMembership.update({ where: { id: members.worker.membership.id }, data: { status: "ACTIVE" } });

    const malformed = await request(http).post("/api/v1/auth/dev/login").send({ membershipId: "not-a-uuid" }).expect(400);
    expect(malformed.body.code).toBe("VALIDATION_FAILED");
  });

  it("a Field Manager signed in through dev login still gets 403 on every financial route", async () => {
    const http = app.getHttpServer();
    const routes = discoverFinancialRoutes(app);
    expect(routes.map((r) => `${r.method} ${r.template}`).sort()).toEqual(EXPECTED_DECORATED_FINANCIAL_ROUTES);

    const manager = await request(http).post("/api/v1/auth/dev/login").send({ membershipId: members.manager.membership.id }).expect(201);
    const owner = await request(http).post("/api/v1/auth/dev/login").send({ membershipId: members.owner.membership.id }).expect(201);

    for (const route of routes) {
      const method = route.method.toLowerCase() as "get" | "post" | "patch" | "put" | "delete";
      const response = await request(http)[method](route.path).set("Authorization", `Bearer ${manager.body.accessToken}`).send({});
      expect({ route: `${route.method} ${route.path}`, status: response.status, code: response.body.code }).toEqual({
        route: `${route.method} ${route.path}`,
        status: 403,
        code: "FORBIDDEN",
      });
    }

    // Compensation history is guarded in the service layer, not by a decorator; use a real worker id
    // so the request reaches the role check instead of a 404.
    const compensationPath = `/api/v1/workers/${members.worker.workerProfile.id}/compensation-profiles`;
    const denied = await request(http).get(compensationPath).set("Authorization", `Bearer ${manager.body.accessToken}`).expect(403);
    expect(denied.body.code).toBe("FORBIDDEN");

    // Sanity check that the 403s come from the role, not from the dev-login session: the Owner gets in.
    await request(http).get("/api/v1/payroll-periods").set("Authorization", `Bearer ${owner.body.accessToken}`).expect(200);
    const allowed = await request(http).get(compensationPath).set("Authorization", `Bearer ${owner.body.accessToken}`).expect(200);
    expect(allowed.body.length).toBeGreaterThan(0);
  });
});

describe("Dev login also works with APP_ENV=staging", () => {
  useEnv({ APP_ENV: "staging", DEV_LOGIN_ENABLED: "true", OTP_PROVIDER: undefined });
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await seedMembers(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it("serves the dev users list", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/auth/dev/users").expect(200);
    expect(response.body).toHaveLength(3);
  });
});

describe("Dev login (disabled: DEV_LOGIN_ENABLED=false)", () => {
  useEnv({ APP_ENV: "development", DEV_LOGIN_ENABLED: "false", OTP_PROVIDER: undefined });
  let app: INestApplication;
  let members: Awaited<ReturnType<typeof seedMembers>>;

  beforeAll(async () => {
    app = await createTestApp();
    members = await seedMembers(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns 404 from both dev endpoints, like a route that does not exist", async () => {
    const http = app.getHttpServer();
    const list = await request(http).get("/api/v1/auth/dev/users").expect(404);
    expect(list.body.code).toBe("NOT_FOUND");
    expect(list.body.message).toBe("Cannot GET /api/v1/auth/dev/users");
    const login = await request(http).post("/api/v1/auth/dev/login").send({ membershipId: members.owner.membership.id }).expect(404);
    expect(login.body.code).toBe("NOT_FOUND");

    // Same shape as a genuinely unknown route.
    const unknown = await request(http).get("/api/v1/auth/does-not-exist").expect(404);
    expect(unknown.body.code).toBe(list.body.code);

    const prisma = app.get(PrismaService);
    expect(await prisma.auditLog.count({ where: { action: "DEV_LOGIN" } })).toBe(0);
  });

  it("rejects the fixed code 123456 (the console provider issues its own code)", async () => {
    const http = app.getHttpServer();
    await request(http).post("/api/v1/auth/otp/request").send({ phoneNumber: OWNER_PHONE }).expect(204);
    const response = await request(http)
      .post("/api/v1/auth/otp/verify")
      .send({ phoneNumber: OWNER_PHONE, code: "123456", deviceId: "e2e", platform: "WEB" })
      .expect(401);
    expect(response.body.code).toBe("OTP_INVALID_OR_EXPIRED");
  });

  it("does not honour a leftover fixed-code challenge issued while dev login was on", async () => {
    const http = app.getHttpServer();
    const prisma = app.get(PrismaService);
    const argon2 = await import("argon2");
    await prisma.otpChallenge.create({
      data: {
        id: uuidv7(),
        phoneNumber: MANAGER_PHONE,
        provider: "DEV_FIXED",
        codeHash: await argon2.hash("123456"),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    const response = await request(http)
      .post("/api/v1/auth/otp/verify")
      .send({ phoneNumber: MANAGER_PHONE, code: "123456", deviceId: "e2e", platform: "WEB" })
      .expect(401);
    expect(response.body.code).toBe("OTP_INVALID_OR_EXPIRED");
  });
});

describe("Turning dev login off ends every test-mode session", () => {
  let appOn: INestApplication;
  let appOff: INestApplication;
  let members: Awaited<ReturnType<typeof seedMembers>>;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ["APP_ENV", "DEV_LOGIN_ENABLED", "OTP_PROVIDER"]) saved[key] = process.env[key];
    delete process.env.OTP_PROVIDER;
    process.env.APP_ENV = "staging";
    process.env.DEV_LOGIN_ENABLED = "true";
    appOn = await createTestApp();
    members = await seedMembers(appOn);
    // Same database, restarted with dev login off (what an operator does when a test deployment goes live).
    process.env.APP_ENV = "production";
    process.env.DEV_LOGIN_ENABLED = "false";
    appOff = await createTestApp();
  });
  afterAll(async () => {
    await appOn.close();
    await appOff.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function expectEnded(session: { accessToken: string; refreshToken: string }) {
    const off = appOff.getHttpServer();
    const rejected = await request(off).get("/api/v1/shifts").set("Authorization", `Bearer ${session.accessToken}`).expect(401);
    expect(rejected.body.message).toContain("test-mode session ended");
    const refresh = await request(off).post("/api/v1/auth/refresh").send({ refreshToken: session.refreshToken }).expect(401);
    expect(refresh.body.code).toBe("REFRESH_TOKEN_REVOKED");
    const familyId = session.refreshToken.split(":")[0];
    const family = await appOff.get(PrismaService).refreshTokenFamily.findUnique({ where: { id: familyId } });
    expect(family?.revokedReason).toBe("DEV_LOGIN_DISABLED");
  }

  it("rejects the access and refresh tokens of a quick-login (DEV_LOGIN) session", async () => {
    const on = appOn.getHttpServer();
    const session = await request(on).post("/api/v1/auth/dev/login").send({ membershipId: members.owner.membership.id }).expect(201);
    // Works while dev login is on...
    await request(on).get("/api/v1/shifts").set("Authorization", `Bearer ${session.body.accessToken}`).expect(200);
    // ...and is cut off as soon as it is off, before the access token's own expiry.
    await expectEnded(session.body);
  });

  it("rejects a session that was verified with the fixed code 123456 (DEV_FIXED_OTP)", async () => {
    const on = appOn.getHttpServer();
    await request(on).post("/api/v1/auth/otp/request").send({ phoneNumber: MANAGER_PHONE }).expect(204);
    const session = await request(on)
      .post("/api/v1/auth/otp/verify")
      .send({ phoneNumber: MANAGER_PHONE, code: "123456", deviceId: "e2e-fixed", platform: "WEB" })
      .expect(201);
    await expectEnded(session.body);
  });

  it("keeps real OTP sessions working", async () => {
    const off = appOff.getHttpServer();
    await request(off).post("/api/v1/auth/otp/request").send({ phoneNumber: WORKER_PHONE }).expect(204);
    const session = await request(off)
      .post("/api/v1/auth/otp/verify")
      .send({ phoneNumber: WORKER_PHONE, code: "000000", deviceId: "e2e-real", platform: "ANDROID" })
      .expect(201);
    await request(off).get("/api/v1/shifts").set("Authorization", `Bearer ${session.body.accessToken}`).expect(200);
    await request(off).post("/api/v1/auth/refresh").send({ refreshToken: session.body.refreshToken }).expect(201);
  });
});

describe("Boot refusal: APP_ENV=production + DEV_LOGIN_ENABLED=true", () => {
  useEnv({ APP_ENV: "production", DEV_LOGIN_ENABLED: "true", OTP_PROVIDER: undefined });

  it("the configuration module (imported by AppModule) refuses to initialise", async () => {
    // Compiling only AppConfigModule keeps this test from opening Redis/BullMQ
    // connections that a half-initialised AppModule would leak; the spawn
    // test below proves the full application refuses to start.
    await expect(Test.createTestingModule({ imports: [AppConfigModule] }).compile()).rejects.toThrow(
      /DEV_LOGIN_ENABLED=true is not allowed when APP_ENV=production/,
    );
  });

  it("the real entrypoint (src/main.ts) exits with a non-zero code and a clear error", () => {
    const apiDir = join(__dirname, "..");
    const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register", "src/main.ts"], {
      cwd: apiDir,
      env: { ...process.env, APP_ENV: "production", DEV_LOGIN_ENABLED: "true", PORT: "0" },
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FieldMaster API configuration error");
    expect(result.stderr).toContain("DEV_LOGIN_ENABLED=true is not allowed when APP_ENV=production");
  }, 130_000);
});
