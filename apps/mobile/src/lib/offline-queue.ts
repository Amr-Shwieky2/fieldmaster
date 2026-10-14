import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { canonicalizeOfflineEvent, signOfflineEvent, type OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import type { FieldMasterClient, OfflineSyncEventResult } from "@fieldmaster/api-client";
import { getOrCreateDeviceKeyPair } from "./device-key";
import { decodeQueueKey, generateQueueKey, isQueueEnvelope, openJson, sealJson } from "./queue-crypto";
import { getSecureItem, SECURE_KEYS, setSecureItem } from "./secure-storage";

/** AsyncStorage: the sealed queue (see queue-crypto.ts); a plain JSON array before Step 9. */
export const QUEUE_STORAGE_KEY = "fieldmaster.offlineQueue";
/** AsyncStorage: a queue that could not be opened (changed, or another key), kept as found instead of being deleted. */
export const QUARANTINE_STORAGE_KEY = "fieldmaster.offlineQueue.unreadable";
/** AsyncStorage: what the worker must be told about the queue (no event data in it). */
export const NOTICE_STORAGE_KEY = "fieldmaster.offlineQueue.notice";

const MAX_HISTORY = 100;

export type QueuedEventLocalStatus = "PENDING" | "SYNCING" | "VERIFIED" | "FLAGGED" | "REJECTED" | "DUPLICATE";

export interface QueuedEvent extends OfflineEventSignablePayload {
  signature: string;
  localStatus: QueuedEventLocalStatus;
  reason?: string;
  queuedAt: string;
}

/**
 * Something happened to records saved on the phone that the worker must hear
 * about (shown on the sync screen until dismissed):
 * - UNREADABLE: the stored queue could not be opened (changed, or sealed
 *   with another key). It is kept aside, not deleted, and a new queue starts.
 * - KEY_LOST: the queue's key is gone (e.g. Android restored the app's files
 *   from a backup, but never Keystore keys), so the saved records can never
 *   be read again; they are removed.
 * - DEVICE_KEY_REVOKED: an Owner revoked this phone's key; the records still
 *   waiting (`count`) could no longer be accepted and were removed.
 */
export type QueueNoticeKind = "UNREADABLE" | "KEY_LOST" | "DEVICE_KEY_REVOKED";

export interface QueueNotice {
  kind: QueueNoticeKind;
  /** Records that were waiting to be sent, when known. */
  count: number | null;
  at: string;
}

/** The Keychain / Keystore could not be read right now (e.g. the phone is locked): nothing was changed, try again later. */
export class QueueStorageUnavailableError extends Error {
  constructor(public readonly cause: unknown) {
    super("The secure storage holding the offline queue key is not available right now.");
    this.name = "QueueStorageUnavailableError";
  }
}

export interface QueueStatus {
  events: QueuedEvent[];
  notice: QueueNotice | null;
}

/**
 * The mobile side of spec section 20: clock events captured while offline
 * are signed on-device and held here, encrypted at rest (queue-crypto.ts),
 * until connectivity returns. `flushQueue` then submits them as a single
 * signed batch to `POST /offline-sync/batches` and records the server's
 * per-event verdict against each queued entry, so the worker sees a real
 * synchronization receipt rather than a fire-and-forget queue.
 *
 * Every read-modify-write runs under one lock, and a sync re-reads the queue
 * after the network call, so an event saved while a batch is in flight is
 * never lost.
 */

// ── Lock ─────────────────────────────────────────────────────────────────────

let lockTail: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lockTail.then(task, task);
  lockTail = run.catch(() => undefined);
  return run;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const randomBytes = (length: number) => Crypto.getRandomBytes(length);

async function readSecureKey(): Promise<string | null> {
  try {
    return await getSecureItem(SECURE_KEYS.offlineQueueKey);
  } catch (error) {
    throw new QueueStorageUnavailableError(error);
  }
}

async function getOrCreateQueueKey(): Promise<Uint8Array> {
  const stored = await readSecureKey();
  const key = stored ? decodeQueueKey(stored) : null;
  if (key) return key;
  const created = generateQueueKey(randomBytes);
  try {
    await setSecureItem(SECURE_KEYS.offlineQueueKey, created);
  } catch (error) {
    throw new QueueStorageUnavailableError(error);
  }
  return decodeQueueKey(created) as Uint8Array;
}

function isQueuedEvent(value: unknown): value is QueuedEvent {
  const event = value as Partial<QueuedEvent> | null;
  return (
    typeof event === "object" &&
    event !== null &&
    typeof event.clientEventId === "string" &&
    typeof event.eventType === "string" &&
    typeof event.signature === "string" &&
    typeof event.localStatus === "string" &&
    typeof event.deviceTimestamp === "string"
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function setNotice(kind: QueueNoticeKind, count: number | null): Promise<void> {
  const notice: QueueNotice = { kind, count, at: new Date().toISOString() };
  await AsyncStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(notice));
}

/** Keeps the unreadable bytes aside (never deleted) and starts an empty queue. */
async function quarantine(raw: string): Promise<void> {
  await AsyncStorage.setItem(QUARANTINE_STORAGE_KEY, raw);
  await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
  await setNotice("UNREADABLE", null);
}

async function writeUnlocked(events: QueuedEvent[]): Promise<void> {
  // Keep the most recent MAX_HISTORY resolved entries so a worker who never
  // opens the app can't grow this unboundedly; waiting events are never
  // trimmed regardless of age.
  const waiting = events.filter(isWaiting);
  const resolved = events.filter((e) => !isWaiting(e)).slice(-MAX_HISTORY);
  const key = await getOrCreateQueueKey();
  const envelope = sealJson([...waiting, ...resolved], key, randomBytes);
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(envelope));
}

/**
 * Reads the queue. Never throws for bad data (only QueueStorageUnavailableError
 * when the Keychain / Keystore itself fails, in which case nothing is changed):
 * - nothing stored: empty;
 * - a plain JSON array (the queue before it was encrypted): kept, every
 *   waiting event included, and encrypted now;
 * - an envelope that opens: its events;
 * - an envelope whose key is gone: the events are unrecoverable, removed and
 *   reported (KEY_LOST);
 * - anything that does not open (changed, another key, not an envelope):
 *   kept aside and reported (UNREADABLE), and a new queue starts.
 */
async function readUnlocked(): Promise<QueuedEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
  if (raw === null) return [];
  const parsed = parseJson(raw);

  if (Array.isArray(parsed)) {
    const events = parsed.filter(isQueuedEvent);
    await writeUnlocked(events);
    return events;
  }
  if (!isQueueEnvelope(parsed)) {
    await quarantine(raw);
    return [];
  }

  const stored = await readSecureKey();
  if (stored === null) {
    await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    await setNotice("KEY_LOST", null);
    return [];
  }
  const key = decodeQueueKey(stored);
  try {
    if (!key) throw new Error("Malformed key.");
    const value = openJson(parsed, key);
    if (!Array.isArray(value)) throw new Error("Not a list.");
    return value.filter(isQueuedEvent);
  } catch {
    await quarantine(raw);
    return [];
  }
}

