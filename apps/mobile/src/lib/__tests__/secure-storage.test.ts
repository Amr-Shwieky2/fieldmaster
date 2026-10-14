import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { FieldMasterClient } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { getDeviceId } from "../device-id";
import { clearDeviceKeyUnlocked, ensureDeviceKeyRegistered, getOrCreateDeviceKeyPair, withDeviceKeyLock } from "../device-key";
import { enqueueEvent, getQueue } from "../offline-queue";
import { SECURE_KEYS } from "../secure-storage";
import { sessionStore, type StoredSession } from "../session-store";

const SESSION: StoredSession = {
  accessToken: "header.payload.signature",
  refreshToken: "family:secret",
  organizationId: "org-1",
  role: OrgRole.WORKER,
  workerProfileId: "worker-1",
};

const SECRET_KEYS = Object.values(SECURE_KEYS);

/** Every key AsyncStorage was asked to read, write or delete. */
function asyncStorageKeys(): string[] {
  return [AsyncStorage.getItem, AsyncStorage.setItem, AsyncStorage.removeItem, AsyncStorage.mergeItem].flatMap((fn) => jest.mocked(fn).mock.calls.map((call) => call[0] as string));
}

/** Every secret the app keeps: the session, the install id, the signing key (+ its registration) and the queue key. */
async function useEverySecret() {
  await sessionStore.save(SESSION);
  expect(await sessionStore.load()).toEqual(SESSION);
  const deviceId = await getDeviceId();
  await getOrCreateDeviceKeyPair();
  const api = { registerDevicePublicKey: jest.fn(async () => ({})) } as unknown as FieldMasterClient;
  await ensureDeviceKeyRegistered(api, deviceId);
  await enqueueEvent({
    clientEventId: "evt-1",
    eventType: "CLOCK_IN",
    deviceTimestamp: "2026-01-15T08:30:00.000Z",
    latitude: 32.0853,
    longitude: 34.7818,
    accuracyMeters: 8,
  });
  expect(await getQueue()).toHaveLength(1);
  await withDeviceKeyLock(clearDeviceKeyUnlocked);
  await sessionStore.clear();
  expect(await sessionStore.load()).toBeNull();
}

describe.each(["ios", "android"] as const)("secure storage on %s", (os) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", os);
  });

  it("keeps the session, the signing key, the install id and the queue key ONLY in the Keychain / Keystore", async () => {
    await useEverySecret();

    // AsyncStorage never sees any of them (it only holds the sealed queue).
    const touched = asyncStorageKeys();
    for (const key of SECRET_KEYS) expect(touched).not.toContain(key);
    expect(touched).toContain("fieldmaster.offlineQueue");
    for (const key of touched) expect(["fieldmaster.offlineQueue", "fieldmaster.offlineQueue.notice"]).toContain(key);
    const everything = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> }).__INTERNAL_MOCK_STORAGE__;
    for (const value of Object.values(everything)) {
      expect(value).not.toContain(SESSION.refreshToken);
      expect(value).not.toContain(SESSION.accessToken);
    }

    // ...and each of them went to SecureStore.
    const secureWrites = jest.mocked(SecureStore.setItemAsync).mock.calls.map(([key]) => key);
    expect(new Set(secureWrites)).toEqual(
      new Set([SECURE_KEYS.session, SECURE_KEYS.deviceId, SECURE_KEYS.signingKey, SECURE_KEYS.signingKeyRegisteredFor, SECURE_KEYS.offlineQueueKey]),
    );
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls.map(([key]) => key)).toEqual(
      expect.arrayContaining([SECURE_KEYS.session, SECURE_KEYS.signingKey, SECURE_KEYS.signingKeyRegisteredFor]),
    );
  });

  it("has no AsyncStorage fallback: when the Keychain / Keystore fails, saving the session fails", async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("Keystore unavailable"));
    await expect(sessionStore.save(SESSION)).rejects.toThrow("Keystore unavailable");
    expect(asyncStorageKeys()).toEqual([]);
  });

  it("reads a damaged session as signed out instead of crashing", async () => {
    await SecureStore.setItemAsync(SECURE_KEYS.session, "{not json");
    expect(await sessionStore.load()).toBeNull();
    await SecureStore.setItemAsync(SECURE_KEYS.session, JSON.stringify({ organizationId: "org-1" }));
    expect(await sessionStore.load()).toBeNull();
  });
});

describe("secure storage on the web (a development stand-in)", () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "web");
  });

  it("falls back to AsyncStorage there, because expo-secure-store has no web implementation", async () => {
    await useEverySecret();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(asyncStorageKeys()).toEqual(expect.arrayContaining([SECURE_KEYS.session, SECURE_KEYS.signingKey, SECURE_KEYS.offlineQueueKey]));
  });
});
