import AsyncStorage from "@react-native-async-storage/async-storage";
import { canonicalizeOfflineEvent, signOfflineEvent, type OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import type { FieldMasterClient, OfflineSyncEventResult } from "@fieldmaster/api-client";
import { getOrCreateDeviceKeyPair } from "./device-key";

const QUEUE_KEY = "fieldmaster.offlineQueue";
const MAX_HISTORY = 100;

export type QueuedEventLocalStatus = "PENDING" | "SYNCING" | "VERIFIED" | "FLAGGED" | "REJECTED" | "DUPLICATE";

export interface QueuedEvent extends OfflineEventSignablePayload {
  signature: string;
  localStatus: QueuedEventLocalStatus;
  reason?: string;
  queuedAt: string;
}

/**
 * The mobile side of spec section 20: clock events captured while offline
 * are signed on-device and held here (AsyncStorage-backed -- see
 * technical-decisions.md for why this isn't SQLCipher-encrypted SQLite as
 * spec'd) until connectivity returns, at which point `flushQueue` submits
 * them as a single signed batch to `POST /offline-sync/batches` and
 * records the server's per-event verdict against each queued entry so the
 * worker sees a real synchronization receipt rather than a fire-and-forget
 * queue.
 */
async function readQueue(): Promise<QueuedEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedEvent[];
  } catch {
    return [];
  }
}

async function writeQueue(events: QueuedEvent[]): Promise<void> {
  // Keep the most recent MAX_HISTORY entries so a worker who never opens
  // the app can't grow this file unboundedly; PENDING events are never
  // trimmed regardless of age.
  const pending = events.filter((e) => e.localStatus === "PENDING" || e.localStatus === "SYNCING");
  const resolved = events.filter((e) => e.localStatus !== "PENDING" && e.localStatus !== "SYNCING").slice(-MAX_HISTORY);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...pending, ...resolved]));
}

export async function getQueue(): Promise<QueuedEvent[]> {
  return readQueue();
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.filter((e) => e.localStatus === "PENDING").length;
}

/** Signs and appends an event to the local queue. Never touches the network. */
export async function enqueueEvent(payload: OfflineEventSignablePayload): Promise<QueuedEvent> {
  const keyPair = await getOrCreateDeviceKeyPair();
  const canonical = canonicalizeOfflineEvent(payload);
  const signature = signOfflineEvent(canonical, keyPair.secretKeyBase64);
  const queued: QueuedEvent = { ...payload, signature, localStatus: "PENDING", queuedAt: new Date().toISOString() };

  const queue = await readQueue();
  queue.push(queued);
  await writeQueue(queue);
  return queued;
}

export interface FlushResult {
  attempted: number;
  synced: number;
  stillPending: number;
}

/**
 * Submits every PENDING queued event as one batch. Safe to call whenever
 * (a no-op if the queue is empty); safe to call concurrently/repeatedly
 * (idempotent via a fresh Idempotency-Key derived from the batch's own
 * content plus the server's `[deviceId, clientEventId]` uniqueness, so a
 * retry after a partial failure never double-submits).
 */
export async function flushQueue(client: FieldMasterClient, deviceId: string): Promise<FlushResult> {
  const queue = await readQueue();
  const pending = queue.filter((e) => e.localStatus === "PENDING");
  if (pending.length === 0) return { attempted: 0, synced: 0, stillPending: 0 };

  const marked = queue.map((e) => (e.localStatus === "PENDING" ? { ...e, localStatus: "SYNCING" as const } : e));
  await writeQueue(marked);

  try {
    const idempotencyKey = `offline-batch-${deviceId}-${pending.map((e) => e.clientEventId).join(",").slice(0, 200)}`;
    const response = await client.submitOfflineSyncBatch(
      { deviceId, events: pending.map(({ localStatus: _localStatus, queuedAt: _queuedAt, reason: _reason, ...rest }) => rest) },
      idempotencyKey,
    );
    const byClientEventId = new Map<string, OfflineSyncEventResult>(response.results.map((r) => [r.clientEventId, r]));

    const updated = marked.map((e) => {
      const result = byClientEventId.get(e.clientEventId);
      if (!result) return e;
      return { ...e, localStatus: result.status as QueuedEventLocalStatus, reason: result.reason };
    });
    await writeQueue(updated);

    const stillPending = updated.filter((e) => e.localStatus === "PENDING" || e.localStatus === "SYNCING").length;
    return { attempted: pending.length, synced: pending.length - stillPending, stillPending };
  } catch {
    // Still offline, or the server is unreachable -- revert to PENDING so
    // the next connectivity-restored event (or manual retry) picks it up
    // again. Nothing is lost.
    const reverted = marked.map((e) => (e.localStatus === "SYNCING" ? { ...e, localStatus: "PENDING" as const } : e));
    await writeQueue(reverted);
    return { attempted: pending.length, synced: 0, stillPending: pending.length };
  }
}
