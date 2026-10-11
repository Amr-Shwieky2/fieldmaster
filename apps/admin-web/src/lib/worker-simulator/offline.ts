import {
  canonicalizeOfflineEvent,
  generateOfflineSigningKeyPair,
  signOfflineEvent,
  type OfflineEventSignablePayload,
  type OfflineSigningKeyPair,
} from "@fieldmaster/shared-validation";
import type { OfflineSyncEventResult } from "@fieldmaster/api-client";
import type { OfflineSyncEventStatus } from "@fieldmaster/shared-types";

/**
 * The real offline protocol, run in the browser: events are canonicalized and
 * signed with the same @fieldmaster/shared-validation functions the mobile app
 * uses, with a per-simulated-device Ed25519 key registered through the real
 * `POST /devices/public-key`, and synced through the real
 * `POST /offline-sync/batches`. Nothing here is persisted: the key and the
 * queue live in memory for one simulator session.
 */

export type LocalSyncStatus = "PENDING" | "SYNCING" | Exclude<OfflineSyncEventStatus, "PENDING">;

export interface QueuedOfflineEvent extends OfflineEventSignablePayload {
  signature: string;
  localStatus: LocalSyncStatus;
  queuedAt: string;
  reason?: string;
  timeEntryId?: string;
}

/** A fresh Ed25519 key pair for one simulated device, from the browser's CSPRNG. */
export function createSimulatedDeviceKey(): OfflineSigningKeyPair {
  return generateOfflineSigningKeyPair((length) => crypto.getRandomValues(new Uint8Array(length)));
}

/**
 * Signs an event exactly like the mobile app's offline queue. Absent optional
 * fields must stay `undefined` (never defaulted) so the server rebuilds the
 * same canonical bytes -- see docs/offline-sync.md.
 */
export function signOfflineClockEvent(payload: OfflineEventSignablePayload, key: OfflineSigningKeyPair, now: Date = new Date()): QueuedOfflineEvent {
  const signature = signOfflineEvent(canonicalizeOfflineEvent(payload), key.secretKeyBase64);
  return { ...payload, signature, localStatus: "PENDING", queuedAt: now.toISOString() };
}

/** The wire shape of one batch event: the signed fields plus the signature, without the local bookkeeping. */
export function toBatchEvent(event: QueuedOfflineEvent): Record<string, unknown> {
  const { localStatus: _status, queuedAt: _queuedAt, reason: _reason, timeEntryId: _timeEntryId, ...wire } = event;
  return wire;
}

/** Applies a batch response to the queued events it covers. */
export function applySyncResults(events: QueuedOfflineEvent[], results: OfflineSyncEventResult[]): QueuedOfflineEvent[] {
  const byId = new Map(results.map((r) => [r.clientEventId, r]));
  return events.map((event) => {
    const result = byId.get(event.clientEventId);
    if (!result) return event;
    return { ...event, localStatus: result.status as LocalSyncStatus, reason: result.reason, timeEntryId: result.timeEntryId };
  });
}

/** A per-batch Idempotency-Key. A retry of the same batch reuses it (the server replays its answer); `attempt` > 0 sends the same events as a new request. */
export function batchIdempotencyKey(deviceId: string, events: QueuedOfflineEvent[], attempt = 0): string {
  const base = `offline-batch-${deviceId}-${events.map((e) => e.clientEventId).join(",")}`.slice(0, 180);
  return attempt > 0 ? `${base}-resend-${attempt}` : base;
}
