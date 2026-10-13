/**
 * Device attestation (spec 19: Play Integrity on Android, App Attest /
 * DeviceCheck on iOS) behind a small adapter.
 *
 * Nothing here verifies a device. Real attestation needs a native module
 * and a server-side check of the platform's signed verdict, and neither
 * exists in this app yet. So the app only ever reports what it cannot know:
 * - "DEV_MOCK" in development (`__DEV__`), a placeholder that marks the
 *   device registration as coming from a development build;
 * - "UNAVAILABLE" in every other build, on iOS, Android and the web.
 *
 * Never report "VERIFIED" (or anything like it) from the phone: a value the
 * phone makes up proves nothing. A real provider would send the platform's
 * token to the API, and only the API may decide the device is genuine.
 */
export type AttestationState = "DEV_MOCK" | "UNAVAILABLE";

export interface AttestationProvider {
  /** What the device registration sends as `attestationState`. Never throws. */
  getState(): Promise<AttestationState>;
}

export const devMockAttestation: AttestationProvider = {
  async getState() {
    return "DEV_MOCK";
  },
};

export const unavailableAttestation: AttestationProvider = {
  async getState() {
    return "UNAVAILABLE";
  },
};

/** The provider for this build: the development mock while developing, otherwise "UNAVAILABLE". */
export function defaultAttestationProvider(isDevelopment: boolean = __DEV__): AttestationProvider {
  return isDevelopment ? devMockAttestation : unavailableAttestation;
}

/** The provider's state, or "UNAVAILABLE" if it fails. */
export async function readAttestationState(provider: AttestationProvider = defaultAttestationProvider()): Promise<AttestationState> {
  try {
    return await provider.getState();
  } catch {
    return "UNAVAILABLE";
  }
}
