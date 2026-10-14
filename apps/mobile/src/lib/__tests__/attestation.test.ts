import { defaultAttestationProvider, devMockAttestation, readAttestationState, unavailableAttestation, type AttestationProvider } from "../attestation";

describe("attestation adapter", () => {
  it("is the development mock in development builds and UNAVAILABLE in every other build", async () => {
    expect(defaultAttestationProvider(true)).toBe(devMockAttestation);
    expect(defaultAttestationProvider(false)).toBe(unavailableAttestation);
    expect(await readAttestationState(defaultAttestationProvider(true))).toBe("DEV_MOCK");
    expect(await readAttestationState(defaultAttestationProvider(false))).toBe("UNAVAILABLE");
  });

  it("never claims a verified device, even when a provider fails", async () => {
    const failing: AttestationProvider = { getState: () => Promise.reject(new Error("Play Integrity unavailable")) };
    expect(await readAttestationState(failing)).toBe("UNAVAILABLE");
    for (const provider of [devMockAttestation, unavailableAttestation]) {
      expect(await provider.getState()).not.toMatch(/VERIFIED|VALID|PASS/i);
    }
  });
});
