import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { ConsoleLogger, INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { Response, Test as PendingRequest } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { InvitationStatus, MAX_UPLOAD_BYTES, PRIVACY_NOTICE_VERSION, UPLOAD_CONTENT_TYPES, type GovernmentIdType } from "@fieldmaster/shared-types";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { FilesService } from "../src/common/files/files.service";
import { MALWARE_SCANNER, type MalwareScanResult, type MalwareScanner } from "../src/modules/files/malware-scanner";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { useEnv } from "./use-env";
import { addFieldManager, addWorker, createOrgWithOwner } from "./fixtures";
import { BASELINE_JPEG, CLEAN_PNG, GIF, PHOTO_METADATA_SECRET, SMALL_PDF, TEXT_FILE, jpegWithExif, pdfOfSize, pngWithText } from "./onboarding-files";

/**
 * Step 8: worker onboarding. A manager creates a single-use link; the worker
 * opens the public page, uploads an identity document and a photo (typed by
 * content, metadata stripped, malware-scan hook) and applies; the Owner
 * reviews the decrypted ID number and bank details (audited) and approves.
 * Along the way, nothing sensitive may reach a log, an audit row, a
 * notification or a non-Owner's response.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Every value that must never appear in a log line, an audit row or a notification. Filled as the tests create them. */
const SECRETS = new Set<string>([PHOTO_METADATA_SECRET]);
function secret(value: string): string {
  SECRETS.add(value);
  return value;
}

interface Applicant {
  phone: string;
  name: string;
  idType: GovernmentIdType;
  idNumber: string;
  bankName: string;
  branch: string;
  account: string;
}

function applicant(fields: Applicant): Applicant {
  secret(fields.idNumber);
  secret(fields.idNumber.toUpperCase());
  secret(fields.account);
  for (const separator of ["", "-", "/", " "]) secret(`${fields.branch}${separator}${fields.account}`);
  return fields;
}

/** Israeli ID with a valid check digit. */
const SAMIR = applicant({
  phone: "+972521234567",
  name: "Samir Haddad",
  idType: "ISRAELI_ID",
  idNumber: "314159260",
  bankName: "Bank Hapoalim",
  branch: "613",
  account: "4417290031",
});
/** Palestinian ID: 9 digits whose Israeli check digit is NOT valid (no check digit is applied to this type). */
const LINA = applicant({
  phone: "+972599876543",
  name: "Lina Nasser",
  idType: "PALESTINIAN_ID",
  idNumber: "402731958",
  bankName: "Bank of Palestine",
  branch: "155",
  account: "5528301142",
});
const YOUSEF = applicant({
  phone: "+972541112233",
  name: "Yousef Khalil",
  idType: "ISRAELI_ID",
  idNumber: "271828188",
  bankName: "Bank Leumi",
  branch: "802",
  account: "7730415526",
});
const RAMI = applicant({
  phone: "+972547778899",
  name: "Rami Saleh",
  idType: "PASSPORT",
  idNumber: "ab1234567",
  bankName: "Mizrahi Tefahot",
  branch: "420",
  account: "8841902277",
});

const COMPENSATION = {
  compensationType: "DAILY",
  dailyBaseRateAgorot: 45_000,
  overtimeHourlyRateAgorot: 6_500,
  effectiveStartDate: "2026-10-01",
  changeReason: "Onboarding approval",
};

function applicationBody(
  person: Applicant,
  assets: { identityDocumentAssetId: string; profilePhotoAssetId?: string },
  overrides: Record<string, unknown> = {},
) {
  return {
    phoneNumber: person.phone,
    fullLegalName: person.name,
    governmentIdType: person.idType,
    governmentIdNumber: person.idNumber,
    ...assets,
    bankName: person.bankName,
    branchNumber: person.branch,
    accountNumber: person.account,
    accountHolderName: person.name,
    consentAccepted: true,
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    ...overrides,
  };
}

/** Status and body of an error answer, without the per-request correlation id. */
function errorShape(response: Response) {
  const { correlationId, ...body } = response.body as Record<string, unknown>;
  expect(typeof correlationId).toBe("string");
  return { status: response.status, body };
}

const INVALID_LINK = {
  status: 404,
  body: { statusCode: 404, code: "INVITATION_INVALID_OR_EXPIRED", message: "This invitation link is invalid or has expired.", details: {} },
};

// ── Everything the API writes to its logs, captured for the whole file ──────

const logSpies: jest.SpyInstance[] = [];

beforeAll(() => {
  const targets = [Logger.prototype, ConsoleLogger.prototype, console, process.stdout, process.stderr] as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >[];
  for (const target of targets) {
    for (const method of ["log", "error", "warn", "debug", "verbose", "fatal", "info", "write"]) {
      if (typeof target[method] === "function") logSpies.push(jest.spyOn(target, method));
    }
  }
});

afterAll(() => {
  for (const spy of logSpies) spy.mockRestore();
});

function loggedText(): string {
  const render = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
    if (value instanceof Error) return `${value.message}\n${value.stack ?? ""}`;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  return logSpies.flatMap((spy) => spy.mock.calls.map((call: unknown[]) => call.map(render).join(" "))).join("\n");
}

// ── Object storage helpers ───────────────────────────────────────────────────

function storageClient() {
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
}

const BUCKET = () => process.env.S3_BUCKET ?? "fieldmaster-dev";

async function storedKeys(prefix: string): Promise<string[]> {
  const result = await storageClient().send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix }));
  return (result.Contents ?? []).map((object) => object.Key ?? "");
}

