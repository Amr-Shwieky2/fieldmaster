import type { INestApplication } from "@nestjs/common";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { AccountStatus } from "@fieldmaster/shared-types";
import { toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { createTestApp, request } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { seedDevelopmentData } from "../prisma/seed";

/**
 * «راتبي» for every member of the development seed (mobile manager mode).
 * On the phone the Owner saw «تعذّر تحميل الراتب — لم نتمكن من العثور على
 * العنصر المطلوب»: the salary endpoints answered a generic 404 to a member
 * without a worker profile, and the app offered «راتبي» to everyone. This
 * signs in as each seeded member and calls both endpoints: a member with a
 * worker profile gets 200 (an empty month is an empty statement, never an
 * error); anyone else gets the specific 404 NO_WORKER_PROFILE.
 */

interface Outcome {
  name: string;
  role: string;
  roleName: string | null;
  clocksIn: boolean;
  statements: [number, string | null];
  current: [number, string | null];
}

const BUCKET = () => process.env.S3_BUCKET ?? "fieldmaster-dev";

function storageClient() {
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
}

/** The seed stores the pending applicant's ID image in the shared development bucket; removed again here. */
async function removeSeededFiles(organizationIds: string[]) {
  try {
    for (const organizationId of organizationIds) {
      const listed = await storageClient().send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: `onboarding/${organizationId}/` }));
      const keys = (listed.Contents ?? []).map((object) => object.Key ?? "").filter(Boolean);
      if (keys.length > 0) await storageClient().send(new DeleteObjectsCommand({ Bucket: BUCKET(), Delete: { Objects: keys.map((Key) => ({ Key })) } }));
    }
  } catch {
    // Without object storage the seed stored no image.
  }
}

describe("Salary endpoints for every seeded member (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let quiet: jest.SpyInstance[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    quiet = [jest.spyOn(console, "log").mockImplementation(() => undefined), jest.spyOn(console, "warn").mockImplementation(() => undefined)];
    await seedDevelopmentData();
  }, 180_000);

  afterAll(async () => {
    await removeSeededFiles((await prisma.organization.findMany({ select: { id: true } })).map((org) => org.id));
    for (const spy of quiet) spy.mockRestore();
    await app.close();
  });

  const http = () => app.getHttpServer();

  async function signIn(phoneNumber: string) {
    await request(http()).post("/api/v1/auth/otp/request").send({ phoneNumber }).expect(204);
    return request(http()).post("/api/v1/auth/otp/verify").send({ phoneNumber, code: "000000", deviceId: `device-${phoneNumber}`, platform: "IOS" });
  }

  it("every active member: 200 with a worker profile (the current month too, even when empty), otherwise 404 NO_WORKER_PROFILE", async () => {
    const members = await prisma.organizationMembership.findMany({
      where: { archivedAt: null, status: AccountStatus.ACTIVE, user: { status: AccountStatus.ACTIVE } },
      include: { user: true, workerProfile: true, roleRecord: { select: { name: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    expect(members.length).toBeGreaterThan(15);
    const yearMonth = toBusinessYearMonth(new Date());

    const outcomes: Outcome[] = [];
    for (const member of members) {
      const session = await signIn(member.user.phoneNumber);
      expect({ phone: member.user.phoneNumber, status: session.status }).toEqual({ phone: member.user.phoneNumber, status: 201 });
      const auth = { Authorization: `Bearer ${session.body.accessToken}` };
      const statements = await request(http()).get("/api/v1/payroll-statements/me").set(auth);
      const current = await request(http()).get("/api/v1/payroll-statements/me/current").set(auth);
      outcomes.push({
        name: member.user.fullLegalName,
        role: member.role,
        roleName: member.roleRecord?.name ?? null,
        clocksIn: member.isTimeTrackable && member.workerProfile !== null,
        statements: [statements.status, statements.body.code ?? null],
        current: [current.status, current.body.code ?? null],
      });
      if (member.workerProfile) {
        expect(statements.body).toEqual({ statements: expect.any(Array), estimates: expect.any(Array) });
        expect(current.body).toMatchObject({ yearMonth, isEstimate: true });
      }
    }

    for (const outcome of outcomes) {
      const expected: [number, string | null] = outcome.clocksIn ? [200, null] : [404, "NO_WORKER_PROFILE"];
      expect(outcome).toEqual({ ...outcome, statements: expected, current: expected });
    }
    // Both kinds are in the seed: workers (and a Field Manager who clocks in) and members who never clock in (Owners, a Field Manager, custom roles).
    expect(outcomes.filter((outcome) => outcome.clocksIn).length).toBeGreaterThanOrEqual(12);
    expect(outcomes.filter((outcome) => !outcome.clocksIn).map((outcome) => outcome.role)).toEqual(expect.arrayContaining(["OWNER", "FIELD_MANAGER"]));
    expect(outcomes.filter((outcome) => !outcome.clocksIn && outcome.role === "CUSTOM").length).toBeGreaterThanOrEqual(2);
  });

  it("the pending applicant cannot sign in yet, so never reaches a salary screen", async () => {
    const pending = await prisma.organizationMembership.findMany({ where: { status: AccountStatus.PENDING_APPROVAL }, include: { user: true } });
    expect(pending.length).toBeGreaterThan(0);
    for (const member of pending) {
      const session = await signIn(member.user.phoneNumber);
      expect({ status: session.status, code: session.body.code }).toEqual({ status: 403, code: "ACCOUNT_PENDING_APPROVAL" });
    }
  });
});
