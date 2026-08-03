import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { generateOfflineSigningKeyPair, type OfflineSigningKeyPair } from "@fieldmaster/shared-validation";
import type { FieldMasterClient } from "@fieldmaster/api-client";

const KEY = "fieldmaster.offlineSigningKey";
const REGISTERED_FOR_DEVICE_KEY = "fieldmaster.offlineSigningKey.registeredFor";
const isWeb = Platform.OS === "web";

async function loadItem(key: string): Promise<string | null> {
  return isWeb ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
}
async function saveItem(key: string, value: string): Promise<void> {
  if (isWeb) await AsyncStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}

/**
 * Returns this device's Ed25519 offline-signing keypair (spec section
 * 20.2), generating one on first use. This is a pure local operation --
 * it never touches the network, so it works identically whether the device
 * is online or not. The private key lives in Keychain/Keystore via
 * expo-secure-store (AsyncStorage fallback on web -- see session-store.ts
 * for why); `tweetnacl` has no ambient RNG on React Native the way it does
 * in Node or a browser, so `expo-crypto`'s native `getRandomBytes` is
 * threaded through explicitly as the seed source.
 */
export async function getOrCreateDeviceKeyPair(): Promise<OfflineSigningKeyPair> {
  const existing = await loadItem(KEY);
  if (existing) return JSON.parse(existing) as OfflineSigningKeyPair;

  const keyPair = generateOfflineSigningKeyPair((byteCount) => Crypto.getRandomBytes(byteCount));
  await saveItem(KEY, JSON.stringify(keyPair));
  return keyPair;
}

/**
 * Best-effort: registers this device's public key with the backend if it
 * hasn't been registered yet (or if the device ID has changed, e.g. a
 * reinstall). Safe to call on every login/app start -- the server endpoint
 * is an upsert, and this function is a no-op once already registered for
 * the current device ID. Callers should not treat a thrown error as fatal:
 * if the device is offline right now, registration simply happens the next
 * time this runs while online. An unregistered key doesn't block capturing
 * offline events locally, only their eventual server-side verification.
 */
export async function ensureDeviceKeyRegistered(client: FieldMasterClient, deviceId: string): Promise<void> {
  const registeredFor = await loadItem(REGISTERED_FOR_DEVICE_KEY);
  if (registeredFor === deviceId) return;

  const keyPair = await getOrCreateDeviceKeyPair();
  await client.registerDevicePublicKey({ deviceId, publicKey: keyPair.publicKeyBase64 });
  await saveItem(REGISTERED_FOR_DEVICE_KEY, deviceId);
}
