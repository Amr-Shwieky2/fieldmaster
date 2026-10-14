import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { FieldMasterClient, OfflineSyncBatchResponse } from "@fieldmaster/api-client";
import { base64ToBytes, bytesToBase64, canonicalizeOfflineEvent, verifyOfflineEventSignature, type OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import { getOrCreateDeviceKeyPair } from "../device-key";
import {
  NOTICE_STORAGE_KEY,
  QUARANTINE_STORAGE_KEY,
  QUEUE_STORAGE_KEY,
  QueueStorageUnavailableError,
  clearQueueAfterKeyRevocation,
  dismissQueueNotice,
  enqueueEvent,
  flushQueue,
  getPendingCount,
  getQueue,
  getQueueStatus,
  type QueuedEvent,
} from "../offline-queue";
import { decodeQueueKey, generateQueueKey } from "../queue-crypto";
import { SECURE_KEYS } from "../secure-storage";

const DEVICE_ID = "mobile-test-device";

function payload(overrides: Partial<OfflineEventSignablePayload> = {}): OfflineEventSignablePayload {
  return {
    clientEventId: `evt-${Math.random().toString(36).slice(2, 10)}`,
    eventType: "CLOCK_OUT",
    shiftId: "shift-1",
    deviceTimestamp: "2026-01-15T15:45:00.000Z",
    latitude: 32.0853,
    longitude: 34.7818,
    accuracyMeters: 7.5,
    summaryText: "ركّبنا إشارتين جديدتين",
    ...overrides,
  };
}

/** A queue saved by the app before it was encrypted (a plain JSON array in AsyncStorage). */
function legacyEvent(overrides: Partial<QueuedEvent> = {}): QueuedEvent {
  return { ...payload(), signature: "c2lnbmF0dXJl", localStatus: "PENDING", queuedAt: "2026-01-15T15:45:01.000Z", ...overrides };
}

const storedRaw = () => AsyncStorage.getItem(QUEUE_STORAGE_KEY);
const storedEnvelope = async () => JSON.parse((await storedRaw()) as string) as { v: number; nonce: string; box: string };

function client(submit: (input: { deviceId: string; events: Record<string, unknown>[] }) => Promise<OfflineSyncBatchResponse>) {
  return { submitOfflineSyncBatch: jest.fn(submit) } as unknown as FieldMasterClient & { submitOfflineSyncBatch: jest.Mock };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("offline queue: encrypted at rest", () => {
  it("stores only a sealed envelope in AsyncStorage, with its key in the Keychain / Keystore", async () => {
    const event = await enqueueEvent(payload({ clientEventId: "evt-secret" }));

    const raw = (await storedRaw()) as string;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["box", "nonce", "v"]);
    for (const plain of ["evt-secret", "ركّبنا", "32.0853", "PENDING", event.signature]) expect(raw).not.toContain(plain);

    // The key is in SecureStore (32 random bytes), never in AsyncStorage.
    const key = await SecureStore.getItemAsync(SECURE_KEYS.offlineQueueKey);
    expect(key).not.toBeNull();
    expect(decodeQueueKey(key as string)).toHaveLength(32);
    expect(jest.mocked(AsyncStorage.setItem).mock.calls.map(([name]) => name)).not.toContain(SECURE_KEYS.offlineQueueKey);

    // ...and it reads back exactly.
    expect(await getQueue()).toEqual([event]);
    expect(await getPendingCount()).toBe(1);
  });

  it("writes a new nonce every time the queue changes", async () => {
    await enqueueEvent(payload());
    const first = await storedEnvelope();
    await enqueueEvent(payload());
    const second = await storedEnvelope();
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.box).not.toBe(first.box);
    expect(await getQueue()).toHaveLength(2);
  });

  it("still signs every event with the device key (the server checks the signature, whatever the storage)", async () => {
    const event = await enqueueEvent(payload());
    const { signature, localStatus: _l, queuedAt: _q, reason: _r, ...signed } = event;
    const keyPair = await getOrCreateDeviceKeyPair();
    expect(verifyOfflineEventSignature(canonicalizeOfflineEvent(signed), signature, keyPair.publicKeyBase64)).toBe(true);
  });

  it("migrates a plaintext queue from before: every waiting event is kept, now encrypted", async () => {
    const waiting = legacyEvent({ clientEventId: "old-pending" });
    const done = legacyEvent({ clientEventId: "old-done", localStatus: "VERIFIED" });
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify([waiting, done]));

    expect(await getQueue()).toEqual([waiting, done]);
    expect(await getPendingCount()).toBe(1);

    const raw = (await storedRaw()) as string;
    expect(raw).not.toContain("old-pending");
    expect((await storedEnvelope()).v).toBe(1);
    expect(await SecureStore.getItemAsync(SECURE_KEYS.offlineQueueKey)).not.toBeNull();
    // Nothing to tell the worker: nothing was lost.
    expect((await getQueueStatus()).notice).toBeNull();
  });

  it("detects a tampered queue: keeps the bytes aside, reports it, and never crashes or drops them silently", async () => {
    await enqueueEvent(payload({ clientEventId: "evt-a" }));
    const envelope = await storedEnvelope();
    const box = base64ToBytes(envelope.box);
    box[24] ^= 0x01;
    const changed = JSON.stringify({ ...envelope, box: bytesToBase64(box) });
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, changed);

    const status = await getQueueStatus();
    expect(status.events).toEqual([]);
    expect(status.notice).toEqual({ kind: "UNREADABLE", count: null, at: expect.any(String) });
    // The unreadable bytes are kept exactly as found, not deleted.
    expect(await AsyncStorage.getItem(QUARANTINE_STORAGE_KEY)).toBe(changed);

    // The app goes on: a new event is saved in a new queue.
    const next = await enqueueEvent(payload({ clientEventId: "evt-b" }));
    expect(await getQueue()).toEqual([next]);
  });

  it("treats a queue sealed with another key the same way (unreadable, kept aside)", async () => {
    await enqueueEvent(payload());
    const raw = await storedRaw();
    await SecureStore.setItemAsync(SECURE_KEYS.offlineQueueKey, generateQueueKey((n) => globalThis.crypto.getRandomValues(new Uint8Array(n))));

    expect(await getQueue()).toEqual([]);
    expect((await getQueueStatus()).notice?.kind).toBe("UNREADABLE");
    expect(await AsyncStorage.getItem(QUARANTINE_STORAGE_KEY)).toBe(raw);
  });

  it("reports a lost key (e.g. a backup restored without the Keystore): the unreadable records are removed and the worker is told", async () => {
    await enqueueEvent(payload());
    await SecureStore.deleteItemAsync(SECURE_KEYS.offlineQueueKey);

    const status = await getQueueStatus();
    expect(status.events).toEqual([]);
    expect(status.notice).toEqual({ kind: "KEY_LOST", count: null, at: expect.any(String) });
    expect(await storedRaw()).toBeNull();

    // A new key and a new queue from here on.
    const next = await enqueueEvent(payload());
    expect(await getQueue()).toEqual([next]);

    await dismissQueueNotice();
    expect((await getQueueStatus()).notice).toBeNull();
  });

  it("changes nothing while the Keychain / Keystore cannot be read (e.g. the phone is locked), and says so", async () => {
    const event = await enqueueEvent(payload());
    const raw = await storedRaw();
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("User interaction is not allowed."));

    await expect(getQueue()).rejects.toBeInstanceOf(QueueStorageUnavailableError);
    expect(await storedRaw()).toBe(raw);
    expect(await AsyncStorage.getItem(QUARANTINE_STORAGE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(NOTICE_STORAGE_KEY)).toBeNull();
    // Readable again later: nothing was lost.
    expect(await getQueue()).toEqual([event]);
  });
});