/** Removes what a test organization put in the shared development bucket. */
async function removeStoredFiles(organizationId: string) {
  const keys = await storedKeys(`onboarding/${organizationId}/`);
  if (keys.length > 0) await storageClient().send(new DeleteObjectsCommand({ Bucket: BUCKET(), Delete: { Objects: keys.map((Key) => ({ Key })) } }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Worker onboarding (Step 8)", () => {
  // Plenty of public requests in this suite; the limit itself is tested below with a fresh app.
  useEnv({ ONBOARDING_RATE_LIMIT: "1000" });

  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let files: FilesService;
  let organizationId: string;
  let ownerUserId: string;
  let managerUserId: string;
  const tokens = { owner: "", manager: "", worker: "" };

  const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

  async function createInvitation(accessToken = tokens.owner, prefilledPhoneNumber?: string) {
    const response = await request(http)
      .post("/api/v1/onboarding-invitations")
      .set(auth(accessToken))
      .send(prefilledPhoneNumber ? { prefilledPhoneNumber } : {})
      .expect(201);
    secret(response.body.token);
    return response.body as { invitationId: string; token: string; joinPath: string; expiresAt: string };
  }

  function upload(token: string, purpose: string, bytes: Buffer, fileName: string, contentType: string) {
    secret(fileName);
    return request(http)
      .post(`/api/v1/onboarding/invitations/${token}/uploads`)
      .field("purpose", purpose)
      .attach("file", bytes, { filename: fileName, contentType });
  }

  function redeem(token: string, body: Record<string, unknown>) {
    return request(http).post(`/api/v1/onboarding/invitations/${token}/redeem`).send(body);
  }

  /** A complete application with a JPEG identity document; the worker stays pending. */
  async function apply(person: Applicant) {
    const invitation = await createInvitation();
    const document = await upload(invitation.token, "IDENTITY_DOCUMENT", BASELINE_JPEG, `${person.name} id.jpg`, "image/jpeg").expect(201);
    await redeem(invitation.token, applicationBody(person, { identityDocumentAssetId: document.body.fileAssetId })).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: person.phone } });
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { userId: user.id, organizationId }, include: { workerProfile: true } });
    return { invitation, identityDocumentAssetId: document.body.fileAssetId as string, workerProfileId: membership.workerProfile!.id, membership, user };
  }

  /** A second application started on the same database with dev login on (what `pnpm dev` runs with). */
  async function withDevLoginApp(run: (devApp: INestApplication) => Promise<void>) {
    const saved = { APP_ENV: process.env.APP_ENV, DEV_LOGIN_ENABLED: process.env.DEV_LOGIN_ENABLED, OTP_PROVIDER: process.env.OTP_PROVIDER };
    process.env.APP_ENV = "development";
    process.env.DEV_LOGIN_ENABLED = "true";
    delete process.env.OTP_PROVIDER;
    let devApp: INestApplication | undefined;
    try {
      devApp = await createTestApp();
      await run(devApp);
    } finally {
      await devApp?.close();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    files = app.get(FilesService);
    await resetDatabase(app);
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    organizationId = owner.org.id;
    ownerUserId = owner.user.id;
    managerUserId = (await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager")).user.id;
    await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker");
    tokens.owner = (await loginAs(app, OWNER_PHONE)).accessToken;
    tokens.manager = (await loginAs(app, MANAGER_PHONE)).accessToken;
    tokens.worker = (await loginAs(app, WORKER_PHONE)).accessToken;
  });

  afterAll(async () => {
    await removeStoredFiles(organizationId);
    await app.close();
  });

  it("full flow: invitation, public page, uploads without metadata, application, Owner review, approval, OTP sign-in and dev quick-login", async () => {
    // The manager's link: only the token's SHA-256 is stored.
    const created = await request(http).post("/api/v1/onboarding-invitations").set(auth(tokens.owner)).send({ prefilledPhoneNumber: SAMIR.phone }).expect(201);
    expect(Object.keys(created.body).sort()).toEqual(["expiresAt", "invitationId", "joinPath", "token"]);
    const { token, invitationId } = created.body as { token: string; invitationId: string };
    secret(token);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.body.joinPath).toBe(`/join/${token}`);
    const storedInvitation = await prisma.onboardingInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(storedInvitation.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(storedInvitation)).not.toContain(token);

    // The public page.
    const page = await request(http).get(`/api/v1/onboarding/invitations/${token}`).expect(200);
    expect(page.body).toEqual({
      organizationName: "Test Org",
      prefilledPhoneNumber: SAMIR.phone,
      expiresAt: created.body.expiresAt,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      allowedContentTypes: UPLOAD_CONTENT_TYPES,
    });

    // The identity document: a phone photo with Exif (GPS) -- stored without it, the image itself unchanged.
    const idPhoto = jpegWithExif();
    expect(idPhoto.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(true);
    const idUpload = await upload(token, "IDENTITY_DOCUMENT", idPhoto, "teudat-zehut-front.jpg", "image/jpeg").expect(201);
    const identityDocumentAssetId: string = idUpload.body.fileAssetId;
    expect(idUpload.body).toEqual({
      fileAssetId: identityDocumentAssetId,
      purpose: "IDENTITY_DOCUMENT",
      contentType: "image/jpeg",
      sizeBytes: BASELINE_JPEG.length,
    });
    const idAsset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: identityDocumentAssetId } });
    expect(idAsset).toMatchObject({
      organizationId,
      purpose: "IDENTITY_DOCUMENT",
      contentType: "image/jpeg",
      sizeBytes: BASELINE_JPEG.length,
      storageKey: `onboarding/${organizationId}/${invitationId}/${identityDocumentAssetId}`,
      scanResult: "NOT_SCANNED",
      invitationId,
      workerProfileId: null,
    });
    const storedIdPhoto = (await files.getObject(idAsset.storageKey))!;
    expect(storedIdPhoto.includes(Buffer.from("Exif", "latin1"))).toBe(false);
    expect(storedIdPhoto.includes(Buffer.from(PHOTO_METADATA_SECRET, "latin1"))).toBe(false);
    // Still a valid JPEG: exactly the image without its metadata segment.
    expect(storedIdPhoto.equals(BASELINE_JPEG)).toBe(true);
    expect(idAsset.sha256).toBe(sha256(storedIdPhoto));

    // The profile photo: a PNG with a text chunk, stored without it.
    const photoUpload = await upload(token, "PROFILE_PHOTO", pngWithText(), "selfie.png", "image/png").expect(201);
    const profilePhotoAssetId: string = photoUpload.body.fileAssetId;
    expect(photoUpload.body).toEqual({ fileAssetId: profilePhotoAssetId, purpose: "PROFILE_PHOTO", contentType: "image/png", sizeBytes: CLEAN_PNG.length });
    const photoAsset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: profilePhotoAssetId } });
    const storedPhoto = (await files.getObject(photoAsset.storageKey))!;
    expect(storedPhoto.equals(CLEAN_PNG)).toBe(true);
    expect(storedPhoto.includes(Buffer.from("tEXt", "latin1"))).toBe(false);

    // The application: the answer says only that it was submitted.
    const submitted = await redeem(token, applicationBody(SAMIR, { identityDocumentAssetId, profilePhotoAssetId })).expect(201);
    expect(submitted.body).toEqual({ submitted: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: SAMIR.phone } });
    expect(user).toMatchObject({ fullLegalName: SAMIR.name, preferredName: null, preferredLanguage: "ar", status: "PENDING_APPROVAL" });
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { userId: user.id, organizationId } });
    expect(membership).toMatchObject({ role: "WORKER", isTimeTrackable: true, status: "PENDING_APPROVAL" });
    const worker = await prisma.workerProfile.findUniqueOrThrow({
      where: { membershipId: membership.id },
      include: { identityDocuments: true, bankAccount: true },
    });
    expect(worker).toMatchObject({ organizationId, governmentIdType: "ISRAELI_ID", privacyNoticeVersion: PRIVACY_NOTICE_VERSION, profilePhotoAssetId });
    expect(worker.consentAcceptedAt).toBeInstanceOf(Date);
    expect(worker.identityDocuments).toEqual([expect.objectContaining({ documentType: "ISRAELI_ID", fileAssetId: identityDocumentAssetId })]);
    // Encrypted at rest: no plaintext number in the stored rows.
    expect(worker.identityDocuments[0].ciphertext.includes(Buffer.from(SAMIR.idNumber))).toBe(false);
    expect(worker.bankAccount!.ciphertext.includes(Buffer.from(SAMIR.account))).toBe(false);
    expect(await prisma.fileAsset.findMany({ where: { workerProfileId: worker.id }, orderBy: { purpose: "asc" } })).toEqual([
      expect.objectContaining({ id: identityDocumentAssetId }),
      expect.objectContaining({ id: profilePhotoAssetId }),
    ]);
    expect(await prisma.onboardingInvitation.findUniqueOrThrow({ where: { id: invitationId } })).toMatchObject({
      usedAt: expect.any(Date),
      redeemedWorkerProfileId: worker.id,
    });
    expect(await prisma.auditLog.count({ where: { action: "ONBOARDING_SUBMITTED", entityId: worker.id, actorUserId: user.id } })).toBe(1);

    // The Owner is notified (names only) and sees the worker waiting.
    const notifications = await request(http).get("/api/v1/notifications").set(auth(tokens.owner)).expect(200);
    expect(notifications.body).toContainEqual(
      expect.objectContaining({ type: "ONBOARDING_SUBMITTED", dataJson: { workerProfileId: worker.id, workerName: SAMIR.name } }),
    );
    const pending = await request(http).get("/api/v1/workers/pending-approval").set(auth(tokens.owner)).expect(200);
    expect(pending.body).toContainEqual({
      membershipId: membership.id,
      workerProfileId: worker.id,
      fullLegalName: SAMIR.name,
      phoneNumber: SAMIR.phone,
      submittedAt: membership.createdAt.toISOString(),
    });

    // The Owner's review: ID number and bank details decrypted, the view audited, not cached.
    const review = await request(http).get(`/api/v1/workers/${worker.id}/onboarding-review`).set(auth(tokens.owner)).expect(200);
    expect(review.headers["cache-control"]).toBe("no-store");
    expect(review.body).toEqual({
      workerProfileId: worker.id,
      membershipStatus: "PENDING_APPROVAL",
      fullLegalName: SAMIR.name,
      preferredName: null,
      phoneNumber: SAMIR.phone,
      submittedAt: membership.createdAt.toISOString(),
      governmentIdType: "ISRAELI_ID",
      governmentIdNumber: SAMIR.idNumber,
      bankAccount: { bankName: SAMIR.bankName, branchNumber: SAMIR.branch, accountNumber: SAMIR.account, accountHolderName: SAMIR.name },
      consentAcceptedAt: worker.consentAcceptedAt!.toISOString(),
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      identityDocument: { fileAssetId: identityDocumentAssetId, contentType: "image/jpeg", sizeBytes: BASELINE_JPEG.length },
      profilePhoto: { fileAssetId: profilePhotoAssetId, contentType: "image/png", sizeBytes: CLEAN_PNG.length },
    });

    // The identity document through a 60-second signed URL, served inline with its detected type.
    const view = await request(http).get(`/api/v1/file-assets/${identityDocumentAssetId}/view-url`).set(auth(tokens.owner)).expect(200);
    expect(view.headers["cache-control"]).toBe("no-store");
    expect(view.body).toEqual({ url: expect.any(String), expiresInSeconds: 60, contentType: "image/jpeg" });
    expect(new URL(view.body.url).searchParams.get("X-Amz-Expires")).toBe("60");
    const served = await fetch(view.body.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("content-disposition")).toBe("inline");
    expect(Buffer.from(await served.arrayBuffer()).equals(BASELINE_JPEG)).toBe(true);

    // Approval with the first compensation profile; the worker can then sign in with an OTP.
    await request(http).post(`/api/v1/workers/${worker.id}/approve`).set(auth(tokens.owner)).send({ compensationProfile: COMPENSATION }).expect(201);
    expect(await prisma.organizationMembership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ status: "ACTIVE" });
    const session = await loginAs(app, SAMIR.phone);
    expect(session).toMatchObject({ role: "WORKER", organizationId });
    await request(http).get("/api/v1/time-entries").set(auth(session.accessToken)).expect(200);

    // ...and appears in the dev quick-login list.
    await withDevLoginApp(async (devApp) => {
      const users = await request(devApp.getHttpServer()).get("/api/v1/auth/dev/users").expect(200);
      expect(users.body).toContainEqual(
        expect.objectContaining({ membershipId: membership.id, fullLegalName: SAMIR.name, phoneNumber: SAMIR.phone, role: "WORKER", organizationId }),
      );
    });

    // The invitation is listed as used, with the worker it created.
    const invitations = await request(http).get("/api/v1/onboarding-invitations").set(auth(tokens.owner)).expect(200);
    expect(invitations.body).toContainEqual(
      expect.objectContaining({
        id: invitationId,
        status: "USED",
        workerProfileId: worker.id,
        workerName: SAMIR.name,
        prefilledPhoneNumber: SAMIR.phone,
        createdByName: "Dana Owner",
      }),
    );
  });

  it("a Palestinian ID (9 digits, no check digit) with a PDF identity document goes through the whole flow", async () => {
    // The number fails the Israeli check digit: that rule is not applied to this type.
    const invitation = await createInvitation(tokens.manager);
    const document = await upload(invitation.token, "IDENTITY_DOCUMENT", SMALL_PDF, "hawiya.pdf", "application/pdf").expect(201);
    expect(document.body).toMatchObject({ purpose: "IDENTITY_DOCUMENT", contentType: "application/pdf", sizeBytes: SMALL_PDF.length });
    // A PDF is stored as received.
    const asset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: document.body.fileAssetId } });
    expect((await files.getObject(asset.storageKey))!.equals(SMALL_PDF)).toBe(true);

    await redeem(invitation.token, applicationBody(LINA, { identityDocumentAssetId: document.body.fileAssetId })).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: LINA.phone }, include: { memberships: { include: { workerProfile: true } } } });
    const workerProfileId = user.memberships[0].workerProfile!.id;

    const review = await request(http).get(`/api/v1/workers/${workerProfileId}/onboarding-review`).set(auth(tokens.owner)).expect(200);
    expect(review.body).toMatchObject({
      governmentIdType: "PALESTINIAN_ID",
      governmentIdNumber: LINA.idNumber,
      bankAccount: { bankName: LINA.bankName, branchNumber: LINA.branch, accountNumber: LINA.account, accountHolderName: LINA.name },
      identityDocument: { fileAssetId: document.body.fileAssetId, contentType: "application/pdf", sizeBytes: SMALL_PDF.length },
      profilePhoto: null,
    });
    const view = await request(http).get(`/api/v1/file-assets/${document.body.fileAssetId}/view-url`).set(auth(tokens.owner)).expect(200);
    expect(view.body.contentType).toBe("application/pdf");
    expect((await fetch(view.body.url)).headers.get("content-type")).toBe("application/pdf");

    await request(http).post(`/api/v1/workers/${workerProfileId}/approve`).set(auth(tokens.owner)).send({ compensationProfile: COMPENSATION }).expect(201);
    expect(await loginAs(app, LINA.phone)).toMatchObject({ role: "WORKER", organizationId });
  });

  it("files are typed by content and size-limited; rejected files are not stored", async () => {
    const invitation = await createInvitation();
    const expectRejected = async (response: Response, status: number, code: string) => {
      expect({ status: response.status, code: response.body.code }).toEqual({ status, code });
    };

    // Profile photos are images only; the identity document may be a PDF.
    const pdfPhoto = await upload(invitation.token, "PROFILE_PHOTO", SMALL_PDF, "photo.pdf", "application/pdf");
    await expectRejected(pdfPhoto, 415, "FILE_TYPE_NOT_ALLOWED");
    expect(pdfPhoto.body.details).toEqual({ allowedContentTypes: ["image/jpeg", "image/png"] });
    await expectRejected(await upload(invitation.token, "IDENTITY_DOCUMENT", GIF, "id.gif", "image/gif"), 415, "FILE_TYPE_NOT_ALLOWED");
    // A text file renamed .jpg and sent as image/jpeg: the name and the claimed type do not matter.
    await expectRejected(await upload(invitation.token, "IDENTITY_DOCUMENT", TEXT_FILE, "id.jpg", "image/jpeg"), 415, "FILE_TYPE_NOT_ALLOWED");
    // Starts like a JPEG but is not one.
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("garbage that only starts like a JPEG")]);
    await expectRejected(await upload(invitation.token, "IDENTITY_DOCUMENT", fakeJpeg, "id.jpg", "image/jpeg"), 415, "FILE_TYPE_NOT_ALLOWED");

    // Over 10 MB: refused by multer's limit (11 MB) or by the exact check (one byte over).
    const elevenMegabytes = Buffer.concat([BASELINE_JPEG, Buffer.alloc(11 * 1024 * 1024 - BASELINE_JPEG.length)]);
    const tooLarge = await upload(invitation.token, "IDENTITY_DOCUMENT", elevenMegabytes, "huge.jpg", "image/jpeg");
    await expectRejected(tooLarge, 413, "FILE_TOO_LARGE");
    expect(tooLarge.body.details).toEqual({ maxBytes: MAX_UPLOAD_BYTES });
    await expectRejected(
      await upload(invitation.token, "IDENTITY_DOCUMENT", pdfOfSize(MAX_UPLOAD_BYTES + 1), "big.pdf", "application/pdf"),
      413,
      "FILE_TOO_LARGE",
    );

    // Missing parts of the form.
    await expectRejected(
      await request(http).post(`/api/v1/onboarding/invitations/${invitation.token}/uploads`).field("purpose", "IDENTITY_DOCUMENT"),
      400,
      "VALIDATION_FAILED",
    );
    await expectRejected(
      await request(http)
        .post(`/api/v1/onboarding/invitations/${invitation.token}/uploads`)
        .attach("file", BASELINE_JPEG, { filename: "id.jpg", contentType: "image/jpeg" }),
      400,
      "VALIDATION_FAILED",
    );
    await expectRejected(await upload(invitation.token, "PAYSLIP", BASELINE_JPEG, "id.jpg", "image/jpeg"), 400, "VALIDATION_FAILED");
    expect(await prisma.fileAsset.count({ where: { invitationId: invitation.invitationId } })).toBe(0);
    expect(await storedKeys(`onboarding/${organizationId}/${invitation.invitationId}/`)).toEqual([]);

    // Accepted: exactly 10 MB; and a PNG sent with a wrong name and type is stored as what it is.
    const maxSize = await upload(invitation.token, "IDENTITY_DOCUMENT", pdfOfSize(MAX_UPLOAD_BYTES), "max.pdf", "application/pdf").expect(201);
    expect(maxSize.body).toMatchObject({ contentType: "application/pdf", sizeBytes: MAX_UPLOAD_BYTES });
    const mislabeled = await upload(invitation.token, "PROFILE_PHOTO", CLEAN_PNG, "photo.pdf", "application/pdf").expect(201);
    expect(mislabeled.body).toMatchObject({ purpose: "PROFILE_PHOTO", contentType: "image/png" });
    expect((await storedKeys(`onboarding/${organizationId}/${invitation.invitationId}/`)).sort()).toEqual(
      [maxSize.body.fileAssetId, mislabeled.body.fileAssetId].map((id: string) => `onboarding/${organizationId}/${invitation.invitationId}/${id}`).sort(),
    );
  });

  it("expired, used, revoked, unknown and malformed tokens get the same 404 on the page, uploads and the application", async () => {
    const expired = await createInvitation();
    await prisma.onboardingInvitation.update({ where: { id: expired.invitationId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    // What the expiry sweep leaves behind: revokedAt set, no revoker.
    const swept = await createInvitation();
    await prisma.onboardingInvitation.update({
      where: { id: swept.invitationId },
      data: { expiresAt: new Date(Date.now() - 120_000), revokedAt: new Date(Date.now() - 60_000) },
    });
    const revoked = await createInvitation();
    await request(http).delete(`/api/v1/onboarding-invitations/${revoked.invitationId}`).set(auth(tokens.owner)).expect(200);
    const { invitation: used, identityDocumentAssetId } = await apply(YOUSEF);
    const unknown = randomBytes(32).toString("hex");
    const malformed = ["not-a-token", unknown.slice(1), `${unknown}0`, "z".repeat(64), "0"];

    const usersBefore = await prisma.user.count();
    const answers: { token: string; route: string; answer: ReturnType<typeof errorShape> }[] = [];
    for (const token of [expired.token, swept.token, revoked.token, used.token, unknown, ...malformed]) {
      const page = await request(http).get(`/api/v1/onboarding/invitations/${token}`);
      const uploaded = await upload(token, "IDENTITY_DOCUMENT", BASELINE_JPEG, "id.jpg", "image/jpeg");
      const applied = await redeem(token, applicationBody(SAMIR, { identityDocumentAssetId }));
      answers.push(
        { token, route: "page", answer: errorShape(page) },
        { token, route: "upload", answer: errorShape(uploaded) },
        { token, route: "redeem", answer: errorShape(applied) },
      );
    }
    for (const { token, route, answer } of answers) expect({ token, route, answer }).toEqual({ token, route, answer: INVALID_LINK });

    // Nothing was stored or created through them.
    for (const invitation of [expired, swept, revoked]) {
      expect(await prisma.fileAsset.count({ where: { invitationId: invitation.invitationId } })).toBe(0);
    }
    expect(await prisma.fileAsset.count({ where: { invitationId: used.invitationId } })).toBe(1);
    expect(await prisma.user.count()).toBe(usersBefore);
  });

  it("an application is refused (and nothing is created) for foreign or wrong uploads, a different phone, or an invalid ID number", async () => {
    const invitation = await createInvitation(tokens.owner, RAMI.phone);
    const own = await upload(invitation.token, "IDENTITY_DOCUMENT", BASELINE_JPEG, "rami-id.jpg", "image/jpeg").expect(201);
    const ownPhoto = await upload(invitation.token, "PROFILE_PHOTO", CLEAN_PNG, "rami.png", "image/png").expect(201);
    const other = await createInvitation();
    const foreign = await upload(other.token, "IDENTITY_DOCUMENT", BASELINE_JPEG, "other-id.jpg", "image/jpeg").expect(201);
    const valid = { identityDocumentAssetId: own.body.fileAssetId as string };

    const refusals: [string, Record<string, unknown>, number, string, Record<string, unknown>?][] = [
      [
        "another invitation's upload",
        applicationBody(RAMI, { identityDocumentAssetId: foreign.body.fileAssetId }),
        400,
        "UPLOAD_NOT_FOUND",
        { field: "identityDocumentAssetId" },
      ],
      [
        "a photo as the identity document",
        applicationBody(RAMI, { identityDocumentAssetId: ownPhoto.body.fileAssetId }),
        400,
        "UPLOAD_NOT_FOUND",
        { field: "identityDocumentAssetId" },
      ],
      [
        "the identity document as the photo",
        applicationBody(RAMI, { ...valid, profilePhotoAssetId: own.body.fileAssetId }),
        400,
        "UPLOAD_NOT_FOUND",
        { field: "profilePhotoAssetId" },
      ],
      ["an unknown upload", applicationBody(RAMI, { identityDocumentAssetId: uuidv7() }), 400, "UPLOAD_NOT_FOUND", { field: "identityDocumentAssetId" }],
      [
        "a phone other than the invitation's",
        applicationBody(RAMI, valid, { phoneNumber: "+972547770000" }),
        400,
        "VALIDATION_FAILED",
        { field: "phoneNumber" },
      ],
      [
        "an Israeli ID with a wrong check digit",
        applicationBody(RAMI, valid, { governmentIdType: "ISRAELI_ID", governmentIdNumber: "314159261" }),
        400,
        "VALIDATION_FAILED",
        { field: "governmentIdNumber" },
      ],
      [
        "an Israeli ID of all zeros",
        applicationBody(RAMI, valid, { governmentIdType: "ISRAELI_ID", governmentIdNumber: "000000000" }),
        400,
        "VALIDATION_FAILED",
        { field: "governmentIdNumber" },
      ],
      [
        "a Palestinian ID of 5 digits",
        applicationBody(RAMI, valid, { governmentIdType: "PALESTINIAN_ID", governmentIdNumber: "00018" }),
        400,
        "VALIDATION_FAILED",
        { field: "governmentIdNumber" },
      ],
      [
        "a Palestinian ID of all zeros",
        applicationBody(RAMI, valid, { governmentIdType: "PALESTINIAN_ID", governmentIdNumber: "000000000" }),
        400,
        "VALIDATION_FAILED",
        { field: "governmentIdNumber" },
      ],
      [
        "a passport number that is too short",
        applicationBody(RAMI, valid, { governmentIdNumber: "AB12" }),
        400,
        "VALIDATION_FAILED",
        { field: "governmentIdNumber" },
      ],
      ["an unknown document type", applicationBody(RAMI, valid, { governmentIdType: "DRIVING_LICENSE" }), 400, "VALIDATION_FAILED"],
      ["a phone not in E.164 form", applicationBody(RAMI, valid, { phoneNumber: "0547778899" }), 400, "VALIDATION_FAILED"],
      ["a blank name", applicationBody(RAMI, valid, { fullLegalName: "   " }), 400, "VALIDATION_FAILED"],
      ["a blank bank name", applicationBody(RAMI, valid, { bankName: "" }), 400, "VALIDATION_FAILED"],
      ["a blank account holder", applicationBody(RAMI, valid, { accountHolderName: " " }), 400, "VALIDATION_FAILED"],
      ["a 5-digit branch", applicationBody(RAMI, valid, { branchNumber: "12345" }), 400, "VALIDATION_FAILED"],
      ["a 1-digit account", applicationBody(RAMI, valid, { accountNumber: "7" }), 400, "VALIDATION_FAILED"],
      ["a numeric account number", applicationBody(RAMI, valid, { accountNumber: 8841902277 }), 400, "VALIDATION_FAILED"],
      ["no consent", applicationBody(RAMI, valid, { consentAccepted: false }), 400, "VALIDATION_FAILED"],
      ["consent as a string", applicationBody(RAMI, valid, { consentAccepted: "true" }), 400, "VALIDATION_FAILED"],
      ["an old privacy notice", applicationBody(RAMI, valid, { privacyNoticeVersion: "2025-01" }), 400, "VALIDATION_FAILED"],
      ["an unknown field", applicationBody(RAMI, valid, { salary: 1 }), 400, "VALIDATION_FAILED"],
    ];
    for (const [label, body, status, code, details] of refusals) {
      const response = await redeem(invitation.token, body);
      expect({ label, status: response.status, code: response.body.code }).toEqual({ label, status, code });
      if (details) expect({ label, details: response.body.details }).toEqual({ label, details });
      // The submitted values are never echoed back.
      expect(JSON.stringify(response.body)).not.toContain(String(body.governmentIdNumber));
    }

    // An upload already linked to an application cannot be used again.
    const linkedElsewhere = await upload(invitation.token, "IDENTITY_DOCUMENT", BASELINE_JPEG, "rami-id-2.jpg", "image/jpeg").expect(201);
    const someWorker = await prisma.workerProfile.findFirstOrThrow({ where: { organizationId } });
    await prisma.fileAsset.update({ where: { id: linkedElsewhere.body.fileAssetId }, data: { workerProfileId: someWorker.id } });
    const reused = await redeem(invitation.token, applicationBody(RAMI, { identityDocumentAssetId: linkedElsewhere.body.fileAssetId }));
    expect({ status: reused.status, code: reused.body.code }).toEqual({ status: 400, code: "UPLOAD_NOT_FOUND" });

    // Nothing was created; the link still works, and the application then goes through (a passport, stored in capitals).
    expect(await prisma.user.count({ where: { phoneNumber: RAMI.phone } })).toBe(0);
    await request(http).get(`/api/v1/onboarding/invitations/${invitation.token}`).expect(200);
    await redeem(invitation.token, applicationBody(RAMI, { ...valid, profilePhotoAssetId: ownPhoto.body.fileAssetId })).expect(201);
    const rami = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: RAMI.phone }, include: { memberships: { include: { workerProfile: true } } } });
    const review = await request(http).get(`/api/v1/workers/${rami.memberships[0].workerProfile!.id}/onboarding-review`).set(auth(tokens.owner)).expect(200);
    expect(review.body).toMatchObject({
      governmentIdType: "PASSPORT",
      governmentIdNumber: "AB1234567",
      profilePhoto: { fileAssetId: ownPhoto.body.fileAssetId },
    });
    // The invitation is used now.
    await redeem(invitation.token, applicationBody(RAMI, valid)).expect(404);
  });

  it("a phone number that already has a membership in the organization cannot apply again (409)", async () => {
    const invitation = await createInvitation();
    const document = await upload(invitation.token, "IDENTITY_DOCUMENT", BASELINE_JPEG, "eli-id.jpg", "image/jpeg").expect(201);
    const eli = applicant({ ...YOUSEF, phone: WORKER_PHONE, name: "Eli Worker" });
    const response = await redeem(invitation.token, applicationBody(eli, { identityDocumentAssetId: document.body.fileAssetId }));
    expect({ status: response.status, code: response.body.code }).toEqual({ status: 409, code: "CONFLICT" });
    expect(await prisma.onboardingInvitation.findUniqueOrThrow({ where: { id: invitation.invitationId } })).toMatchObject({ usedAt: null });
  });

  it("Field Managers and Workers never get an ID number, bank detail, storage key or signed URL", async () => {
    // Field Managers receive application notifications too, so their notifications are checked with one in them.
    await request(http)
      .patch("/api/v1/organizations/me/settings/notifications")
      .set(auth(tokens.owner))
      .send({ preferences: [{ type: "ONBOARDING_SUBMITTED", owners: true, fieldManagers: true }] })
      .expect(200);
    const pendingApplicant = applicant({
      phone: "+972541239876",
      name: "Omar Darwish",
      idType: "ISRAELI_ID",
      idNumber: "161803390",
      bankName: "Bank Leumi",
      branch: "905",
      account: "9081726354",
    });
    const { workerProfileId, identityDocumentAssetId } = await apply(pendingApplicant);
    const samir = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: SAMIR.phone }, include: { memberships: { include: { workerProfile: true } } } });
    const samirToken = (await loginAs(app, SAMIR.phone, "samir-second-device")).accessToken;

    // The sensitive routes themselves: Owner only.
    for (const accessToken of [tokens.manager, tokens.worker, samirToken]) {
      for (const path of [`/api/v1/workers/${workerProfileId}/onboarding-review`, `/api/v1/file-assets/${identityDocumentAssetId}/view-url`]) {
        const response = await request(http).get(path).set(auth(accessToken));
        expect({ path, status: response.status, code: response.body.code }).toEqual({ path, status: 403, code: "FORBIDDEN" });
      }
    }

    const leaksIn = (body: unknown) => {
      const json = JSON.stringify(body);
      return [
        ...[...SECRETS].filter((value) => json.includes(value)),
        ...(/onboarding\/[0-9a-f-]{36}\//.test(json) ? ["storage key"] : []),
        ...(json.includes("X-Amz-") ? ["signed URL"] : []),
      ];
    };

    const managerReads = [
      "/api/v1/workers",
      `/api/v1/workers/${workerProfileId}`,
      "/api/v1/workers/pending-approval",
      "/api/v1/onboarding-invitations",
      "/api/v1/onboarding-invitations/pending-workers",
      "/api/v1/notifications",
    ];
    for (const path of managerReads) {
      const response = await request(http).get(path).set(auth(tokens.manager)).expect(200);
      expect({ path, leaks: leaksIn(response.body) }).toEqual({ path, leaks: [] });
    }
    // The pending list and the notification really were about the applicant (so the scan had something to look at).
    const pending = await request(http).get("/api/v1/workers/pending-approval").set(auth(tokens.manager)).expect(200);
    expect(pending.body).toContainEqual(expect.objectContaining({ workerProfileId, fullLegalName: pendingApplicant.name }));
    const managerNotifications = await request(http).get("/api/v1/notifications").set(auth(tokens.manager)).expect(200);
    expect(managerNotifications.body).toContainEqual(
      expect.objectContaining({ type: "ONBOARDING_SUBMITTED", dataJson: { workerProfileId, workerName: pendingApplicant.name } }),
    );

    for (const accessToken of [tokens.worker, samirToken]) {
      for (const path of managerReads.slice(0, 5)) {
        const response = await request(http).get(path).set(auth(accessToken));
        expect({ path, status: response.status }).toEqual({ path, status: 403 });
      }
      const own = await request(http).get("/api/v1/notifications").set(auth(accessToken)).expect(200);
      expect(leaksIn(own.body)).toEqual([]);
    }
    expect((await request(http).get("/api/v1/notifications").set(auth(samirToken)).expect(200)).body).toContainEqual(
      expect.objectContaining({ type: "WORKER_APPROVED", dataJson: { workerProfileId: samir.memberships[0].workerProfile!.id } }),
    );
    // Even the Owner's worker views carry none of it: only the review does.
    for (const path of ["/api/v1/workers", `/api/v1/workers/${workerProfileId}`]) {
      const response = await request(http).get(path).set(auth(tokens.owner)).expect(200);
      expect({ path, leaks: leaksIn(response.body) }).toEqual({ path, leaks: [] });
    }
  });

  it("every review and every file view is audited, without the values", async () => {
    const { workerProfileId, identityDocumentAssetId } = await apply(
      applicant({ ...YOUSEF, phone: "+972541230000", name: "Nadia Awad", idNumber: "039337423", account: "1029384756" }),
    );
    const audited = (action: string, entityId: string) => prisma.auditLog.findMany({ where: { action, entityId }, orderBy: { createdAt: "asc" } });

    for (let i = 0; i < 2; i++) {
      await request(http).get(`/api/v1/workers/${workerProfileId}/onboarding-review`).set(auth(tokens.owner)).expect(200);
      await request(http).get(`/api/v1/file-assets/${identityDocumentAssetId}/view-url`).set(auth(tokens.owner)).expect(200);
    }
    const reviews = await audited("WORKER_SENSITIVE_DATA_VIEWED", workerProfileId);
    const views = await audited("FILE_ASSET_VIEWED", identityDocumentAssetId);
    expect(reviews).toHaveLength(2);
    expect(views).toHaveLength(2);
    for (const row of [...reviews, ...views]) {
      expect(row).toMatchObject({ organizationId, actorUserId: ownerUserId, field: null, oldValue: null, newValue: null, reason: null, note: null });
    }
    expect(reviews[0]).toMatchObject({ entityType: "WorkerProfile" });
    expect(views[0]).toMatchObject({ entityType: "FileAsset" });

    // Refused or unknown: no audit row, and another organization's or a malformed id is a 404.
    await request(http).get(`/api/v1/workers/${workerProfileId}/onboarding-review`).set(auth(tokens.manager)).expect(403);
    expect(await audited("WORKER_SENSITIVE_DATA_VIEWED", workerProfileId)).toHaveLength(2);
    for (const id of [uuidv7(), "not-an-id"]) {
      expect((await request(http).get(`/api/v1/workers/${id}/onboarding-review`).set(auth(tokens.owner))).status).toBe(404);
      expect((await request(http).get(`/api/v1/file-assets/${id}/view-url`).set(auth(tokens.owner))).status).toBe(404);
    }
    const otherOrg = await createOrgWithOwner(prisma, "+972500000099", "Other Owner");
    const otherOwnerToken = (await loginAs(app, "+972500000099")).accessToken;
    expect((await request(http).get(`/api/v1/workers/${workerProfileId}/onboarding-review`).set(auth(otherOwnerToken))).status).toBe(404);
    expect((await request(http).get(`/api/v1/file-assets/${identityDocumentAssetId}/view-url`).set(auth(otherOwnerToken))).status).toBe(404);
    expect(
      await prisma.auditLog.count({ where: { organizationId: otherOrg.org.id, action: { in: ["WORKER_SENSITIVE_DATA_VIEWED", "FILE_ASSET_VIEWED"] } } }),
    ).toBe(0);
  });

  it("the invitation list shows ACTIVE, USED, EXPIRED and REVOKED without tokens; revoking is audited, a used one is 409", async () => {
    const active = await createInvitation(tokens.manager, "+972501112222");
    const expired = await createInvitation();
    await prisma.onboardingInvitation.update({ where: { id: expired.invitationId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const swept = await createInvitation();
    await prisma.onboardingInvitation.update({
      where: { id: swept.invitationId },
      data: { expiresAt: new Date(Date.now() - 120_000), revokedAt: new Date(Date.now() - 60_000) },
    });
    const revoked = await createInvitation();
    await request(http).delete(`/api/v1/onboarding-invitations/${revoked.invitationId}`).set(auth(tokens.manager)).expect(200).expect({ success: true });
    // Revoking again changes nothing (and is not audited twice).
    await request(http).delete(`/api/v1/onboarding-invitations/${revoked.invitationId}`).set(auth(tokens.owner)).expect(200);
    const { invitation: used, workerProfileId } = await apply(
      applicant({ ...YOUSEF, phone: "+972541230011", name: "Hani Mansour", idNumber: "503842197", account: "6655443322" }),
    );

    const response = await request(http).get("/api/v1/onboarding-invitations").set(auth(tokens.manager)).expect(200);
    const byId = new Map((response.body as { id: string }[]).map((row) => [row.id, row]));
    expect(byId.get(active.invitationId)).toEqual({
      id: active.invitationId,
      status: InvitationStatus.ACTIVE,
      prefilledPhoneNumber: "+972501112222",
      createdAt: expect.any(String),
      createdByName: "Yossi Manager",
      expiresAt: active.expiresAt,
      usedAt: null,
      workerProfileId: null,
      workerName: null,
      revokedAt: null,
      revokedByName: null,
    });
    expect(byId.get(expired.invitationId)).toMatchObject({ status: InvitationStatus.EXPIRED, revokedAt: null, revokedByName: null });
    expect(byId.get(swept.invitationId)).toMatchObject({ status: InvitationStatus.EXPIRED, revokedAt: null, revokedByName: null });
    expect(byId.get(revoked.invitationId)).toMatchObject({ status: InvitationStatus.REVOKED, revokedAt: expect.any(String), revokedByName: "Yossi Manager" });
    expect(byId.get(used.invitationId)).toMatchObject({
      status: InvitationStatus.USED,
      usedAt: expect.any(String),
      workerProfileId,
      workerName: "Hani Mansour",
    });
    // Newest first, and never a token or its hash.
    const createdAts = (response.body as { createdAt: string }[]).map((row) => row.createdAt);
    expect([...createdAts].sort().reverse()).toEqual(createdAts);
    const json = JSON.stringify(response.body);
    for (const invitation of [active, expired, swept, revoked, used]) {
      expect(json).not.toContain(invitation.token);
      expect(json).not.toContain(sha256(invitation.token));
    }
    expect(json).not.toMatch(/token/i);

    expect(await prisma.onboardingInvitation.findUniqueOrThrow({ where: { id: revoked.invitationId } })).toMatchObject({ revokedBy: managerUserId });
    expect(await prisma.auditLog.count({ where: { action: "ONBOARDING_INVITATION_REVOKED", entityId: revoked.invitationId } })).toBe(1);

    const usedRevoke = await request(http).delete(`/api/v1/onboarding-invitations/${used.invitationId}`).set(auth(tokens.owner));
    expect({ status: usedRevoke.status, code: usedRevoke.body.code }).toEqual({ status: 409, code: "INVITATION_ALREADY_USED" });
    for (const id of [uuidv7(), "not-an-id"]) {
      const missing = await request(http).delete(`/api/v1/onboarding-invitations/${id}`).set(auth(tokens.owner));
      expect({ status: missing.status, code: missing.body.code }).toEqual({ status: 404, code: "NOT_FOUND" });
    }
    const otherOwnerToken = (await loginAs(app, "+972500000099")).accessToken;
    expect((await request(http).delete(`/api/v1/onboarding-invitations/${active.invitationId}`).set(auth(otherOwnerToken))).status).toBe(404);
    expect((await request(http).get("/api/v1/onboarding-invitations").set(auth(otherOwnerToken)).expect(200)).body).toEqual([]);
    await request(http).get(`/api/v1/onboarding/invitations/${active.token}`).expect(200);

    // Workers cannot list, create or revoke invitations.
    await request(http).get("/api/v1/onboarding-invitations").set(auth(tokens.worker)).expect(403);
    await request(http).post("/api/v1/onboarding-invitations").set(auth(tokens.worker)).send({}).expect(403);
    await request(http).delete(`/api/v1/onboarding-invitations/${active.invitationId}`).set(auth(tokens.worker)).expect(403);
    // A prefilled phone number must be in E.164 form.
    await request(http).post("/api/v1/onboarding-invitations").set(auth(tokens.owner)).send({ prefilledPhoneNumber: "050-1234567" }).expect(400);
  });

  it("rejecting needs a reason that is not blank; approving needs the compensation profile", async () => {
    const { workerProfileId, membership } = await apply(
      applicant({ ...YOUSEF, phone: "+972541230022", name: "Tariq Odeh", idNumber: "011111119", account: "2233445566" }),
    );
    for (const body of [{}, { reason: "" }, { reason: "   " }]) {
      const response = await request(http).post(`/api/v1/workers/${workerProfileId}/reject`).set(auth(tokens.owner)).send(body);
      expect({ body, status: response.status, code: response.body.code }).toEqual({ body, status: 400, code: "VALIDATION_FAILED" });
    }
    const noCompensation = await request(http).post(`/api/v1/workers/${workerProfileId}/approve`).set(auth(tokens.owner)).send({});
    expect({ status: noCompensation.status, code: noCompensation.body.code }).toEqual({ status: 400, code: "VALIDATION_FAILED" });
    expect((await request(http).post("/api/v1/workers/not-an-id/reject").set(auth(tokens.owner)).send({ reason: "Duplicate" })).status).toBe(404);

    await request(http).post(`/api/v1/workers/${workerProfileId}/reject`).set(auth(tokens.owner)).send({ reason: "The ID photo is unreadable." }).expect(201);
    expect(await prisma.organizationMembership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ status: "REJECTED" });
  });
});

