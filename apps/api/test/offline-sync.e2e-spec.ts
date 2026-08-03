import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import {
  canonicalizeOfflineEvent,
  generateOfflineSigningKeyPair,
  signOfflineEvent,
  type OfflineEventSignablePayload,
} from "@fieldmaster/shared-validation";
import { createTestApp, resetDatabase, loginAs, request } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { createOrgWithOwner, addFieldManager, addWorker, createProject, createSiteWithGeofence, createStandardShift, assignWorkerToShift } from "./fixtures";

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
const NEARBY_LAT = 32.0858;
const NEARBY_LNG = 34.7818;
const DEVICE_ID = "offline-device-1";

const testRandomBytes = (n: number) => new Uint8Array(randomBytes(n));

describe("Offline attendance sync (e2e, spec section 20)", () => {
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

  async function setupShift() {
    const { org, user: ownerUser } = await createOrgWithOwner(prisma, "+972500000001");
    const fm = await addFieldManager(prisma, org.id, "+972500000011", "FM One");
    const worker = await addWorker(prisma, org.id, "+972500010001", "Worker One", {
      type: "HOURLY",
      hourlyRateAgorot: 5000,
      overtimeRateAgorot: 7000,
    });
    const project = await createProject(prisma, org.id);
    const { site, geofence } = await createSiteWithGeofence(prisma, org.id, project.id, SITE_LAT, SITE_LNG, 100);
    const start = new Date();
    start.setHours(start.getHours() - 12);
    const end = new Date();
    end.setHours(end.getHours() + 12);
    const shift = await createStandardShift(prisma, org.id, project.id, site.id, geofence.id, fm.user.id, start, end, "GEOFENCED");
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, fm.user.id);
    return { org, ownerUser, fm, worker, project, site, geofence, shift };
  }

  function signEvent(payload: OfflineEventSignablePayload, secretKeyBase64: string): string {
    return signOfflineEvent(canonicalizeOfflineEvent(payload), secretKeyBase64);
  }

  it("registers a device key, signs offline clock-in/out events, and syncs them using the device timestamp as the authoritative time (scenario 10)", async () => {
    const { shift, worker } = await setupShift();
    const session = await loginAs(app, "+972500010001", DEVICE_ID);
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);

    await request(app.getHttpServer())
      .post("/api/v1/devices/public-key")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ deviceId: DEVICE_ID, publicKey: keyPair.publicKeyBase64 })
      .expect(201);

    // Worker "went offline" 8 hours ago, clocked in, worked, clocked out 30
    // minutes ago -- all captured on-device, none of it synced until now.
    const offlineClockInAt = new Date(Date.now() - 8 * 3_600_000);
    const offlineClockOutAt = new Date(Date.now() - 30 * 60_000);

    const clockInPayload: OfflineEventSignablePayload = {
      clientEventId: "offline-evt-1",
      eventType: "CLOCK_IN",
      shiftId: shift.id,
      deviceTimestamp: offlineClockInAt.toISOString(),
      latitude: NEARBY_LAT,
      longitude: NEARBY_LNG,
      accuracyMeters: 12,
      mockLocationSuspected: false,
    };
    const clockOutPayload: OfflineEventSignablePayload = {
      clientEventId: "offline-evt-2",
      eventType: "CLOCK_OUT",
      deviceTimestamp: offlineClockOutAt.toISOString(),
      latitude: NEARBY_LAT,
      longitude: NEARBY_LNG,
      accuracyMeters: 12,
      mockLocationSuspected: false,
      summaryText: "Repaired a damaged traffic sign while offline.",
      taskCategory: "TRAFFIC_SIGN",
      followUpRequired: false,
    };

    const response = await request(app.getHttpServer())
      .post("/api/v1/offline-sync/batches")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "offline-batch-1")
      .send({
        deviceId: DEVICE_ID,
        // Deliberately submitted out of order -- the server must sort by
        // deviceTimestamp before processing (spec 20.3).
        events: [
          { ...clockOutPayload, signature: signEvent(clockOutPayload, keyPair.secretKeyBase64) },
          { ...clockInPayload, signature: signEvent(clockInPayload, keyPair.secretKeyBase64) },
        ],
      })
      .expect(201);

    expect(response.body.results).toHaveLength(2);
    const clockInResult = response.body.results.find((r: { clientEventId: string }) => r.clientEventId === "offline-evt-1");
    const clockOutResult = response.body.results.find((r: { clientEventId: string }) => r.clientEventId === "offline-evt-2");
    expect(["VERIFIED", "FLAGGED"]).toContain(clockInResult.status);
    expect(["VERIFIED", "FLAGGED"]).toContain(clockOutResult.status);

    const timeEntry = await prisma.timeEntry.findFirstOrThrow({ where: { workerProfileId: worker.workerProfile.id } });
    expect(timeEntry.status).toBe(TimeEntryStatus.PENDING_APPROVAL);
    // The recorded clock-in/out must equal the *device* timestamps (rounded
    // to the second Prisma stores), not "now" (when this test's sync
    // request happened to run) -- proving offline events use deviceTimestamp
    // as the authoritative business time, not serverReceivedAt.
    expect(Math.abs(timeEntry.clockInAt!.getTime() - offlineClockInAt.getTime())).toBeLessThan(1000);
    expect(Math.abs(timeEntry.clockOutAt!.getTime() - offlineClockOutAt.getTime())).toBeLessThan(1000);
    expect(timeEntry.rawDurationMinutes).toBe(Math.round((offlineClockOutAt.getTime() - offlineClockInAt.getTime()) / 60_000));

    const clockEvents = await prisma.clockEvent.findMany({ where: { timeEntryId: timeEntry.id } });
    expect(clockEvents.every((e) => e.origin === "OFFLINE")).toBe(true);

    const batch = await prisma.offlineSyncBatch.findFirstOrThrow({ where: { deviceId: DEVICE_ID } });
    expect(batch.eventCount).toBe(2);
  });

  it("rejects an offline event with an invalid signature without creating any attendance record", async () => {
    const { shift } = await setupShift();
    const session = await loginAs(app, "+972500010001", DEVICE_ID);
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    const attackerKeyPair = generateOfflineSigningKeyPair(testRandomBytes);

    await request(app.getHttpServer())
      .post("/api/v1/devices/public-key")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ deviceId: DEVICE_ID, publicKey: keyPair.publicKeyBase64 })
      .expect(201);

    const payload: OfflineEventSignablePayload = {
      clientEventId: "forged-evt",
      eventType: "CLOCK_IN",
      shiftId: shift.id,
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: NEARBY_LNG,
      accuracyMeters: 12,
    };
    // Signed with the wrong key -- simulates a forged/tampered event.
    const badSignature = signEvent(payload, attackerKeyPair.secretKeyBase64);

    const response = await request(app.getHttpServer())
      .post("/api/v1/offline-sync/batches")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "offline-batch-forged")
      .send({ deviceId: DEVICE_ID, events: [{ ...payload, signature: badSignature }] })
      .expect(201);

    expect(response.body.results[0].status).toBe("REJECTED");
    expect(response.body.results[0].reason).toBe("INVALID_OFFLINE_SIGNATURE");

    const timeEntryCount = await prisma.timeEntry.count();
    expect(timeEntryCount).toBe(0);
  });

  it("rejects offline events from a device with no registered public key", async () => {
    const { shift } = await setupShift();
    const session = await loginAs(app, "+972500010001", DEVICE_ID);
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);

    const payload: OfflineEventSignablePayload = {
      clientEventId: "unregistered-evt",
      eventType: "CLOCK_IN",
      shiftId: shift.id,
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: NEARBY_LNG,
      accuracyMeters: 12,
    };

    const response = await request(app.getHttpServer())
      .post("/api/v1/offline-sync/batches")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "offline-batch-unregistered")
      .send({ deviceId: "never-registered-device", events: [{ ...payload, signature: signEvent(payload, keyPair.secretKeyBase64) }] })
      .expect(201);

    expect(response.body.results[0].status).toBe("REJECTED");
    expect(response.body.results[0].reason).toBe("DEVICE_KEY_NOT_REGISTERED");
  });

  it("marks a resubmitted event as DUPLICATE instead of double-processing it", async () => {
    const { shift } = await setupShift();
    const session = await loginAs(app, "+972500010001", DEVICE_ID);
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);

    await request(app.getHttpServer())
      .post("/api/v1/devices/public-key")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ deviceId: DEVICE_ID, publicKey: keyPair.publicKeyBase64 })
      .expect(201);

    const payload: OfflineEventSignablePayload = {
      clientEventId: "resubmitted-evt",
      eventType: "CLOCK_IN",
      shiftId: shift.id,
      deviceTimestamp: new Date(Date.now() - 3_600_000).toISOString(),
      latitude: NEARBY_LAT,
      longitude: NEARBY_LNG,
      accuracyMeters: 12,
    };
    const signature = signEvent(payload, keyPair.secretKeyBase64);

    await request(app.getHttpServer())
      .post("/api/v1/offline-sync/batches")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "offline-batch-first")
      .send({ deviceId: DEVICE_ID, events: [{ ...payload, signature }] })
      .expect(201);

    // A different Idempotency-Key (simulating a fresh retry after the first
    // response was lost on the network) but the *same* clientEventId.
    const secondResponse = await request(app.getHttpServer())
      .post("/api/v1/offline-sync/batches")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "offline-batch-retry")
      .send({ deviceId: DEVICE_ID, events: [{ ...payload, signature }] })
      .expect(201);

    expect(secondResponse.body.results[0].status).toBe("DUPLICATE");
    const timeEntryCount = await prisma.timeEntry.count();
    expect(timeEntryCount).toBe(1);
  });

  it("blocks an Owner-revoked device key from signing future events", async () => {
    const { shift } = await setupShift();
    const session = await loginAs(app, "+972500010001", DEVICE_ID);
    const ownerSession = await loginAs(app, "+972500000001");
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);

    const registerResponse = await request(app.getHttpServer())
      .post("/api/v1/devices/public-key")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ deviceId: DEVICE_ID, publicKey: keyPair.publicKeyBase64 })
      .expect(201);
    void registerResponse;

    const worker = await prisma.user.findFirstOrThrow({ where: { phoneNumber: "+972500010001" } });
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${worker.id}/${DEVICE_ID}/revoke-key`)
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .expect(201);

    const payload: OfflineEventSignablePayload = {
      clientEventId: "post-revoke-evt",
      eventType: "CLOCK_IN",
      shiftId: shift.id,
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: NEARBY_LNG,
      accuracyMeters: 12,
    };

    const response = await request(app.getHttpServer())
      .post("/api/v1/offline-sync/batches")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Idempotency-Key", "offline-batch-revoked")
      .send({ deviceId: DEVICE_ID, events: [{ ...payload, signature: signEvent(payload, keyPair.secretKeyBase64) }] })
      .expect(201);

    expect(response.body.results[0].status).toBe("REJECTED");
    expect(response.body.results[0].reason).toBe("DEVICE_KEY_NOT_REGISTERED");
  });
});