describe("offline queue: sync", () => {
  it("submits the waiting events as one batch and records each verdict", async () => {
    const a = await enqueueEvent(payload({ clientEventId: "evt-a", eventType: "CLOCK_IN" }));
    const b = await enqueueEvent(payload({ clientEventId: "evt-b" }));
    const api = client(async () => ({
      batchId: "batch-1",
      results: [
        { clientEventId: "evt-a", status: "VERIFIED" },
        { clientEventId: "evt-b", status: "REJECTED", reason: "NO_ACTIVE_TIME_ENTRY" },
      ],
    }));

    expect(await flushQueue(api, DEVICE_ID)).toEqual({ attempted: 2, synced: 2, stillPending: 0, keyRevoked: false });
    const sent = api.submitOfflineSyncBatch.mock.calls[0][0] as { deviceId: string; events: Record<string, unknown>[] };
    expect(sent.deviceId).toBe(DEVICE_ID);
    // Exactly the signed payloads: no local bookkeeping fields.
    expect(sent.events).toEqual([a, b].map(({ localStatus: _l, queuedAt: _q, reason: _r, ...rest }) => rest));
    expect((await getQueue()).map((e) => [e.clientEventId, e.localStatus, e.reason])).toEqual([
      ["evt-a", "VERIFIED", undefined],
      ["evt-b", "REJECTED", "NO_ACTIVE_TIME_ENTRY"],
    ]);
  });

  it("keeps an event saved while a batch is in flight (it waits for the next sync)", async () => {
    await enqueueEvent(payload({ clientEventId: "evt-a" }));
    const answer = deferred<OfflineSyncBatchResponse>();
    const api = client(() => answer.promise);

    const flushing = flushQueue(api, DEVICE_ID);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.submitOfflineSyncBatch).toHaveBeenCalledTimes(1);
    await enqueueEvent(payload({ clientEventId: "evt-late" }));
    answer.resolve({ batchId: "batch-1", results: [{ clientEventId: "evt-a", status: "VERIFIED" }] });
    await flushing;

    const queue = await getQueue();
    expect(queue.map((e) => [e.clientEventId, e.localStatus])).toEqual([
      ["evt-late", "PENDING"],
      ["evt-a", "VERIFIED"],
    ]);
  });

  it("puts everything back to waiting when the server cannot be reached", async () => {
    await enqueueEvent(payload({ clientEventId: "evt-a" }));
    const api = client(async () => {
      throw new TypeError("Network request failed");
    });

    expect(await flushQueue(api, DEVICE_ID)).toEqual({ attempted: 1, synced: 0, stillPending: 1, keyRevoked: false });
    expect((await getQueue())[0].localStatus).toBe("PENDING");
    expect(await getPendingCount()).toBe(1);
  });

  it("sends again an event left 'syncing' by an app that was closed mid-sync, and one the server did not answer for", async () => {
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify([legacyEvent({ clientEventId: "stuck", localStatus: "SYNCING" }), legacyEvent({ clientEventId: "silent" })]));
    const api = client(async () => ({ batchId: "batch-1", results: [{ clientEventId: "stuck", status: "DUPLICATE" }] }));

    expect(await flushQueue(api, DEVICE_ID)).toEqual({ attempted: 2, synced: 1, stillPending: 1, keyRevoked: false });
    expect((await getQueue()).map((e) => [e.clientEventId, e.localStatus])).toEqual([
      ["silent", "PENDING"],
      ["stuck", "DUPLICATE"],
    ]);
  });

  it("says when the server refused events because an Owner revoked this device's key", async () => {
    await enqueueEvent(payload({ clientEventId: "evt-a" }));
    const api = client(async () => ({ batchId: "batch-1", results: [{ clientEventId: "evt-a", status: "REJECTED", reason: "DEVICE_KEY_REVOKED" }] }));
    expect((await flushQueue(api, DEVICE_ID)).keyRevoked).toBe(true);
  });

  it("does nothing without waiting events", async () => {
    const api = client(async () => ({ batchId: "batch-1", results: [] }));
    expect(await flushQueue(api, DEVICE_ID)).toEqual({ attempted: 0, synced: 0, stillPending: 0, keyRevoked: false });
    expect(api.submitOfflineSyncBatch).not.toHaveBeenCalled();
  });
});

describe("offline queue: device key revoked", () => {
  it("clears the queue and tells the worker how many records could no longer be sent", async () => {
    await enqueueEvent(payload({ clientEventId: "evt-a" }));
    await enqueueEvent(payload({ clientEventId: "evt-b" }));
    const api = client(async () => ({
      batchId: "batch-1",
      results: [
        { clientEventId: "evt-a", status: "REJECTED", reason: "DEVICE_KEY_REVOKED" },
        { clientEventId: "evt-b", status: "REJECTED", reason: "DEVICE_KEY_REVOKED" },
      ],
    }));
    await flushQueue(api, DEVICE_ID);
    await enqueueEvent(payload({ clientEventId: "evt-c" }));

    expect(await clearQueueAfterKeyRevocation()).toBe(3);
    const status = await getQueueStatus();
    expect(status.events).toEqual([]);
    expect(status.notice).toEqual({ kind: "DEVICE_KEY_REVOKED", count: 3, at: expect.any(String) });
    expect(await storedRaw()).toBeNull();
  });
});