describe("Malware-scan hook", () => {
  useEnv({ ONBOARDING_RATE_LIMIT: "1000" });
  const scanner = { verdict: "INFECTED" as MalwareScanResult };
  const testScanner: MalwareScanner = { scan: async () => scanner.verdict };
  let app: INestApplication;
  let prisma: PrismaService;
  let organizationId: string;
  let ownerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MALWARE_SCANNER)
      .useValue(testScanner)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const owner = await createOrgWithOwner(prisma, "+972500000002", "Scan Owner");
    organizationId = owner.org.id;
    ownerToken = (await loginAs(app, "+972500000002")).accessToken;
  });

  afterAll(async () => {
    await removeStoredFiles(organizationId);
    await app.close();
  });

  it("an INFECTED verdict is 422 FILE_REJECTED and nothing is stored; CLEAN is recorded", async () => {
    const http = app.getHttpServer();
    const invitation = await request(http).post("/api/v1/onboarding-invitations").set("Authorization", `Bearer ${ownerToken}`).send({}).expect(201);
    secret(invitation.body.token);
    const send = () =>
      request(http)
        .post(`/api/v1/onboarding/invitations/${invitation.body.token}/uploads`)
        .field("purpose", "IDENTITY_DOCUMENT")
        .attach("file", jpegWithExif(), { filename: "scan-me.jpg", contentType: "image/jpeg" });
    secret("scan-me.jpg");

    const rejected = await send();
    expect({ status: rejected.status, code: rejected.body.code }).toEqual({ status: 422, code: "FILE_REJECTED" });
    expect(await prisma.fileAsset.count({ where: { invitationId: invitation.body.invitationId } })).toBe(0);
    expect(await storedKeys(`onboarding/${organizationId}/`)).toEqual([]);

    scanner.verdict = "CLEAN";
    const accepted = await send().expect(201);
    expect(await prisma.fileAsset.findUniqueOrThrow({ where: { id: accepted.body.fileAssetId } })).toMatchObject({ scanResult: "CLEAN" });
    expect(await storedKeys(`onboarding/${organizationId}/`)).toHaveLength(1);
  });
});

