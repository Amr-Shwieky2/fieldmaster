import { describe, expect, it } from "vitest";
import { canonicalizeOfflineEvent, verifyOfflineEventSignature, type OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import { applySyncResults, batchIdempotencyKey, createSimulatedDeviceKey, signOfflineClockEvent, toBatchEvent } from "../offline";

const CLOCK_IN: OfflineEventSignablePayload = {
  clientEventId: "sim-in-1",
  eventType: "CLOCK_IN",
  shiftId: "shift-1",
  temporaryCheckInPointId: undefined,
  deviceTimestamp: "2026-10-11T06:00:00.000Z",
  latitude: 32.0853,
  longitude: 34.7818,
  accuracyMeters: 10,
  locationProvider: "admin-web-worker-simulator",
  mockLocationSuspected: false,
};

/** What the API does at sync time: rebuild the signable payload from the wire event and verify it with the registered public key. */
function serverVerifies(wire: Record<string, unknown>, publicKeyBase64: string): boolean {
  const { signature, ...signable } = wire;
  return verifyOfflineEventSignature(canonicalizeOfflineEvent(signable as unknown as OfflineEventSignablePayload), signature as string, publicKeyBase64);
}

describe("simulator offline protocol", () => {
  it("signs an event that the server's verification accepts, without the local bookkeeping on the wire", () => {
    const key = createSimulatedDeviceKey();
    const queued = signOfflineClockEvent(CLOCK_IN, key);
    expect(queued.localStatus).toBe("PENDING");

    const wire = JSON.parse(JSON.stringify(toBatchEvent(queued))) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual([...Object.keys(CLOCK_IN).filter((k) => k !== "temporaryCheckInPointId"), "signature"].sort());
    expect(serverVerifies(wire, key.publicKeyBase64)).toBe(true);
  });

  it("produces a signature that fails for a tampered event or another device's key", () => {
    const key = createSimulatedDeviceKey();
    const wire = JSON.parse(JSON.stringify(toBatchEvent(signOfflineClockEvent(CLOCK_IN, key)))) as Record<string, unknown>;
    expect(serverVerifies({ ...wire, latitude: 32.2 }, key.publicKeyBase64)).toBe(false);
    expect(serverVerifies(wire, createSimulatedDeviceKey().publicKeyBase64)).toBe(false);
  });

  it("applies per-event outcomes and gives a resend a new Idempotency-Key", () => {
    const key = createSimulatedDeviceKey();
    const events = [signOfflineClockEvent(CLOCK_IN, key), signOfflineClockEvent({ ...CLOCK_IN, clientEventId: "sim-out-1", eventType: "CLOCK_OUT" }, key)];
    const synced = applySyncResults(events, [
      { clientEventId: "sim-in-1", status: "VERIFIED", timeEntryId: "te-1" },
      { clientEventId: "sim-out-1", status: "REJECTED", reason: "SUMMARY_REQUIRED" },
    ]);
    expect(synced.map((e) => [e.localStatus, e.reason, e.timeEntryId])).toEqual([
      ["VERIFIED", undefined, "te-1"],
      ["REJECTED", "SUMMARY_REQUIRED", undefined],
    ]);

    const first = batchIdempotencyKey("device-1", events);
    expect(batchIdempotencyKey("device-1", events)).toBe(first);
    expect(batchIdempotencyKey("device-1", events, 1)).not.toBe(first);
  });
});
