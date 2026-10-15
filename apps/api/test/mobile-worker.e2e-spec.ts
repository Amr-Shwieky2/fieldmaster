import { randomBytes } from "node:crypto";
import { ConsoleLogger, Logger, type INestApplication } from "@nestjs/common";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import {
  AccountStatus,
  FileAssetPurpose,
  MAX_UPLOAD_BYTES,
  NotificationType,
  OrgRole,
  TimeEntryStatus,
  TuranType,
} from "@fieldmaster/shared-types";
import {
  canonicalizeOfflineEvent,
  generateOfflineSigningKeyPair,
  signOfflineEvent,
  toBusinessYearMonth,
  type OfflineEventSignablePayload,
} from "@fieldmaster/shared-validation";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { useEnv } from "./use-env";
import { calculatePayroll } from "./payroll-helpers";
import { BASELINE_JPEG, CLEAN_PNG, PHOTO_METADATA_SECRET, TEXT_FILE, jpegWithExif } from "./onboarding-files";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { FilesService } from "../src/common/files/files.service";
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from "../src/modules/notifications/push/push-provider";
import { MOCK_TRANSCRIPT } from "../src/modules/attachments/transcription";
import { MAX_UNATTACHED_ATTACHMENTS_PER_WORKER } from "../src/modules/files/uploads.service";
import {
  addFieldManager,
  addWorker,
  assignWorkerToShift,
  createOrgWithOwner,
  createProject,
  createSiteWithGeofence,
  createStandardShift,
} from "./fixtures";

/**
 * Step 9: the API of the mobile worker app -- device registration, private
 * attachments (photos, voice summaries) and their transcription, the clock-in
 * / clock-out additions (photos, voice note, mock-location state, receipt),
 * the worker's own entry detail and pay, the current-month estimate,
 * emergency eligibility, notification preferences and push, account states at
 * sign-in, device-key revocation, and the worker's shift detail.
 */

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
const NEARBY_LAT = 32.0858;

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const TRACKED_MANAGER_PHONE = "+972500000012";
const WORKER_PHONE = "+972500010001";
const OTHER_WORKER_PHONE = "+972500010002";
const NIGHT_WORKER_PHONE = "+972500010003";

const WORKER_PUSH_TOKEN = "ExponentPushToken[worker-a-phone-0001]";
const OWNER_PUSH_TOKEN = "ExpoPushToken[owner-phone-0002]";

/** The first bytes of an M4A recording (what iOS / Android record), padded. */
const M4A = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00]), Buffer.alloc(240, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]), Buffer.alloc(120, 3)]);
const OGG = Buffer.concat([Buffer.from("OggS\x00\x02", "latin1"), Buffer.alloc(120, 4)]);
const WAV = Buffer.concat([Buffer.from("RIFF\x24\x08\x00\x00WAVEfmt ", "latin1"), Buffer.alloc(120, 5)]);
const MP3 = Buffer.concat([Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1"), Buffer.alloc(120, 6)]);

const testRandomBytes = (n: number) => new Uint8Array(randomBytes(n));

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

// ── Object storage cleanup (the development bucket is shared) ────────────────

const storedOrganizations = new Set<string>();

async function removeStoredAttachments() {
  const client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
  const bucket = process.env.S3_BUCKET ?? "fieldmaster-dev";
  for (const organizationId of storedOrganizations) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `attachments/${organizationId}/` }));
    const keys = (listed.Contents ?? []).map((object) => ({ Key: object.Key ?? "" }));
    if (keys.length > 0) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
  }
  storedOrganizations.clear();
}