const isWaiting = (event: QueuedEvent) => event.localStatus === "PENDING" || event.localStatus === "SYNCING";

// ── Public API ───────────────────────────────────────────────────────────────

export async function getQueue(): Promise<QueuedEvent[]> {
  return withQueueLock(readUnlocked);
}

export async function getPendingCount(): Promise<number> {
  const queue = await getQueue();
  return queue.filter((e) => e.localStatus === "PENDING").length;
}

/** The queue and the notice the worker has not dismissed yet. */
export async function getQueueStatus(): Promise<QueueStatus> {
  return withQueueLock(async () => {
    const events = await readUnlocked();
    return { events, notice: await readNotice() };
  });
}

async function readNotice(): Promise<QueueNotice | null> {
  const raw = await AsyncStorage.getItem(NOTICE_STORAGE_KEY);
  if (!raw) return null;
  const parsed = parseJson(raw) as Partial<QueueNotice> | undefined;
  if (!parsed || (parsed.kind !== "UNREADABLE" && parsed.kind !== "KEY_LOST" && parsed.kind !== "DEVICE_KEY_REVOKED")) return null;
  return { kind: parsed.kind, count: typeof parsed.count === "number" ? parsed.count : null, at: typeof parsed.at === "string" ? parsed.at : "" };
}

/** The worker read the notice. */
export async function dismissQueueNotice(): Promise<void> {
  await AsyncStorage.removeItem(NOTICE_STORAGE_KEY);
}

