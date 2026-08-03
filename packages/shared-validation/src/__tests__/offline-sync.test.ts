import { canonicalizeOfflineEvent, type OfflineEventSignablePayload } from "../offline-sync";

describe("canonicalizeOfflineEvent", () => {
  const base: OfflineEventSignablePayload = {
    clientEventId: "evt-1",
    eventType: "CLOCK_IN",
    shiftId: "shift-1",
    deviceTimestamp: "2026-01-05T06:00:00.000Z",
    latitude: 32.08,
    longitude: 34.78,
    accuracyMeters: 12,
  };

  it("produces identical output regardless of source key order", () => {
    const reordered: OfflineEventSignablePayload = {
      accuracyMeters: 12,
      longitude: 34.78,
      latitude: 32.08,
      deviceTimestamp: "2026-01-05T06:00:00.000Z",
      shiftId: "shift-1",
      eventType: "CLOCK_IN",
      clientEventId: "evt-1",
    };
    expect(canonicalizeOfflineEvent(base)).toBe(canonicalizeOfflineEvent(reordered));
  });

  it("drops undefined fields but keeps explicit null/false/0", () => {
    const withUndefined: OfflineEventSignablePayload = { ...base, altitude: undefined, mockLocationSuspected: false };
    const withoutField: OfflineEventSignablePayload = { ...base, mockLocationSuspected: false };
    expect(canonicalizeOfflineEvent(withUndefined)).toBe(canonicalizeOfflineEvent(withoutField));
    expect(canonicalizeOfflineEvent(withUndefined)).toContain('"mockLocationSuspected":false');
  });

  it("changes output when any signable field changes", () => {
    const mutated: OfflineEventSignablePayload = { ...base, latitude: 32.081 };
    expect(canonicalizeOfflineEvent(base)).not.toBe(canonicalizeOfflineEvent(mutated));
  });

  it("is stable across repeated calls (no timestamp/random noise)", () => {
    expect(canonicalizeOfflineEvent(base)).toBe(canonicalizeOfflineEvent(base));
  });
});