async function waitFor<T>(probe: () => Promise<T | null | undefined>, what: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const MONEY = /agorot/i;

// ─────────────────────────────────────────────────────────────────────────────

describe("Mobile worker app API (Step 9)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication["getHttpServer"]>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await removeStoredAttachments();
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Like loginAs, but a failed sign-in says what the API answered. */
  async function login(phoneNumber: string, deviceId = "test-device"): Promise<{ accessToken: string; refreshToken: string }> {
    await request(http).post("/api/v1/auth/otp/request").send({ phoneNumber }).expect(204);
    const response = await request(http).post("/api/v1/auth/otp/verify").send({ phoneNumber, code: "000000", deviceId, platform: "WEB" });
    if (response.status !== 201) throw new Error(`Sign-in of ${phoneNumber} answered ${response.status} ${JSON.stringify(response.body)} ${JSON.stringify(response.headers)}`);
    return response.body;
  }

  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    storedOrganizations.add(organizationId);
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const trackedManager = await addFieldManager(prisma, organizationId, TRACKED_MANAGER_PHONE, "Rana Foreman", true);
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker", { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
    const otherWorker = await addWorker(prisma, organizationId, OTHER_WORKER_PHONE, "Rami Other", { type: "HOURLY", hourlyRateAgorot: 5_000, overtimeRateAgorot: 7_500 });
    const project = await createProject(prisma, organizationId, `PRJ-${uuidv7().slice(-12)}`);
    await prisma.project.update({ where: { id: project.id }, data: { name: "Ayalon Interchange", budgetAgorot: 99_000_000 } });
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    await prisma.site.update({ where: { id: site.id }, data: { name: "Ayalon North", instructions: "Enter through gate 3; vests required." } });
    const start = new Date(Date.now() - 60 * 60_000);
    const end = new Date(Date.now() + 8 * 60 * 60_000);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, start, end);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shift.id, otherWorker.workerProfile.id, manager.user.id);

    const tokens = {
      owner: (await login(OWNER_PHONE)).accessToken,
      manager: (await login(MANAGER_PHONE)).accessToken,
      trackedManager: (await login(TRACKED_MANAGER_PHONE)).accessToken,
      worker: (await login(WORKER_PHONE, "worker-phone")).accessToken,
      otherWorker: (await login(OTHER_WORKER_PHONE, "other-phone")).accessToken,
    };
    return { organizationId, owner, manager, trackedManager, worker, otherWorker, project, site, geofence, shift, tokens };
  }

  const clockBody = (extra: Record<string, unknown> = {}) => ({
    deviceId: "worker-phone",
    clientEventId: uuidv7(),
    deviceTimestamp: new Date().toISOString(),
    latitude: NEARBY_LAT,
    longitude: SITE_LNG,
    accuracyMeters: 8,
    ...extra,
  });

  const clockIn = (token: string, shiftId: string, extra: Record<string, unknown> = {}) =>
    request(http).post("/api/v1/clock-events/clock-in").set(auth(token)).set("Idempotency-Key", uuidv7()).send(clockBody({ shiftId, ...extra }));

  const clockOut = (token: string, extra: Record<string, unknown> = {}) =>
    request(http)
      .post("/api/v1/clock-events/clock-out")
      .set(auth(token))
      .set("Idempotency-Key", uuidv7())
      .send(clockBody({ taskCategory: "TRAFFIC_SIGN", ...extra }));

  const upload = (token: string, purpose: string, bytes: Buffer, filename: string, contentType: string) =>
    request(http).post("/api/v1/attachments").set(auth(token)).field("purpose", purpose).attach("file", bytes, { filename, contentType });

  async function uploadId(token: string, purpose: string, bytes: Buffer, filename = "file.bin", contentType = "application/octet-stream"): Promise<string> {
    const response = await upload(token, purpose, bytes, filename, contentType).expect(201);
    return response.body.fileAssetId as string;
  }

  /** A closed entry of the worker: clock-in, clock-out with a typed summary. */
  async function closedEntry(ctx: Awaited<ReturnType<typeof setup>>, summaryText = "Installed traffic diversion signs.") {
    await clockIn(ctx.tokens.worker, ctx.shift.id).expect(201);
    const out = await clockOut(ctx.tokens.worker, { summaryText }).expect(201);
    return out.body as { id: string; businessDate: string; clockOutAt: string };
  }

  const expectError = (response: Response, status: number, code: string) =>
    expect({ status: response.status, code: response.body.code }).toEqual({ status, code });

  // ── PUT /devices/me ─────────────────────────────────────────────────────

  describe("PUT /devices/me", () => {
    it("upserts the caller's device (platform, versions, push token, attestation) and reports the offline key's state", async () => {
      const ctx = await setup();
      const registered = await request(http)
        .put("/api/v1/devices/me")
        .set(auth(ctx.tokens.worker))
        .send({ deviceId: "worker-phone", platform: "ANDROID", osVersion: "15", appVersion: "1.9.0", pushToken: WORKER_PUSH_TOKEN, attestationState: "DEV_MOCK" })
        .expect(200);
      expect(registered.body).toEqual({ deviceId: "worker-phone", platform: "ANDROID", keyStatus: "NONE", registeredAt: expect.any(String) });
      const device = await prisma.userDevice.findFirstOrThrow({ where: { userId: ctx.worker.user.id, clientDeviceId: "worker-phone" } });
      expect(device).toMatchObject({ platform: "ANDROID", osVersion: "15", appVersion: "1.9.0", pushToken: WORKER_PUSH_TOKEN, attestationState: "DEV_MOCK", lastActiveAt: expect.any(Date) });

      // Left out: kept. Null: cleared.
      await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.worker)).send({ deviceId: "worker-phone", platform: "ANDROID", appVersion: "1.9.1" }).expect(200);
      expect(await prisma.userDevice.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({ osVersion: "15", appVersion: "1.9.1", pushToken: WORKER_PUSH_TOKEN });
      await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.worker)).send({ deviceId: "worker-phone", platform: "ANDROID", pushToken: null, osVersion: null }).expect(200);
      expect(await prisma.userDevice.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({ osVersion: null, pushToken: null });

      // The key state follows the offline-signing key.
      const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
      await request(http).post("/api/v1/devices/public-key").set(auth(ctx.tokens.worker)).send({ deviceId: "worker-phone", publicKey: keyPair.publicKeyBase64 }).expect(201);
      const active = await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.worker)).send({ deviceId: "worker-phone", platform: "ANDROID" }).expect(200);
      expect(active.body.keyStatus).toBe("ACTIVE");

      // Any signed-in member may register a device (here an Owner, from the admin web).
      await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.owner)).send({ deviceId: "owner-browser", platform: "WEB", osVersion: null, appVersion: null, pushToken: null }).expect(200);
      await request(http).put("/api/v1/devices/me").send({ deviceId: "x", platform: "IOS" }).expect(401);
    });

    it("validates the platform, the push token (Expo format, at most 200 characters), the versions (at most 50) and the attestation code", async () => {
      const ctx = await setup();
      const put = (body: Record<string, unknown>) => request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.worker)).send({ deviceId: "worker-phone", platform: "IOS", ...body });
      for (const body of [
        { platform: "BLACKBERRY" },
        { pushToken: "not-a-token" },
        { pushToken: "ExponentPushToken[]" },
        { pushToken: "ExponentPushToken[with space]" },
        { pushToken: `ExponentPushToken[${"a".repeat(190)}]` },
        { pushToken: "fcm:APA91bH-raw-firebase-token" },
        { osVersion: "1".repeat(51) },
        { appVersion: "9".repeat(51) },
        { attestationState: "dev-mock" },
        { deviceId: "" },
        { extra: "field" },
      ]) {
        expectError(await put(body), 400, "VALIDATION_FAILED");
      }
      await put({ pushToken: "ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]", osVersion: "1".repeat(50), appVersion: "17.0.1" }).expect(200);
    });

    it("keeps a push token on one device only: the previous user of the phone stops receiving pushes", async () => {
      const ctx = await setup();
      await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.worker)).send({ deviceId: "shared-phone", platform: "ANDROID", pushToken: WORKER_PUSH_TOKEN }).expect(200);
      // The same phone, now used by another worker.
      await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.otherWorker)).send({ deviceId: "shared-phone", platform: "ANDROID", pushToken: WORKER_PUSH_TOKEN }).expect(200);
      const holders = await prisma.userDevice.findMany({ where: { pushToken: WORKER_PUSH_TOKEN }, select: { userId: true } });
      expect(holders).toEqual([{ userId: ctx.otherWorker.user.id }]);
    });

    it("signing out clears the device's push token", async () => {
      const ctx = await setup();
      const session = await login(WORKER_PHONE, "sign-out-phone");
      await request(http).put("/api/v1/devices/me").set(auth(session.accessToken)).send({ deviceId: "sign-out-phone", platform: "IOS", pushToken: WORKER_PUSH_TOKEN }).expect(200);
      await request(http).post("/api/v1/auth/logout").send({ refreshToken: session.refreshToken }).expect(204);
      expect(await prisma.userDevice.findFirstOrThrow({ where: { userId: ctx.worker.user.id, clientDeviceId: "sign-out-phone" } })).toMatchObject({ pushToken: null });
    });
  });

  // ── POST /attachments ───────────────────────────────────────────────────

  describe("POST /attachments", () => {
    it("stores a worker's photo without its metadata and a voice summary as received, typed by content, privately under attachments/<org>/<worker>/<id>", async () => {
      const ctx = await setup();
      const photo = jpegWithExif();
      const uploaded = await upload(ctx.tokens.worker, "ATTENDANCE_PHOTO", photo, "IMG_0001.jpg", "image/jpeg").expect(201);
      expect(uploaded.body).toEqual({ fileAssetId: expect.any(String), purpose: "ATTENDANCE_PHOTO", contentType: "image/jpeg", sizeBytes: BASELINE_JPEG.length });
      const asset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: uploaded.body.fileAssetId } });
      expect(asset).toMatchObject({
        organizationId: ctx.organizationId,
        purpose: FileAssetPurpose.ATTENDANCE_PHOTO,
        workerProfileId: ctx.worker.workerProfile.id,
        timeEntryId: null,
        invitationId: null,
        storageKey: `attachments/${ctx.organizationId}/${ctx.worker.workerProfile.id}/${asset.id}`,
        scanResult: "NOT_SCANNED",
      });
      const stored = await app.get(FilesService).getObject(asset.storageKey);
      expect(stored?.equals(BASELINE_JPEG)).toBe(true);
      expect(stored?.includes(Buffer.from(PHOTO_METADATA_SECRET, "latin1"))).toBe(false);

      // Audio: the type comes from the content, never the name or the claimed mimetype.
      const audio: [Buffer, string][] = [
        [M4A, "audio/mp4"],
        [WEBM, "audio/webm"],
        [OGG, "audio/ogg"],
        [WAV, "audio/wav"],
        [MP3, "audio/mpeg"],
      ];
      for (const [bytes, contentType] of audio) {
        const response = await upload(ctx.tokens.worker, "VOICE_SUMMARY", bytes, "summary.mp3", "audio/mpeg").expect(201);
        expect(response.body).toEqual({ fileAssetId: expect.any(String), purpose: "VOICE_SUMMARY", contentType, sizeBytes: bytes.length });
        const voice = await prisma.fileAsset.findUniqueOrThrow({ where: { id: response.body.fileAssetId } });
        expect((await app.get(FilesService).getObject(voice.storageKey))?.equals(bytes)).toBe(true);
      }
      await upload(ctx.tokens.worker, "ATTENDANCE_PHOTO", CLEAN_PNG, "x.png", "image/png").expect(201);
    });

    it("refuses the wrong type for the purpose (415), the onboarding purposes and a missing file (400), and a file over 10 MB (413)", async () => {
      const ctx = await setup();
      const refused: [string, Buffer, number, string][] = [
        ["VOICE_SUMMARY", CLEAN_PNG, 415, "FILE_TYPE_NOT_ALLOWED"],
        ["ATTENDANCE_PHOTO", M4A, 415, "FILE_TYPE_NOT_ALLOWED"],
        ["ATTENDANCE_PHOTO", TEXT_FILE, 415, "FILE_TYPE_NOT_ALLOWED"],
        ["VOICE_SUMMARY", TEXT_FILE, 415, "FILE_TYPE_NOT_ALLOWED"],
        ["IDENTITY_DOCUMENT", BASELINE_JPEG, 400, "VALIDATION_FAILED"],
        ["PROFILE_PHOTO", BASELINE_JPEG, 400, "VALIDATION_FAILED"],
      ];
      for (const [purpose, bytes, status, code] of refused) {
        expectError(await upload(ctx.tokens.worker, purpose, bytes, "file.jpg", "image/jpeg"), status, code);
      }
      const typeRefusal = await upload(ctx.tokens.worker, "VOICE_SUMMARY", CLEAN_PNG, "x.png", "image/png");
      expect(typeRefusal.body.details.allowedContentTypes).toEqual(["audio/mp4", "audio/webm", "audio/ogg", "audio/wav", "audio/mpeg"]);
      expectError(await request(http).post("/api/v1/attachments").set(auth(ctx.tokens.worker)).field("purpose", "ATTENDANCE_PHOTO"), 400, "VALIDATION_FAILED");
      const tooLarge = Buffer.concat([M4A, Buffer.alloc(MAX_UPLOAD_BYTES)]);
      expectError(await upload(ctx.tokens.worker, "VOICE_SUMMARY", tooLarge, "long.m4a", "audio/mp4"), 413, "FILE_TOO_LARGE");
      expect(await prisma.fileAsset.count()).toBe(0);
    });

    it("is for time-trackable members with a worker profile only, and bounds unattached files per worker (429)", async () => {
      const ctx = await setup();
      for (const token of [ctx.tokens.owner, ctx.tokens.manager]) {
        expectError(await upload(token, "ATTENDANCE_PHOTO", BASELINE_JPEG, "a.jpg", "image/jpeg"), 403, "FORBIDDEN");
      }
      await upload(ctx.tokens.trackedManager, "ATTENDANCE_PHOTO", BASELINE_JPEG, "a.jpg", "image/jpeg").expect(201);
      await request(http).post("/api/v1/attachments").field("purpose", "ATTENDANCE_PHOTO").attach("file", BASELINE_JPEG, "a.jpg").expect(401);

      // Fill the worker's unattached allowance; an attached file does not count.
      await prisma.fileAsset.createMany({
        data: Array.from({ length: MAX_UNATTACHED_ATTACHMENTS_PER_WORKER }, () => {
          const id = uuidv7();
          return {
            id,
            organizationId: ctx.organizationId,
            purpose: FileAssetPurpose.ATTENDANCE_PHOTO,
            storageKey: `attachments/${ctx.organizationId}/${ctx.worker.workerProfile.id}/${id}`,
            contentType: "image/jpeg",
            sizeBytes: 1,
            sha256: "0".repeat(64),
            scanResult: "NOT_SCANNED",
            workerProfileId: ctx.worker.workerProfile.id,
          };
        }),
      });
      const limited = await upload(ctx.tokens.worker, "ATTENDANCE_PHOTO", BASELINE_JPEG, "a.jpg", "image/jpeg");
      expectError(limited, 429, "RATE_LIMITED");
      expect(limited.body.details).toEqual({ maxUnattached: MAX_UNATTACHED_ATTACHMENTS_PER_WORKER });
      // Another worker is not affected.
      await upload(ctx.tokens.otherWorker, "ATTENDANCE_PHOTO", BASELINE_JPEG, "a.jpg", "image/jpeg").expect(201);
    });

    it("transcribes the caller's own voice summary only (mock: a fixed Arabic sentence), and never logs the transcript", async () => {
      const ctx = await setup();
      const voiceId = await uploadId(ctx.tokens.worker, "VOICE_SUMMARY", M4A);
      const transcribed = await request(http).post(`/api/v1/attachments/${voiceId}/transcription`).set(auth(ctx.tokens.worker)).expect(200);
      expect(transcribed.body).toEqual({ fileAssetId: voiceId, text: MOCK_TRANSCRIPT, provider: "mock", language: "ar" });

      // Anything else does not exist for the caller: another worker's recording, a photo, a malformed or unknown id.
      const photoId = await uploadId(ctx.tokens.worker, "ATTENDANCE_PHOTO", BASELINE_JPEG);
      const othersVoice = await uploadId(ctx.tokens.otherWorker, "VOICE_SUMMARY", WAV);
      for (const [token, id] of [
        [ctx.tokens.otherWorker, voiceId],
        [ctx.tokens.worker, othersVoice],
        [ctx.tokens.worker, photoId],
        [ctx.tokens.worker, "not-an-id"],
        [ctx.tokens.worker, uuidv7()],
        [ctx.tokens.owner, voiceId],
        [ctx.tokens.trackedManager, voiceId],
      ] as const) {
        expectError(await request(http).post(`/api/v1/attachments/${id}/transcription`).set(auth(token)), 404, "NOT_FOUND");
      }
      expect(loggedText()).not.toContain(MOCK_TRANSCRIPT);
    });
  });

  // ── Clock-in / clock-out (Step 9 fields) ──────────────────────────────────

  describe("clock-in and clock-out", () => {
    it("answers the receipt: the clock event (reference, server and device times), the entry and its shift", async () => {
      const ctx = await setup();
      const deviceTimestamp = new Date(Date.now() - 5_000).toISOString();
      const clockedIn = await clockIn(ctx.tokens.worker, ctx.shift.id, { deviceTimestamp }).expect(201);
      expect(clockedIn.body.clockEvent).toMatchObject({ id: expect.any(String), eventType: "CLOCK_IN", deviceTimestamp, serverReceivedAt: expect.any(String) });
      expect(clockedIn.body.timeEntry).toMatchObject({ id: expect.any(String), status: TimeEntryStatus.ACTIVE, shift: { id: ctx.shift.id, title: "Test Shift" } });
      expect(clockedIn.body.timeEntry.shift.geofence).toBeUndefined();

      const clockedOut = await clockOut(ctx.tokens.worker, { summaryText: "Replaced two damaged signs." }).expect(201);
      // The response is still the closed entry (as before Step 9), with the receipt fields added.
      expect(clockedOut.body).toMatchObject({
        id: clockedIn.body.timeEntry.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        businessDate: expect.any(String),
        clockOutAt: expect.any(String),
        dailySummary: { text: "Replaced two damaged signs.", summarySource: "TYPED", voiceNoteAssetId: null },
        shift: { id: ctx.shift.id, title: "Test Shift" },
        clockEvent: { id: expect.any(String), eventType: "CLOCK_OUT", timeEntryId: clockedIn.body.timeEntry.id, serverReceivedAt: expect.any(String), deviceTimestamp: expect.any(String) },
      });
      expect(await prisma.clockEvent.findUniqueOrThrow({ where: { id: clockedOut.body.clockEvent.id } })).toMatchObject({ eventType: "CLOCK_OUT" });
    });

    it("mockLocationState DETECTED is refused exactly like mockLocationSuspected; UNAVAILABLE and NOT_DETECTED pass, and signals are only recorded", async () => {
      const ctx = await setup();
      const detected = await clockIn(ctx.tokens.worker, ctx.shift.id, { mockLocationState: "DETECTED" });
      expectError(detected, 403, "MOCK_LOCATION_BLOCKED");
      const legacy = await clockIn(ctx.tokens.worker, ctx.shift.id, { mockLocationSuspected: true });
      expect({ status: legacy.status, body: { code: legacy.body.code, message: legacy.body.message } }).toEqual({
        status: detected.status,
        body: { code: detected.body.code, message: detected.body.message },
      });
      expect(await prisma.timeEntry.count()).toBe(0);
      const attempts = await prisma.rejectedClockAttempt.findMany({ orderBy: { createdAt: "asc" } });
      expect(attempts).toEqual([
        expect.objectContaining({ code: "MOCK_LOCATION_BLOCKED", eventType: "CLOCK_IN", mockLocationSuspected: true, mockLocationState: "DETECTED" }),
        expect.objectContaining({ code: "MOCK_LOCATION_BLOCKED", eventType: "CLOCK_IN", mockLocationSuspected: true, mockLocationState: null }),
      ]);

      // UNAVAILABLE (iOS, the web) passes, with suspicious signals recorded but never a refusal.
      const accepted = await clockIn(ctx.tokens.worker, ctx.shift.id, { mockLocationState: "UNAVAILABLE", locationSignals: ["IMPOSSIBLE_SPEED", "ZERO_ACCURACY"] }).expect(201);
      expect(await prisma.clockEvent.findUniqueOrThrow({ where: { id: accepted.body.clockEvent.id } })).toMatchObject({
        mockLocationState: "UNAVAILABLE",
        locationSignals: ["IMPOSSIBLE_SPEED", "ZERO_ACCURACY"],
        mockLocationSuspected: false,
        locationValidationStatus: "PASSED",
      });

      // A refused clock-out keeps the entry open, and is evidence on it.
      expectError(await clockOut(ctx.tokens.worker, { summaryText: "Done.", mockLocationState: "DETECTED" }), 403, "MOCK_LOCATION_BLOCKED");
      expect(await prisma.rejectedClockAttempt.findFirstOrThrow({ where: { eventType: "CLOCK_OUT" } })).toMatchObject({
        timeEntryId: accepted.body.timeEntry.id,
        mockLocationState: "DETECTED",
        mockLocationSuspected: true,
      });
      expect(await prisma.timeEntry.findUniqueOrThrow({ where: { id: accepted.body.timeEntry.id } })).toMatchObject({ status: TimeEntryStatus.ACTIVE });

      const out = await clockOut(ctx.tokens.worker, { summaryText: "Done.", mockLocationState: "NOT_DETECTED", locationSignals: [] }).expect(201);
      expect(out.body.clockEvent).toMatchObject({ mockLocationState: "NOT_DETECTED", locationSignals: [] });
      // Before Step 9 a client sends neither: the state stays null.
      await clockIn(ctx.tokens.otherWorker, ctx.shift.id, { deviceId: "other-phone" }).expect(201);
      expect(await prisma.clockEvent.findFirstOrThrow({ where: { deviceId: "other-phone" } })).toMatchObject({ mockLocationState: null, locationSignals: [] });
    });

    it("validates the mock-location state and the signals (at most 10, each at most 40 characters, A-Z and _)", async () => {
      const ctx = await setup();
      for (const extra of [
        { mockLocationState: "MAYBE" },
        { locationSignals: ["impossible_speed"] },
        { locationSignals: ["SPEED-JUMP"] },
        { locationSignals: ["A".repeat(41)] },
        { locationSignals: Array.from({ length: 11 }, () => "JUMP") },
        { locationSignals: "IMPOSSIBLE_SPEED" },
        { locationSignals: [42] },
      ]) {
        expectError(await clockIn(ctx.tokens.worker, ctx.shift.id, extra), 400, "VALIDATION_FAILED");
      }
      await clockIn(ctx.tokens.worker, ctx.shift.id, { locationSignals: Array.from({ length: 10 }, () => "A".repeat(40)) }).expect(201);
    });

    it("links the photos to the entry in the same transaction, and refuses a foreign, a used or a wrong-purpose upload (400 UPLOAD_NOT_FOUND)", async () => {
      const ctx = await setup();
      const first = await uploadId(ctx.tokens.worker, "ATTENDANCE_PHOTO", jpegWithExif());
      const second = await uploadId(ctx.tokens.worker, "ATTENDANCE_PHOTO", CLEAN_PNG);
      const othersPhoto = await uploadId(ctx.tokens.otherWorker, "ATTENDANCE_PHOTO", BASELINE_JPEG);
      const voice = await uploadId(ctx.tokens.worker, "VOICE_SUMMARY", M4A);

      for (const [photoAssetIds, label] of [
        [[othersPhoto], "another worker's photo"],
        [[first, othersPhoto], "one of them foreign"],
        [[voice], "a voice summary as a photo"],
        [[uuidv7()], "an unknown id"],
      ] as const) {
        const refused = await clockIn(ctx.tokens.worker, ctx.shift.id, { photoAssetIds });
        expect({ label, status: refused.status, code: refused.body.code, details: refused.body.details }).toEqual({
          label,
          status: 400,
          code: "UPLOAD_NOT_FOUND",
          details: { field: "photoAssetIds" },
        });
      }
      expect(await prisma.timeEntry.count()).toBe(0);
      for (const extra of [{ photoAssetIds: ["not-a-uuid"] }, { photoAssetIds: [first, first] }, { photoAssetIds: Array.from({ length: 6 }, () => uuidv7()) }, { photoAssetIds: first }]) {
        expectError(await clockIn(ctx.tokens.worker, ctx.shift.id, extra), 400, "VALIDATION_FAILED");
      }

      const clockedIn = await clockIn(ctx.tokens.worker, ctx.shift.id, { photoAssetIds: [first, second] }).expect(201);
      const entryId: string = clockedIn.body.timeEntry.id;
      expect((await prisma.fileAsset.findMany({ where: { id: { in: [first, second] } } })).map((asset) => asset.timeEntryId)).toEqual([entryId, entryId]);
      expect(await prisma.fileAsset.findUniqueOrThrow({ where: { id: othersPhoto } })).toMatchObject({ timeEntryId: null });

      // A used photo is refused at clock-out too; a new one is linked to the same entry.
      const refusedOut = await clockOut(ctx.tokens.worker, { summaryText: "Done.", photoAssetIds: [first] });
      expect({ status: refusedOut.status, code: refusedOut.body.code, details: refusedOut.body.details }).toEqual({ status: 400, code: "UPLOAD_NOT_FOUND", details: { field: "photoAssetIds" } });
      const third = await uploadId(ctx.tokens.worker, "ATTENDANCE_PHOTO", BASELINE_JPEG);
      await clockOut(ctx.tokens.worker, { summaryText: "Done.", photoAssetIds: [third] }).expect(201);
      expect(await prisma.fileAsset.count({ where: { timeEntryId: entryId, purpose: FileAssetPurpose.ATTENDANCE_PHOTO } })).toBe(3);
      // Used uploads no longer count against the unattached allowance.
      expect(await prisma.fileAsset.count({ where: { workerProfileId: ctx.worker.workerProfile.id, timeEntryId: null } })).toBe(1);
    });

    it("the summary rule: typed text or a voice note (an uploaded VOICE_SUMMARY), linked to the entry and to the summary with its transcript", async () => {
      const ctx = await setup();
      await clockIn(ctx.tokens.worker, ctx.shift.id).expect(201);
      expectError(await clockOut(ctx.tokens.worker, {}), 400, "SUMMARY_REQUIRED");
      expectError(await clockOut(ctx.tokens.worker, { summaryText: "   ", transcription: "only a transcript" }), 400, "SUMMARY_REQUIRED");

      const othersVoice = await uploadId(ctx.tokens.otherWorker, "VOICE_SUMMARY", M4A);
      const photo = await uploadId(ctx.tokens.worker, "ATTENDANCE_PHOTO", BASELINE_JPEG);
      for (const voiceNoteAssetId of [othersVoice, photo, uuidv7()]) {
        const refused = await clockOut(ctx.tokens.worker, { voiceNoteAssetId });
        expect({ status: refused.status, code: refused.body.code, details: refused.body.details }).toEqual({ status: 400, code: "UPLOAD_NOT_FOUND", details: { field: "voiceNoteAssetId" } });
      }
      for (const extra of [{ voiceNoteAssetId: "not-a-uuid" }, { summarySource: "SPOKEN", summaryText: "x" }, { summaryText: "x", transcription: "ك".repeat(5001) }]) {
        expectError(await clockOut(ctx.tokens.worker, extra), 400, "VALIDATION_FAILED");
      }
      expect(await prisma.timeEntry.findFirstOrThrow({ where: { workerProfileId: ctx.worker.workerProfile.id } })).toMatchObject({ status: TimeEntryStatus.ACTIVE });

      // A voice note alone satisfies the rule; the transcript (as the service returned it) is kept with it.
      const voice = await uploadId(ctx.tokens.worker, "VOICE_SUMMARY", M4A);
      const out = await clockOut(ctx.tokens.worker, { voiceNoteAssetId: voice, transcription: MOCK_TRANSCRIPT, followUpRequired: true }).expect(201);
      expect(out.body.dailySummary).toMatchObject({ text: null, voiceNoteAssetId: voice, summarySource: "VOICE", transcription: MOCK_TRANSCRIPT, followUpRequired: true });
      expect(await prisma.fileAsset.findUniqueOrThrow({ where: { id: voice } })).toMatchObject({ timeEntryId: out.body.id });

      // The transcript edited by the worker as the text, the source given explicitly; a used voice note is refused.
      await clockIn(ctx.tokens.worker, ctx.shift.id).expect(201);
      const reused = await clockOut(ctx.tokens.worker, { voiceNoteAssetId: voice });
      expect({ status: reused.status, code: reused.body.code }).toEqual({ status: 400, code: "UPLOAD_NOT_FOUND" });
      const second = await uploadId(ctx.tokens.worker, "VOICE_SUMMARY", OGG);
      const edited = await clockOut(ctx.tokens.worker, { voiceNoteAssetId: second, summaryText: "أنهيت تركيب لافتات تحويل السير.", transcription: MOCK_TRANSCRIPT, summarySource: "VOICE" }).expect(201);
      expect(edited.body.dailySummary).toMatchObject({ text: "أنهيت تركيب لافتات تحويل السير.", summarySource: "VOICE", voiceNoteAssetId: second });
    });

    it("an offline event may carry a signed mockLocationState: DETECTED is refused like the online rule, and the verdict cannot be changed after signing", async () => {
      const ctx = await setup();
      const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
      await request(http).post("/api/v1/devices/public-key").set(auth(ctx.tokens.worker)).send({ deviceId: "worker-phone", publicKey: keyPair.publicKeyBase64 }).expect(201);
      const sync = async (payload: OfflineEventSignablePayload, sent: Record<string, unknown> = payload as unknown as Record<string, unknown>) => {
        const signature = signOfflineEvent(canonicalizeOfflineEvent(payload), keyPair.secretKeyBase64);
        const response = await request(http)
          .post("/api/v1/offline-sync/batches")
          .set(auth(ctx.tokens.worker))
          .set("Idempotency-Key", uuidv7())
          .send({ deviceId: "worker-phone", events: [{ ...sent, signature }] })
          .expect(201);
        return response.body.results[0];
      };
      const event = (mockLocationState?: string): OfflineEventSignablePayload => ({
        clientEventId: uuidv7(),
        eventType: "CLOCK_IN",
        shiftId: ctx.shift.id,
        deviceTimestamp: new Date(Date.now() - 30_000).toISOString(),
        latitude: NEARBY_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
        ...(mockLocationState ? { mockLocationState } : {}),
      });

      expect(await sync(event("DETECTED"))).toMatchObject({ status: "REJECTED", reason: "MOCK_LOCATION_BLOCKED" });
      const tampered = event("DETECTED");
      expect(await sync(tampered, { ...tampered, mockLocationState: "NOT_DETECTED" })).toMatchObject({ status: "REJECTED", reason: "INVALID_OFFLINE_SIGNATURE" });
      expect(await prisma.timeEntry.count()).toBe(0);
      const accepted = await sync(event("UNAVAILABLE"));
      expect(accepted).toMatchObject({ status: "VERIFIED", timeEntryId: expect.any(String) });
      expect(await prisma.clockEvent.findFirstOrThrow({ where: { timeEntryId: accepted.timeEntryId } })).toMatchObject({ mockLocationState: "UNAVAILABLE", origin: "OFFLINE" });
    });
  });

  // ── The worker's own entries ──────────────────────────────────────────────

  describe("GET /time-entries (the worker's own)", () => {
    it("the own entry detail has the corrections with reason, note and who (by name), the summary and the photo count -- no money; another worker's entry is 404", async () => {
      const ctx = await setup();
      const photo = await uploadId(ctx.tokens.worker, "ATTENDANCE_PHOTO", BASELINE_JPEG);
      await clockIn(ctx.tokens.worker, ctx.shift.id, { photoAssetIds: [photo] }).expect(201);
      const voice = await uploadId(ctx.tokens.worker, "VOICE_SUMMARY", M4A);
      const out = await clockOut(ctx.tokens.worker, { summaryText: "Closed the right lane.", voiceNoteAssetId: voice, followUpRequired: true }).expect(201);
      const entryId: string = out.body.id;
      const tenHoursBefore = new Date(new Date(out.body.clockOutAt).getTime() - 10 * 60 * 60_000).toISOString();
      await request(http)
        .post("/api/v1/manual-corrections")
        .set(auth(ctx.tokens.manager))
        .send({ timeEntryId: entryId, field: "CLOCK_IN", newValue: tenHoursBefore, reason: "MANAGER_INSTRUCTION", note: "Started at the depot at 06:00." })
        .expect(201);

      const detail = await request(http).get(`/api/v1/time-entries/${entryId}`).set(auth(ctx.tokens.worker)).expect(200);
      expect(detail.body).toMatchObject({
        id: entryId,
        workerProfileId: ctx.worker.workerProfile.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        rawDurationMinutes: 600,
        shift: { id: ctx.shift.id, title: "Test Shift" },
        dailySummary: { text: "Closed the right lane.", taskCategory: "TRAFFIC_SIGN" },
        corrections: [
          {
            field: "clockInAt",
            oldValue: expect.any(String),
            newValue: tenHoursBefore,
            reason: "MANAGER_INSTRUCTION",
            note: "Started at the depot at 06:00.",
            correctedAt: expect.any(String),
            correctedByName: "Yossi Manager",
          },
        ],
        summary: { text: "Closed the right lane.", taskCategory: "TRAFFIC_SIGN", followUpRequired: true, summarySource: "VOICE", hasVoiceNote: true },
        photoCount: 1,
      });
      expect(detail.body.clockEvents.map((event: { eventType: string }) => event.eventType)).toEqual(["CLOCK_IN", "CLOCK_OUT"]);
      const json = JSON.stringify(detail.body);
      expect(json).not.toMatch(MONEY);
      // Who corrected it is a name: never their IP address, browser or user id.
      for (const key of ["requestIp", "userAgent", "editedBy", "correlationId", "payrollItemId", "transcription"]) expect(json).not.toContain(`"${key}"`);

      // Own only: another worker, malformed and unknown ids are 404 (not 403).
      for (const [token, id] of [
        [ctx.tokens.otherWorker, entryId],
        [ctx.tokens.trackedManager, uuidv7()],
        [ctx.tokens.worker, "not-an-id"],
        [ctx.tokens.worker, uuidv7()],
      ] as const) {
        expectError(await request(http).get(`/api/v1/time-entries/${id}`).set(auth(token)), 404, "NOT_FOUND");
      }
      // Managers keep the shape they always had.
      const managerView = await request(http).get(`/api/v1/time-entries/${entryId}`).set(auth(ctx.tokens.manager)).expect(200);
      expect(managerView.body).toMatchObject({ id: entryId, approvals: [], unpaidBreaks: [], corrections: [expect.objectContaining({ editedBy: ctx.manager.user.id })] });
      expect(managerView.body.summary).toBeUndefined();
    });

    it("lists the caller's own entries of one business month (?month=YYYY-MM); a malformed month is a 400", async () => {
      const ctx = await setup();
      const entry = await closedEntry(ctx);
      await clockIn(ctx.tokens.otherWorker, ctx.shift.id, { deviceId: "other-phone" }).expect(201);
      const month = entry.businessDate.slice(0, 7);
      const own = await request(http).get(`/api/v1/time-entries?month=${month}`).set(auth(ctx.tokens.worker)).expect(200);
      expect(own.body.map((row: { id: string }) => row.id)).toEqual([entry.id]);
      expect((await request(http).get("/api/v1/time-entries?month=2000-01").set(auth(ctx.tokens.worker)).expect(200)).body).toEqual([]);
      // Another worker's id in the filter is ignored for a worker.
      const scoped = await request(http).get(`/api/v1/time-entries?month=${month}&workerProfileId=${ctx.otherWorker.workerProfile.id}`).set(auth(ctx.tokens.worker)).expect(200);
      expect(scoped.body.map((row: { id: string }) => row.id)).toEqual([entry.id]);
      // A correction in the worker's list says what changed and why, never the manager's IP address or browser.
      await request(http)
        .post("/api/v1/manual-corrections")
        .set(auth(ctx.tokens.manager))
        .send({ timeEntryId: entry.id, field: "CLOCK_OUT", newValue: entry.clockOutAt, reason: "SYSTEM_ERROR", note: "Re-saved." })
        .expect(201);
      const withCorrection = await request(http).get(`/api/v1/time-entries?month=${month}`).set(auth(ctx.tokens.worker)).expect(200);
      expect(withCorrection.body[0].corrections).toEqual([
        { id: expect.any(String), timeEntryId: entry.id, field: "clockOutAt", oldValue: expect.any(String), newValue: expect.any(String), reason: "SYSTEM_ERROR", note: "Re-saved.", createdAt: expect.any(String) },
      ]);
      const managerList = await request(http).get(`/api/v1/time-entries?month=${month}&workerProfileId=${ctx.worker.workerProfile.id}`).set(auth(ctx.tokens.manager)).expect(200);
      expect(managerList.body[0].corrections[0]).toMatchObject({ editedBy: ctx.manager.user.id });
      expect(Object.keys(managerList.body[0].corrections[0])).toEqual(expect.arrayContaining(["requestIp", "userAgent", "correlationId"]));
      for (const bad of ["2026-13", "2026-1", "202610", "abc"]) {
        expectError(await request(http).get(`/api/v1/time-entries?month=${bad}`).set(auth(ctx.tokens.worker)), 400, "VALIDATION_FAILED");
      }
      expect((await request(http).get(`/api/v1/time-entries?month=${month}`).set(auth(ctx.tokens.manager)).expect(200)).body).toHaveLength(2);
    });
  });

  // ── The worker's own pay ──────────────────────────────────────────────────

  describe("pay: GET /time-entries/:id/my-pay and GET /payroll-statements/me/current", () => {
    it("no amount before approval; computed with the profile in effect once approved; from the finalized version once the month is finalized; own entry only", async () => {
      const ctx = await setup();
      const entry = await closedEntry(ctx);
      const tenHoursBefore = new Date(new Date(entry.clockOutAt).getTime() - 10 * 60 * 60_000).toISOString();
      await request(http)
        .post("/api/v1/manual-corrections")
        .set(auth(ctx.tokens.manager))
        .send({ timeEntryId: entry.id, field: "CLOCK_IN", newValue: tenHoursBefore, reason: "DEVICE_FAILURE" })
        .expect(201);
      const myPay = (token: string, id = entry.id) => request(http).get(`/api/v1/time-entries/${id}/my-pay`).set(auth(token));

      expect((await myPay(ctx.tokens.worker).expect(200)).body).toEqual({
        timeEntryId: entry.id,
        approved: false,
        compensationType: null,
        regularMinutes: 540,
        overtimeMinutes: 60,
        compensatedMinutes: null,
        baseAgorot: null,
        overtimeAgorot: null,
        totalAgorot: null,
        finalized: false,
      });

      await request(http).post(`/api/v1/time-entries/${entry.id}/approve`).set(auth(ctx.tokens.manager)).send({}).expect(201);
      // DAILY 400.00 ₪ + 60 overtime minutes at 60.00 ₪ an hour.
      const approved = { timeEntryId: entry.id, approved: true, compensationType: "DAILY", regularMinutes: 540, overtimeMinutes: 60, compensatedMinutes: null, baseAgorot: 40_000, overtimeAgorot: 6_000, totalAgorot: 46_000 };
      expect((await myPay(ctx.tokens.worker).expect(200)).body).toEqual({ ...approved, finalized: false });

      // Own only: another worker, a manager, a malformed or unknown id: 404.
      for (const [token, id] of [
        [ctx.tokens.otherWorker, entry.id],
        [ctx.tokens.manager, entry.id],
        [ctx.tokens.owner, entry.id],
        [ctx.tokens.trackedManager, entry.id],
        [ctx.tokens.worker, "not-an-id"],
        [ctx.tokens.worker, uuidv7()],
      ] as const) {
        expectError(await myPay(token, id), 404, "NOT_FOUND");
      }

      // Finalized: the figures are the finalized version's, even after the rate changes.
      const yearMonth = entry.businessDate.slice(0, 7);
      await calculatePayroll(app, ctx.tokens.owner, yearMonth);
      await request(http).post(`/api/v1/payroll-periods/${yearMonth}/finalize`).set(auth(ctx.tokens.owner)).expect(201);
      await prisma.compensationProfile.updateMany({ where: { workerProfileId: ctx.worker.workerProfile.id }, data: { dailyBaseRateAgorot: 99_900 } });
      expect((await myPay(ctx.tokens.worker).expect(200)).body).toEqual({ ...approved, finalized: true });
    });

    it("an emergency call-out's pay counts the -60 / +15 minutes", async () => {
      const ctx = await setup();
      const night = await addWorker(prisma, ctx.organizationId, NIGHT_WORKER_PHONE, "Mahmoud Night", { type: "HOURLY", hourlyRateAgorot: 6_000, overtimeRateAgorot: 9_000 });
      const nightToken = (await login(NIGHT_WORKER_PHONE, "night-phone")).accessToken;
      await request(http)
        .post("/api/v1/turan-assignments")
        .set(auth(ctx.tokens.owner))
        .send({ turanType: TuranType.NIGHT_TURAN, startAt: new Date(Date.now() - 60 * 60_000).toISOString(), endAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString(), assignedWorkerProfileId: night.workerProfile.id })
        .expect(201);
      const position = { deviceId: "night-phone", latitude: NEARBY_LAT, longitude: SITE_LNG, accuracyMeters: 10 };
      const started = await request(http)
        .post("/api/v1/emergency-callouts/start")
        .set(auth(nightToken))
        .set("Idempotency-Key", uuidv7())
        .send({ ...position, clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString() })
        .expect(201);
      await request(http)
        .post("/api/v1/emergency-callouts/end")
        .set(auth(nightToken))
        .set("Idempotency-Key", uuidv7())
        .send({ ...position, clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), summaryText: "Reset the signal controller.", taskCategory: "EMERGENCY_REPAIR" })
        .expect(201);

      const pending = await request(http).get(`/api/v1/time-entries/${started.body.timeEntryId}/my-pay`).set(auth(nightToken)).expect(200);
      expect(pending.body).toMatchObject({ approved: false, regularMinutes: 75, overtimeMinutes: 0, compensatedMinutes: 75, totalAgorot: null });
      await request(http).post(`/api/v1/time-entries/${started.body.timeEntryId}/approve`).set(auth(ctx.tokens.manager)).send({}).expect(201);
      expect((await request(http).get(`/api/v1/time-entries/${started.body.timeEntryId}/my-pay`).set(auth(nightToken)).expect(200)).body).toEqual({
        timeEntryId: started.body.timeEntryId,
        approved: true,
        compensationType: "HOURLY",
        regularMinutes: 75,
        overtimeMinutes: 0,
        compensatedMinutes: 75,
        baseAgorot: 7_500,
        overtimeAgorot: 0,
        totalAgorot: 7_500,
        finalized: false,
      });
    });

    it("the current month's estimate: approved entries and adjustments only, pending ones counted; the caller's own (no worker id); 409 once the month is finalized", async () => {
      const ctx = await setup();
      const approvedEntry = await closedEntry(ctx);
      // Half a day (270 minutes): DAILY pays it pro rata.
      const halfDayBefore = new Date(new Date(approvedEntry.clockOutAt).getTime() - 270 * 60_000).toISOString();
      await request(http)
        .post("/api/v1/manual-corrections")
        .set(auth(ctx.tokens.manager))
        .send({ timeEntryId: approvedEntry.id, field: "CLOCK_IN", newValue: halfDayBefore, reason: "DEVICE_FAILURE" })
        .expect(201);
      await request(http).post(`/api/v1/time-entries/${approvedEntry.id}/approve`).set(auth(ctx.tokens.manager)).send({}).expect(201);
      await closedEntry(ctx, "A second, still pending visit.");
      const yearMonth = toBusinessYearMonth(new Date());
      const approved = await prisma.timeEntry.findUniqueOrThrow({ where: { id: approvedEntry.id } });
      expect(approved.approvedRegularMinutes).toBe(270);
      const expectedBase = 20_000;

      const estimate = await request(http).get("/api/v1/payroll-statements/me/current").set(auth(ctx.tokens.worker)).expect(200);
      expect(estimate.body).toEqual({
        yearMonth,
        status: "DRAFT",
        isEstimate: true,
        basis: "APPROVED_ENTRIES_ONLY",
        calculatedAt: expect.any(String),
        version: null,
        finalizedAt: null,
        approvedShifts: 1,
        standardDaysCredited: 0,
        regularMinutes: approved.approvedRegularMinutes,
        overtimeMinutes: 0,
        baseAgorot: expectedBase,
        overtimeAgorot: 0,
        grossAgorot: expectedBase,
        adjustmentsAgorot: 0,
        forgottenStampDeductionsAgorot: 0,
        netPayableAgorot: expectedBase,
        pendingEntries: 1,
      });

      // No worker id is taken: an Owner without a worker profile gets 404 even when naming the worker (mobile manager
      // mode: with its own code, NO_WORKER_PROFILE, not a generic "not found"), and a time-trackable Field Manager gets
      // their own (empty) month, never the worker's.
      for (const path of ["/api/v1/payroll-statements/me/current", `/api/v1/payroll-statements/me/current?workerProfileId=${ctx.worker.workerProfile.id}`]) {
        expectError(await request(http).get(path).set(auth(ctx.tokens.owner)), 404, "NO_WORKER_PROFILE");
        expectError(await request(http).get(path).set(auth(ctx.tokens.manager)), 404, "NO_WORKER_PROFILE");
        const managersOwn = await request(http).get(path).set(auth(ctx.tokens.trackedManager)).expect(200);
        expect(managersOwn.body).toMatchObject({ yearMonth, approvedShifts: 0, netPayableAgorot: 0, pendingEntries: 0 });
        expect(JSON.stringify(managersOwn.body)).not.toContain(ctx.worker.workerProfile.id);
      }

      await calculatePayroll(app, ctx.tokens.owner, yearMonth);
      await request(http).post(`/api/v1/payroll-periods/${yearMonth}/finalize`).set(auth(ctx.tokens.owner)).expect(201);
      const finalized = await request(http).get("/api/v1/payroll-statements/me/current").set(auth(ctx.tokens.worker));
      expectError(finalized, 409, "PAYROLL_PERIOD_FINALIZED");
      // The month's statement is in /me.
      const statements = await request(http).get("/api/v1/payroll-statements/me").set(auth(ctx.tokens.worker)).expect(200);
      expect(statements.body.statements).toEqual([expect.objectContaining({ yearMonth, status: "FINALIZED", netPayableAgorot: expectedBase })]);
    });
  });

  // ── Emergency eligibility ─────────────────────────────────────────────────

  describe("GET /emergency-callouts/eligibility", () => {
    it("says whether the caller may start a call-out now and why not, with their Turan assignment and running call-out, creating nothing", async () => {
      const ctx = await setup();
      const eligibility = (token: string) => request(http).get("/api/v1/emergency-callouts/eligibility").set(auth(token)).expect(200);

      expect((await eligibility(ctx.tokens.worker)).body).toEqual({ eligible: false, reason: "EMERGENCY_NOT_ELIGIBLE", turanAssignment: null, activeCallout: null });
      expect((await eligibility(ctx.tokens.owner)).body).toEqual({ eligible: false, reason: "FORBIDDEN", turanAssignment: null, activeCallout: null });

      // A Night Turan later tonight: not yet, but shown.
      const later = await request(http)
        .post("/api/v1/turan-assignments")
        .set(auth(ctx.tokens.owner))
        .send({ turanType: TuranType.NIGHT_TURAN, startAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(), endAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString(), assignedWorkerProfileId: ctx.worker.workerProfile.id })
        .expect(201);
      expect((await eligibility(ctx.tokens.worker)).body).toMatchObject({ eligible: false, reason: "EMERGENCY_NOT_ELIGIBLE", turanAssignment: { id: later.body.id, turanType: "NIGHT_TURAN" } });

      // One covering now: eligible, and checking created nothing.
      const now = await request(http)
        .post("/api/v1/turan-assignments")
        .set(auth(ctx.tokens.owner))
        .send({
          turanType: TuranType.NIGHT_TURAN,
          startAt: new Date(Date.now() - 30 * 60_000).toISOString(),
          endAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
          assignedWorkerProfileId: ctx.worker.workerProfile.id,
          confirmOverlap: true,
        })
        .expect(201);
      expect((await eligibility(ctx.tokens.worker)).body).toEqual({
        eligible: true,
        reason: null,
        turanAssignment: expect.objectContaining({ id: now.body.id, status: "SCHEDULED", assignedWorkerProfileId: ctx.worker.workerProfile.id }),
        activeCallout: null,
      });
      expect(await prisma.timeEntry.count()).toBe(0);
      expect(await prisma.emergencyCallout.count()).toBe(0);

      // Running: the call-out is shown (the app shows its timer).
      const started = await request(http)
        .post("/api/v1/emergency-callouts/start")
        .set(auth(ctx.tokens.worker))
        .set("Idempotency-Key", uuidv7())
        .send({ deviceId: "worker-phone", clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), latitude: NEARBY_LAT, longitude: SITE_LNG, accuracyMeters: 10 })
        .expect(201);
      expect((await eligibility(ctx.tokens.worker)).body).toEqual({
        eligible: false,
        reason: "ACTIVE_TIME_ENTRY_EXISTS",
        turanAssignment: expect.objectContaining({ id: now.body.id }),
        activeCallout: {
          calloutId: started.body.calloutId,
          timeEntryId: started.body.timeEntryId,
          actualStartClick: started.body.actualStartClick,
          compensatedStart: started.body.compensatedStart,
        },
      });

      // An ordinary open clock-in also blocks a call-out, without a running call-out.
      await clockIn(ctx.tokens.otherWorker, ctx.shift.id, { deviceId: "other-phone" }).expect(201);
      expect((await eligibility(ctx.tokens.otherWorker)).body).toEqual({ eligible: false, reason: "ACTIVE_TIME_ENTRY_EXISTS", turanAssignment: null, activeCallout: null });
      // The `:id` route behind it is unaffected.
      await request(http).get(`/api/v1/emergency-callouts/${started.body.calloutId}`).set(auth(ctx.tokens.manager)).expect(200);
    });
  });

  // ── Notifications: preferences, read-all, push ───────────────────────────

  describe("notifications", () => {
    it("lists every type the caller's role can receive (push on by default), changes some, and refuses types the role never receives", async () => {
      const ctx = await setup();
      const workerTypes = ["SHIFT_APPROVED", "SHIFT_REJECTED", "WORKER_APPROVED", "TURAN_ASSIGNMENT_CREATED", "TURAN_ASSIGNMENT_CHANGED"];
      const initial = await request(http).get("/api/v1/notifications/preferences").set(auth(ctx.tokens.worker)).expect(200);
      expect(initial.body).toEqual({ preferences: workerTypes.map((type) => ({ type, push: true })) });

      const updated = await request(http)
        .patch("/api/v1/notifications/preferences")
        .set(auth(ctx.tokens.worker))
        .send({ preferences: [{ type: "SHIFT_APPROVED", push: false }] })
        .expect(200);
      expect(updated.body.preferences).toEqual(workerTypes.map((type) => ({ type, push: type !== "SHIFT_APPROVED" })));
      expect(await prisma.organizationMembership.findUniqueOrThrow({ where: { id: ctx.worker.membership.id } })).toMatchObject({
        notificationPreferences: { SHIFT_APPROVED: { push: false } },
      });
      // Left-out types keep their switch.
      await request(http).patch("/api/v1/notifications/preferences").set(auth(ctx.tokens.worker)).send({ preferences: [{ type: "TURAN_ASSIGNMENT_CHANGED", push: false }] }).expect(200);
      const both = await request(http).get("/api/v1/notifications/preferences").set(auth(ctx.tokens.worker)).expect(200);
      expect(both.body.preferences.filter((line: { push: boolean }) => !line.push).map((line: { type: string }) => line.type)).toEqual(["SHIFT_APPROVED", "TURAN_ASSIGNMENT_CHANGED"]);

      for (const body of [
        { preferences: [{ type: "WORKER_CLOCKED_IN", push: false }] },
        { preferences: [{ type: "SHIFT_APPROVED", push: false }, { type: "SHIFT_APPROVED", push: true }] },
        { preferences: [{ type: "NOT_A_TYPE", push: false }] },
        { preferences: [{ type: "SHIFT_APPROVED" }] },
        { preferences: "SHIFT_APPROVED" },
        {},
      ]) {
        expectError(await request(http).patch("/api/v1/notifications/preferences").set(auth(ctx.tokens.worker)).send(body), 400, "VALIDATION_FAILED");
      }
      const notReceived = await request(http).patch("/api/v1/notifications/preferences").set(auth(ctx.tokens.worker)).send({ preferences: [{ type: "WORKER_CLOCKED_IN", push: false }] });
      expect(notReceived.body.details).toEqual({ field: "preferences", type: "WORKER_CLOCKED_IN" });

      // Managers: the manager-facing types; a time-trackable one also the worker's.
      const manager = await request(http).get("/api/v1/notifications/preferences").set(auth(ctx.tokens.manager)).expect(200);
      expect(manager.body.preferences.map((line: { type: string }) => line.type)).toEqual([
        "WORKER_CLOCKED_IN",
        "WORKER_CLOCKED_OUT",
        "OVERTIME_THRESHOLD_CROSSED",
        "EMERGENCY_SHIFT_STARTED",
        "EMERGENCY_SHIFT_ENDED",
        "ONBOARDING_SUBMITTED",
        "OFFLINE_EVENT_REJECTED",
        "SUSPICIOUS_LOCATION_DETECTED",
        "TEMPORARY_SUPERVISOR_ISSUE_REPORTED",
      ]);
      const tracked = await request(http).get("/api/v1/notifications/preferences").set(auth(ctx.tokens.trackedManager)).expect(200);
      expect(tracked.body.preferences).toHaveLength(14);
      // Each member's switches are their own.
      expect((await request(http).get("/api/v1/notifications/preferences").set(auth(ctx.tokens.otherWorker)).expect(200)).body.preferences.every((line: { push: boolean }) => line.push)).toBe(true);
    });

    it("marks every unread notification of the caller as read", async () => {
      const ctx = await setup();
      await closedEntry(ctx);
      await closedEntry(ctx, "Second visit.");
      const unread = await prisma.notification.count({ where: { recipientUserId: ctx.manager.user.id, readAt: null } });
      expect(unread).toBe(4);
      const ownerUnread = await prisma.notification.count({ where: { recipientUserId: ctx.owner.user.id, readAt: null } });

      expect((await request(http).post("/api/v1/notifications/read-all").set(auth(ctx.tokens.manager)).expect(200)).body).toEqual({ updated: 4 });
      expect(await prisma.notification.count({ where: { recipientUserId: ctx.manager.user.id, readAt: null } })).toBe(0);
      expect(await prisma.notification.count({ where: { recipientUserId: ctx.owner.user.id, readAt: null } })).toBe(ownerUnread);
      expect((await request(http).post("/api/v1/notifications/read-all").set(auth(ctx.tokens.manager)).expect(200)).body).toEqual({ updated: 0 });
      // The `:id/read` route behind it is unaffected.
      const one = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: ctx.owner.user.id } });
      await request(http).patch(`/api/v1/notifications/${one.id}/read`).set(auth(ctx.tokens.owner)).expect(200);
    });

    it("push follows the member's switches (in-app always), goes to their devices with a push token, in Arabic, and carries ids only -- no money, no names", async () => {
      const ctx = await setup();
      const provider = app.get<PushProvider>(PUSH_PROVIDER);
      const send = jest.spyOn(provider, "send");
      const pushDelivery = (notificationId: string) =>
        waitFor(() => prisma.notificationDelivery.findFirst({ where: { notificationId, channel: provider.channel } }), `the push delivery of ${notificationId}`);
      const sentFor = (notificationId: string): PushMessage[] =>
        send.mock.calls.flatMap(([messages]) => [...messages]).filter((message) => message.data.notificationId === notificationId);

      try {
        await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.worker)).send({ deviceId: "worker-phone", platform: "ANDROID", pushToken: WORKER_PUSH_TOKEN }).expect(200);
        await request(http).put("/api/v1/devices/me").set(auth(ctx.tokens.owner)).send({ deviceId: "owner-phone", platform: "IOS", pushToken: OWNER_PUSH_TOKEN }).expect(200);
        // A revoked device gets nothing.
        await prisma.userDevice.create({
          data: { id: uuidv7(), userId: ctx.worker.user.id, clientDeviceId: "stolen-phone", platform: "ANDROID", pushToken: "ExponentPushToken[stolen]", revokedAt: new Date() },
        });
        await request(http).patch("/api/v1/notifications/preferences").set(auth(ctx.tokens.worker)).send({ preferences: [{ type: "SHIFT_APPROVED", push: false }] }).expect(200);

        // Switched off: the in-app notification exists, no push is sent.
        const entry = await closedEntry(ctx);
        await request(http).post(`/api/v1/time-entries/${entry.id}/approve`).set(auth(ctx.tokens.manager)).send({}).expect(201);
        const approvedNotice = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: ctx.worker.user.id, type: NotificationType.SHIFT_APPROVED } });
        expect(await pushDelivery(approvedNotice.id)).toMatchObject({ status: "SKIPPED", error: "PUSH_DISABLED" });
        expect(sentFor(approvedNotice.id)).toEqual([]);
        // The in-app list still has it.
        const inApp = await request(http).get("/api/v1/notifications").set(auth(ctx.tokens.worker)).expect(200);
        expect(inApp.body.map((n: { id: string }) => n.id)).toContain(approvedNotice.id);

        // Switched on (the default): one push per device with a token, Arabic text, ids only.
        const turan = await request(http)
          .post("/api/v1/turan-assignments")
          .set(auth(ctx.tokens.owner))
          .send({ turanType: TuranType.NIGHT_TURAN, startAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), endAt: new Date(Date.now() + 32 * 60 * 60_000).toISOString(), assignedWorkerProfileId: ctx.worker.workerProfile.id })
          .expect(201);
        const turanNotice = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: ctx.worker.user.id, type: NotificationType.TURAN_ASSIGNMENT_CREATED } });
        expect(await pushDelivery(turanNotice.id)).toMatchObject({ status: "DELIVERED", error: null, deliveredAt: expect.any(Date) });
        expect(sentFor(turanNotice.id)).toEqual([
          {
            to: WORKER_PUSH_TOKEN,
            title: "تم إنشاء تكليف مناوبة",
            body: "عرض التفاصيل",
            data: { notificationId: turanNotice.id, type: "TURAN_ASSIGNMENT_CREATED", turanAssignmentId: turan.body.id },
            sound: "default",
            channelId: "default",
          },
        ]);

        // The Owner's clock-out notification carries the cost in the app; its push carries neither the cost nor the worker.
        const ownerNotice = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: ctx.owner.user.id, type: NotificationType.WORKER_CLOCKED_OUT } });
        expect(Object.keys(ownerNotice.dataJson as object)).toEqual(expect.arrayContaining(["estimatedCostAgorot", "workerName", "workerProfileId"]));
        await pushDelivery(ownerNotice.id);
        const ownerPush = sentFor(ownerNotice.id);
        // Mobile manager mode: also the subject every manager's copy shares (the tap opens the entry to review).
        expect(ownerNotice.subjectId).toEqual(expect.any(String));
        expect(ownerPush).toEqual([
          expect.objectContaining({
            to: OWNER_PUSH_TOKEN,
            title: "أنهى عامل الدوام",
            data: { notificationId: ownerNotice.id, type: "WORKER_CLOCKED_OUT", timeEntryId: entry.id, shiftId: ctx.shift.id, subjectId: ownerNotice.subjectId },
          }),
        ]);

        // Nothing in any push is money, a person, or English text; no push token ever reaches the logs.
        const everything = JSON.stringify(send.mock.calls);
        expect(everything).not.toMatch(MONEY);
        for (const leaked of ["Eli Worker", "Rami Other", "Yossi Manager", "Dana Owner", ctx.worker.workerProfile.id, "Worker clocked out", "Test Shift", "ExponentPushToken[stolen]"]) {
          expect(everything).not.toContain(leaked);
        }
        expect(loggedText()).not.toContain(WORKER_PUSH_TOKEN);
        expect(loggedText()).not.toContain(OWNER_PUSH_TOKEN);

        // A member without a device with a push token: nothing sent, recorded as skipped.
        const managerNotice = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: ctx.manager.user.id } });
        expect(await pushDelivery(managerNotice.id)).toMatchObject({ status: "SKIPPED", error: "NO_PUSH_DEVICE" });
      } finally {
        send.mockRestore();
      }
    });
  });

  // ── Account states at sign-in ─────────────────────────────────────────────

  describe("account states at sign-in", () => {
    async function applicant(phoneNumber: string, organizationId: string, userStatus: AccountStatus, membershipStatus: AccountStatus) {
      const user = await prisma.user.create({ data: { id: uuidv7(), phoneNumber, fullLegalName: `Applicant ${phoneNumber}`, status: userStatus } });
      const membership = await prisma.organizationMembership.create({
        data: { id: uuidv7(), organizationId, userId: user.id, role: OrgRole.WORKER, isTimeTrackable: true, status: membershipStatus },
      });
      await prisma.workerProfile.create({ data: { id: uuidv7(), membershipId: membership.id, organizationId } });
      return { user, membership };
    }

    const verify = (phoneNumber: string, code: string) =>
      request(http).post("/api/v1/auth/otp/verify").send({ phoneNumber, code, deviceId: "state-phone", platform: "ANDROID" });

    it("tells the state only after a correct code; requesting a code and a wrong code look the same for every account", async () => {
      const { org } = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
      const pending = "+972541110001";
      const rejected = "+972541110002";
      const suspended = "+972541110003";
      const archived = "+972541110004";
      const active = "+972541110005";
      const unknown = "+972541110006";
      await applicant(pending, org.id, AccountStatus.PENDING_APPROVAL, AccountStatus.PENDING_APPROVAL);
      // A rejected applicant: only the membership is rejected, the user row stays PENDING_APPROVAL.
      await applicant(rejected, org.id, AccountStatus.PENDING_APPROVAL, AccountStatus.REJECTED);
      await applicant(suspended, org.id, AccountStatus.ACTIVE, AccountStatus.SUSPENDED);
      const archivedMember = await applicant(archived, org.id, AccountStatus.ACTIVE, AccountStatus.ARCHIVED);
      await prisma.organizationMembership.update({ where: { id: archivedMember.membership.id }, data: { archivedAt: new Date() } });
      await applicant(active, org.id, AccountStatus.ACTIVE, AccountStatus.ACTIVE);

      const phones = [pending, rejected, suspended, archived, active, unknown];
      // Requesting a code: the same answer for every number.
      for (const phoneNumber of phones) {
        const requested = await request(http).post("/api/v1/auth/otp/request").send({ phoneNumber });
        expect({ phoneNumber, status: requested.status, body: requested.body }).toEqual({ phoneNumber, status: 204, body: {} });
      }
      // A wrong code: the same answer for every number.
      for (const phoneNumber of phones) {
        const wrong = await verify(phoneNumber, "111111");
        expect({ phoneNumber, status: wrong.status, code: wrong.body.code, message: wrong.body.message }).toEqual({
          phoneNumber,
          status: 401,
          code: "OTP_INVALID_OR_EXPIRED",
          message: "Incorrect verification code.",
        });
      }
      // The correct code: now the state.
      const answers: Record<string, { status: number; code: string | undefined }> = {};
      for (const phoneNumber of phones) {
        const response = await verify(phoneNumber, "000000");
        answers[phoneNumber] = { status: response.status, code: response.body.code };
      }
      expect(answers).toEqual({
        [pending]: { status: 403, code: "ACCOUNT_PENDING_APPROVAL" },
        [rejected]: { status: 403, code: "ACCOUNT_REJECTED" },
        [suspended]: { status: 403, code: "ACCOUNT_SUSPENDED" },
        [archived]: { status: 403, code: "NO_ACTIVE_MEMBERSHIP" },
        [active]: { status: 201, code: undefined },
        [unknown]: { status: 404, code: "NOT_FOUND" },
      });
      // Only the active member got a session.
      expect(await prisma.refreshTokenFamily.count()).toBe(1);
    });
  });

  // ── Device key revocation ─────────────────────────────────────────────────

  describe("device key revocation", () => {
    it("events signed with a revoked key get DEVICE_KEY_REVOKED (a missing key keeps DEVICE_KEY_NOT_REGISTERED); only a session started after the revocation may register a new key", async () => {
      const ctx = await setup();
      const oldSession = await login(WORKER_PHONE, "stolen-phone");
      const firstKey = generateOfflineSigningKeyPair(testRandomBytes);
      await request(http).post("/api/v1/devices/public-key").set(auth(oldSession.accessToken)).send({ deviceId: "stolen-phone", publicKey: firstKey.publicKeyBase64 }).expect(201);
      // While the key is active the same session may rotate it (unchanged behavior).
      await request(http).post("/api/v1/devices/public-key").set(auth(oldSession.accessToken)).send({ deviceId: "stolen-phone", publicKey: firstKey.publicKeyBase64 }).expect(201);

      const event = (): OfflineEventSignablePayload => ({
        clientEventId: uuidv7(),
        eventType: "CLOCK_IN",
        shiftId: ctx.shift.id,
        deviceTimestamp: new Date(Date.now() - 60_000).toISOString(),
        latitude: NEARBY_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
      });
      const sync = async (token: string, deviceId: string, secretKeyBase64: string) => {
        const payload = event();
        const signature = signOfflineEvent(canonicalizeOfflineEvent(payload), secretKeyBase64);
        const response = await request(http).post("/api/v1/offline-sync/batches").set(auth(token)).set("Idempotency-Key", uuidv7()).send({ deviceId, events: [{ ...payload, signature }] }).expect(201);
        return response.body.results[0];
      };

      await request(http).post(`/api/v1/devices/${ctx.worker.user.id}/stolen-phone/revoke-key`).set(auth(ctx.tokens.owner)).expect(201);
      expect(await sync(oldSession.accessToken, "stolen-phone", firstKey.secretKeyBase64)).toMatchObject({ status: "REJECTED", reason: "DEVICE_KEY_REVOKED" });
      expect(await sync(oldSession.accessToken, "never-registered", firstKey.secretKeyBase64)).toMatchObject({ status: "REJECTED", reason: "DEVICE_KEY_NOT_REGISTERED" });
      expect(await prisma.offlineSyncEvent.findMany({ select: { rejectionReason: true }, orderBy: { processedAt: "asc" } })).toEqual([
        { rejectionReason: "DEVICE_KEY_REVOKED" },
        { rejectionReason: "DEVICE_KEY_NOT_REGISTERED" },
      ]);
      expect((await request(http).put("/api/v1/devices/me").set(auth(oldSession.accessToken)).send({ deviceId: "stolen-phone", platform: "ANDROID" }).expect(200)).body.keyStatus).toBe("REVOKED");

      // The session that existed at the revocation cannot put a key back, not even after a refresh.
      const secondKey = generateOfflineSigningKeyPair(testRandomBytes);
      expectError(
        await request(http).post("/api/v1/devices/public-key").set(auth(oldSession.accessToken)).send({ deviceId: "stolen-phone", publicKey: secondKey.publicKeyBase64 }),
        403,
        "DEVICE_KEY_REVOKED",
      );
      const refreshed = await request(http).post("/api/v1/auth/refresh").send({ refreshToken: oldSession.refreshToken }).expect(201);
      expectError(
        await request(http).post("/api/v1/devices/public-key").set(auth(refreshed.body.accessToken)).send({ deviceId: "stolen-phone", publicKey: secondKey.publicKeyBase64 }),
        403,
        "DEVICE_KEY_REVOKED",
      );
      expect(await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: ctx.worker.user.id, deviceId: "stolen-phone" } })).toMatchObject({
        publicKey: firstKey.publicKeyBase64,
        revokedAt: expect.any(Date),
      });

      // Signing in again (a new session) allows a new key; the old key's signatures stay refused.
      const fresh = await login(WORKER_PHONE, "stolen-phone");
      await request(http).post("/api/v1/devices/public-key").set(auth(fresh.accessToken)).send({ deviceId: "stolen-phone", publicKey: secondKey.publicKeyBase64 }).expect(201);
      expect(await sync(fresh.accessToken, "stolen-phone", firstKey.secretKeyBase64)).toMatchObject({ status: "REJECTED", reason: "INVALID_OFFLINE_SIGNATURE" });
      expect(await sync(fresh.accessToken, "stolen-phone", secondKey.secretKeyBase64)).toMatchObject({ status: "VERIFIED" });
      expect((await request(http).put("/api/v1/devices/me").set(auth(fresh.accessToken)).send({ deviceId: "stolen-phone", platform: "ANDROID" }).expect(200)).body.keyStatus).toBe("ACTIVE");
      const audit = await prisma.auditLog.findMany({ where: { action: "DEVICE_PUBLIC_KEY_REGISTERED" }, orderBy: { createdAt: "asc" } });
      expect(audit.at(-1)?.note).toMatch(/^Replaced the key revoked at /);
    });
  });

  // ── The worker's shift detail ─────────────────────────────────────────────

  describe("GET /shifts/:id for an assigned worker", () => {
    it("has the project name, the site with its instructions and position, the geofence, the manager's name, the check-in method and the points usable now -- and no budget", async () => {
      const ctx = await setup();
      const point = (name: string, extra: Record<string, unknown> = {}) =>
        prisma.temporaryCheckInPoint.create({
          data: {
            id: uuidv7(),
            organizationId: ctx.organizationId,
            shiftId: ctx.shift.id,
            name,
            latitude: SITE_LAT + 0.001,
            longitude: SITE_LNG,
            radiusMeters: 80,
            createdBy: ctx.manager.user.id,
            managerAuthorizedBy: ctx.manager.user.id,
            expiresAt: new Date(Date.now() + 60 * 60_000),
            ...extra,
          },
        });
      const open = await point("North gate");
      await point("Expired gate", { expiresAt: new Date(Date.now() - 60_000) });
      await point("Closed gate", { status: "REVOKED", revokedAt: new Date(), revokedBy: ctx.manager.user.id });

      const shift = await request(http).get(`/api/v1/shifts/${ctx.shift.id}`).set(auth(ctx.tokens.worker)).expect(200);
      expect(shift.body).toMatchObject({
        id: ctx.shift.id,
        title: "Test Shift",
        checkInMethod: "GEOFENCED",
        managerName: "Yossi Manager",
        project: { name: "Ayalon Interchange" },
        site: { name: "Ayalon North", instructions: "Enter through gate 3; vests required.", latitude: SITE_LAT, longitude: SITE_LNG },
        geofence: { centerLatitude: SITE_LAT, centerLongitude: SITE_LNG, radiusMeters: 100, minAccuracyMeters: 50 },
      });
      expect(shift.body.temporaryCheckInPoints).toEqual([
        expect.objectContaining({ id: open.id, name: "North gate", latitude: open.latitude, longitude: SITE_LNG, radiusMeters: 80, expiresAt: open.expiresAt.toISOString(), status: "ACTIVE" }),
      ]);
      expect(JSON.stringify(shift.body)).not.toMatch(MONEY);
      expect(shift.body.project.budgetAgorot).toBeUndefined();

      // Managers keep every point, and get the manager's name too; an Owner still sees the budget.
      const managerView = await request(http).get(`/api/v1/shifts/${ctx.shift.id}`).set(auth(ctx.tokens.manager)).expect(200);
      expect(managerView.body.temporaryCheckInPoints).toHaveLength(3);
      expect(managerView.body.managerName).toBe("Yossi Manager");
      expect((await request(http).get(`/api/v1/shifts/${ctx.shift.id}`).set(auth(ctx.tokens.owner)).expect(200)).body.project.budgetAgorot).toBe(99_000_000);
      // A worker who is not assigned: 404.
      await prisma.shiftAssignment.updateMany({ where: { shiftId: ctx.shift.id, workerProfileId: ctx.otherWorker.workerProfile.id }, data: { removedAt: new Date() } });
      await request(http).get(`/api/v1/shifts/${ctx.shift.id}`).set(auth(ctx.tokens.otherWorker)).expect(404);
    });
  });
});

