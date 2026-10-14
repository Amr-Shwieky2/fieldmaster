import * as SecureStore from "expo-secure-store";
import { ApiRequestError, NetworkError, type FieldMasterClient, type RegisteredDevice } from "@fieldmaster/api-client";
import { devMockAttestation, unavailableAttestation } from "../attestation";
import { getOrCreateDeviceKeyPair, isDeviceKeyRegistered } from "../device-key";
import { buildRegistrationInput, currentPlatform, deviceInfo, registerThisDevice, type DeviceInfoSources } from "../device-registration";
import { SECURE_KEYS } from "../secure-storage";

const DEVICE_ID = "mobile-device-1";
const PUSH_TOKEN = "ExponentPushToken[abc123]";

function sources(overrides: Partial<DeviceInfoSources> = {}): DeviceInfoSources {
  return {
    os: "ios",
    deviceOsVersion: "17.5",
    platformVersion: "17.5",
    inExpoGo: false,
    nativeApplicationVersion: "0.1.0",
    configVersion: "0.1.0",
    ...overrides,
  };
}

const deps = {
  getDeviceId: async () => DEVICE_ID,
  getPushToken: async () => PUSH_TOKEN,
  attestation: devMockAttestation,
  info: () => deviceInfo(sources({ os: "android", deviceOsVersion: "14", platformVersion: 34 })),
};

function apiClient(keyStatus: RegisteredDevice["keyStatus"], overrides: Record<string, jest.Mock> = {}) {
  return {
    registerDevice: jest.fn(async (input: { deviceId: string; platform: RegisteredDevice["platform"] }) => ({
      deviceId: input.deviceId,
      platform: input.platform,
      keyStatus,
      registeredAt: "2026-01-15T08:00:00.000Z",
    })),
    registerDevicePublicKey: jest.fn(async () => ({ id: "key-1", deviceId: DEVICE_ID, algorithm: "ed25519", registeredAt: "2026-01-15T08:00:00.000Z" })),
    ...overrides,
  } as unknown as FieldMasterClient & { registerDevice: jest.Mock; registerDevicePublicKey: jest.Mock };
}

describe("device information", () => {
  it("maps the platform", () => {
    expect(currentPlatform("ios")).toBe("IOS");
    expect(currentPlatform("android")).toBe("ANDROID");
    expect(currentPlatform("web")).toBe("WEB");
  });

  it("reads the OS version from expo-device, falling back to React Native's", () => {
    expect(deviceInfo(sources())).toEqual({ platform: "IOS", osVersion: "17.5", appVersion: "0.1.0" });
    expect(deviceInfo(sources({ os: "android", deviceOsVersion: null, platformVersion: 34 }))).toMatchObject({ platform: "ANDROID", osVersion: "34" });
    expect(deviceInfo(sources({ os: "web", deviceOsVersion: null, platformVersion: null }))).toMatchObject({ platform: "WEB", osVersion: null });
  });

  it("sends this app's version, not Expo Go's, when running inside Expo Go", () => {
    expect(deviceInfo(sources({ inExpoGo: true, nativeApplicationVersion: "57.0.4", configVersion: "0.1.0" })).appVersion).toBe("0.1.0");
    expect(deviceInfo(sources({ nativeApplicationVersion: "0.2.0", configVersion: "0.1.0" })).appVersion).toBe("0.2.0");
    expect(deviceInfo(sources({ nativeApplicationVersion: null, configVersion: null })).appVersion).toBeNull();
  });
});

describe("device registration (PUT /devices/me)", () => {
  it("sends platform, OS and app version, push token and attestation state", async () => {
    expect(await buildRegistrationInput(deps)).toEqual({
      deviceId: DEVICE_ID,
      platform: "ANDROID",
      osVersion: "14",
      appVersion: "0.1.0",
      pushToken: PUSH_TOKEN,
      attestationState: "DEV_MOCK",
    });
    expect(await buildRegistrationInput({ ...deps, attestation: unavailableAttestation, getPushToken: async () => null })).toMatchObject({
      pushToken: null,
      attestationState: "UNAVAILABLE",
    });
  });

  it("registers the signing key too when the API has none for this device", async () => {
    const api = apiClient("NONE");
    expect(await registerThisDevice(api, deps)).toBe("REGISTERED");

    expect(api.registerDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceId: DEVICE_ID, pushToken: PUSH_TOKEN }));
    const keyPair = await getOrCreateDeviceKeyPair();
    expect(api.registerDevicePublicKey).toHaveBeenCalledWith({ deviceId: DEVICE_ID, publicKey: keyPair.publicKeyBase64 });
    expect(await isDeviceKeyRegistered(DEVICE_ID)).toBe(true);
  });

  it("does not register the key again when it is ACTIVE and already registered from this phone", async () => {
    await registerThisDevice(apiClient("NONE"), deps);
    const api = apiClient("ACTIVE");
    expect(await registerThisDevice(api, deps)).toBe("REGISTERED");
    expect(api.registerDevicePublicKey).not.toHaveBeenCalled();
  });

  it("reports a revoked key when the key this phone registered was revoked by an Owner", async () => {
    await registerThisDevice(apiClient("NONE"), deps);
    const api = apiClient("REVOKED");
    expect(await registerThisDevice(api, deps)).toBe("REVOKED");
    expect(api.registerDevicePublicKey).not.toHaveBeenCalled();
  });

  it("after the reset and a fresh sign-in, generates and registers a NEW key", async () => {
    await registerThisDevice(apiClient("NONE"), deps);
    const oldKey = (await getOrCreateDeviceKeyPair()).publicKeyBase64;
    // What the app does on a revocation: the key and its registration are forgotten.
    await SecureStore.deleteItemAsync(SECURE_KEYS.signingKey);
    await SecureStore.deleteItemAsync(SECURE_KEYS.signingKeyRegisteredFor);

    const api = apiClient("REVOKED");
    expect(await registerThisDevice(api, deps)).toBe("REGISTERED");
    const newKey = (await getOrCreateDeviceKeyPair()).publicKeyBase64;
    expect(newKey).not.toBe(oldKey);
    expect(api.registerDevicePublicKey).toHaveBeenCalledWith({ deviceId: DEVICE_ID, publicKey: newKey });
  });

  it("treats the API refusing a new key (the session predates the revocation) as a revocation", async () => {
    const api = apiClient("REVOKED", {
      registerDevicePublicKey: jest.fn(async () => {
        throw new ApiRequestError(403, { statusCode: 403, code: "DEVICE_KEY_REVOKED", message: "revoked", correlationId: "c" });
      }),
    });
    expect(await registerThisDevice(api, deps)).toBe("REVOKED");
  });

  it("is tried again later when offline or when the server fails", async () => {
    const offline = apiClient("ACTIVE", {
      registerDevice: jest.fn(async () => {
        throw new NetworkError(new TypeError("Network request failed"));
      }),
    });
    expect(await registerThisDevice(offline, deps)).toBe("RETRY");

    const failing = apiClient("ACTIVE", {
      registerDevice: jest.fn(async () => {
        throw new ApiRequestError(500, { statusCode: 500, code: "INTERNAL_ERROR", message: "boom", correlationId: "c" });
      }),
    });
    expect(await registerThisDevice(failing, deps)).toBe("RETRY");
  });
});