describe("Rate limiting of the public onboarding routes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Created with the default limit (10): the lower one below is read on each request.
    delete process.env.ONBOARDING_RATE_LIMIT;
    app = await createTestApp();
  });

  afterAll(async () => {
    delete process.env.ONBOARDING_RATE_LIMIT;
    await app.close();
  });

  it("the (N+1)-th request in a minute from one address is 429 RATE_LIMITED, per route", async () => {
    process.env.ONBOARDING_RATE_LIMIT = "3";
    const http = app.getHttpServer();
    const token = randomBytes(32).toString("hex");
    const routes: Record<string, () => PendingRequest> = {
      page: () => request(http).get(`/api/v1/onboarding/invitations/${token}`),
      upload: () =>
        request(http)
          .post(`/api/v1/onboarding/invitations/${token}/uploads`)
          .field("purpose", "IDENTITY_DOCUMENT")
          .attach("file", BASELINE_JPEG, { filename: "id.jpg", contentType: "image/jpeg" }),
      redeem: () => request(http).post(`/api/v1/onboarding/invitations/${token}/redeem`).send({}),
    };
    for (const [route, send] of Object.entries(routes)) {
      for (let i = 0; i < 3; i++) {
        const response = await send();
        expect({ route, status: response.status }).toEqual({ route, status: 404 });
      }
      const limited = await send();
      expect({ route, status: limited.status, code: limited.body.code }).toEqual({ route, status: 429, code: "RATE_LIMITED" });
      expect(limited.headers["retry-after"]).toBeDefined();
    }
  });
});

describe("Nothing sensitive is logged, audited or notified", () => {
  it("no ID number, account number, branch and account, invitation token, file name or photo metadata in any log line, audit row or notification", async () => {
    const logs = loggedText();
    // The capture saw the API's own log lines (the console OTP adapter and the development push adapter log on every sign-in and notification).
    expect(logs).toContain("OTP for");
    expect(logs).toContain("[DEV PUSH");
    expect([...SECRETS].filter((value) => logs.includes(value))).toEqual([]);

    const prisma = new PrismaService();
    try {
      const notifications = JSON.stringify(await prisma.notification.findMany());
      const audit = JSON.stringify(await prisma.auditLog.findMany());
      expect(notifications).toContain("ONBOARDING_SUBMITTED");
      expect(audit).toContain("WORKER_SENSITIVE_DATA_VIEWED");
      expect([...SECRETS].filter((value) => notifications.includes(value))).toEqual([]);
      expect([...SECRETS].filter((value) => audit.includes(value))).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