// ── A deployment without a transcription provider ────────────────────────────

describe("TRANSCRIPTION_PROVIDER=none (Step 9)", () => {
  useEnv({ TRANSCRIPTION_PROVIDER: "none" });
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await removeStoredAttachments();
    await app.close();
  });

  it("answers 503 TRANSCRIPTION_UNAVAILABLE for the caller's own recording (the app asks for typed text); the upload itself works", async () => {
    await resetDatabase(app);
    const { org } = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    storedOrganizations.add(org.id);
    await addWorker(prisma, org.id, WORKER_PHONE, "Eli Worker");
    const token = (await loginAs(app, WORKER_PHONE)).accessToken;
    const uploaded = await request(app.getHttpServer())
      .post("/api/v1/attachments")
      .set("Authorization", `Bearer ${token}`)
      .field("purpose", "VOICE_SUMMARY")
      .attach("file", M4A, { filename: "summary.m4a", contentType: "audio/mp4" })
      .expect(201);
    const response = await request(app.getHttpServer()).post(`/api/v1/attachments/${uploaded.body.fileAssetId}/transcription`).set("Authorization", `Bearer ${token}`);
    expect({ status: response.status, code: response.body.code }).toEqual({ status: 503, code: "TRANSCRIPTION_UNAVAILABLE" });
    // Someone else's id is still a 404, not a 503.
    await request(app.getHttpServer()).post(`/api/v1/attachments/${uuidv7()}/transcription`).set("Authorization", `Bearer ${token}`).expect(404);
  });
});