/** Signs and appends an event to the local queue. Never touches the network. */
export async function enqueueEvent(payload: OfflineEventSignablePayload): Promise<QueuedEvent> {
  const keyPair = await getOrCreateDeviceKeyPair();
  const canonical = canonicalizeOfflineEvent(payload);
  const signature = signOfflineEvent(canonical, keyPair.secretKeyBase64);
  const queued: QueuedEvent = { ...payload, signature, localStatus: "PENDING", queuedAt: new Date().toISOString() };

  await withQueueLock(async () => {
    const queue = await readUnlocked();
    queue.push(queued);
    await writeUnlocked(queue);
  });
  return queued;
}

export interface FlushResult {
  attempted: number;
  synced: number;
  stillPending: number;
  /** The server refused at least one event because an Owner revoked this device's key. */
  keyRevoked: boolean;
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Submits every waiting queued event as one batch. Safe to call whenever (a
 * no-op if the queue is empty) and concurrently (one batch at a time: a
 * second call waits for the one in flight). Idempotent via an
 * Idempotency-Key derived from the batch's content plus the server's
 * `[deviceId, clientEventId]` uniqueness, so a retry after a partial failure
 * never double-submits. Events left "SYNCING" by an app that was closed
 * mid-sync are sent again (the server answers DUPLICATE if it already had them).
 */
export function flushQueue(client: FieldMasterClient, deviceId: string): Promise<FlushResult> {
  flushing ??= flushOnce(client, deviceId).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function flushOnce(client: FieldMasterClient, deviceId: string): Promise<FlushResult> {
  const batch = await withQueueLock(async () => {
    const queue = await readUnlocked();
    const waiting = queue.filter(isWaiting);
    if (waiting.length > 0) await writeUnlocked(queue.map((e) => (isWaiting(e) ? { ...e, localStatus: "SYNCING" as const } : e)));
    return waiting;
  });
  if (batch.length === 0) return { attempted: 0, synced: 0, stillPending: 0, keyRevoked: false };

  const batchIds = new Set(batch.map((e) => e.clientEventId));
  const backToPending = (events: QueuedEvent[]) =>
    events.map((e) => (batchIds.has(e.clientEventId) && e.localStatus === "SYNCING" ? { ...e, localStatus: "PENDING" as const } : e));

  let results: OfflineSyncEventResult[];
  try {
    const idempotencyKey = `offline-batch-${deviceId}-${batch.map((e) => e.clientEventId).join(",").slice(0, 200)}`;
    const response = await client.submitOfflineSyncBatch(
      { deviceId, events: batch.map(({ localStatus: _localStatus, queuedAt: _queuedAt, reason: _reason, ...rest }) => rest) },
      idempotencyKey,
    );
    results = response.results;
  } catch {
    // Still offline, or the server is unreachable: back to PENDING so the
    // next connectivity-restored event (or a manual retry) picks them up
    // again. Nothing is lost.
    await withQueueLock(async () => writeUnlocked(backToPending(await readUnlocked())));
    return { attempted: batch.length, synced: 0, stillPending: batch.length, keyRevoked: false };
  }

  const byClientEventId = new Map(results.map((r) => [r.clientEventId, r]));
  const stillPending = await withQueueLock(async () => {
    const queue = await readUnlocked();
    const updated = backToPending(
      queue.map((e) => {
        const result = byClientEventId.get(e.clientEventId);
        if (!result || e.localStatus !== "SYNCING") return e;
        return { ...e, localStatus: result.status as QueuedEventLocalStatus, reason: result.reason };
      }),
    );
    await writeUnlocked(updated);
    return updated.filter((e) => batchIds.has(e.clientEventId) && isWaiting(e)).length;
  });
  return {
    attempted: batch.length,
    synced: batch.length - stillPending,
    stillPending,
    keyRevoked: results.some((r) => r.reason === "DEVICE_KEY_REVOKED"),
  };
}

/**
 * An Owner revoked this device's signing key: nothing signed with it can be
 * accepted any more, so the queue is cleared and the worker is told how many
 * records were still waiting to be sent (or were just refused for this
 * reason). Returns that number.
 */
export async function clearQueueAfterKeyRevocation(): Promise<number> {
  return withQueueLock(async () => {
    let lost = 0;
    try {
      const queue = await readUnlocked();
      lost = queue.filter((e) => isWaiting(e) || (e.localStatus === "REJECTED" && e.reason === "DEVICE_KEY_REVOKED")).length;
    } catch {
      // The key store is unavailable: the queue is removed all the same (it can never be accepted).
    }
    await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    await setNotice("DEVICE_KEY_REVOKED", lost);
    return lost;
  });
}