// ── Dev login mode: the fixed code and the quick-login list ──────────────────

describe("account states with dev login on (Step 9)", () => {
  useEnv({ APP_ENV: "development", DEV_LOGIN_ENABLED: "true", OTP_PROVIDER: undefined });
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("a pending or rejected applicant gets the state with the fixed code 123456, and is never in the quick-login list", async () => {
    await resetDatabase(app);
    const http = app.getHttpServer();
    const { org } = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const states: [string, AccountStatus, string][] = [
      ["+972542220001", AccountStatus.PENDING_APPROVAL, "ACCOUNT_PENDING_APPROVAL"],
      ["+972542220002", AccountStatus.REJECTED, "ACCOUNT_REJECTED"],
    ];
    const membershipIds: string[] = [];
    for (const [phoneNumber, membershipStatus, code] of states) {
      const user = await prisma.user.create({ data: { id: uuidv7(), phoneNumber, fullLegalName: `Applicant ${phoneNumber}`, status: AccountStatus.PENDING_APPROVAL } });
      const membership = await prisma.organizationMembership.create({
        data: { id: uuidv7(), organizationId: org.id, userId: user.id, role: OrgRole.WORKER, isTimeTrackable: true, status: membershipStatus },
      });
      membershipIds.push(membership.id);
      await request(http).post("/api/v1/auth/otp/request").send({ phoneNumber }).expect(204);
      const response = await request(http).post("/api/v1/auth/otp/verify").send({ phoneNumber, code: "123456", deviceId: "dev-phone", platform: "ANDROID" });
      expect({ phoneNumber, status: response.status, code: response.body.code }).toEqual({ phoneNumber, status: 403, code });
    }

    const listed = await request(http).get("/api/v1/auth/dev/users").expect(200);
    const ids = listed.body.map((user: { membershipId: string }) => user.membershipId);
    expect(ids.length).toBeGreaterThan(0);
    for (const membershipId of membershipIds) expect(ids).not.toContain(membershipId);
  });
});
