import * as Crypto from "expo-crypto";
import { generateOfflineSigningKeyPair, type OfflineSigningKeyPair } from "@fieldmaster/shared-validation";
import type { FieldMasterClient } from "@fieldmaster/api-client";
import { deleteSecureItem, getSecureItem, SECURE_KEYS, setSecureItem } from "./secure-storage";

/**
 * Serializes everything that reads or changes this device's signing key and
 * its registration (key creation, POST /devices/public-key, PUT /devices/me
 * and the revocation reset), so a registration answer can never describe a
 * key that changed while the request was in flight.
 */
let lockTail: Promise<unknown> = Promise.resolve();

export function withDeviceKeyLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lockTail.then(task, task);
  lockTail = run.catch(() => undefined);
  return run;
}

function isKeyPair(value: unknown): value is OfflineSigningKeyPair {
  const candidate = value as Partial<OfflineSigningKeyPair> | null;
  return typeof candidate?.publicKeyBase64 === "string" && typeof candidate.secretKeyBase64 === "string";
}

async function readKeyPair(): Promise<OfflineSigningKeyPair | null> {
  const stored = await getSecureItem(SECURE_KEYS.signingKey);
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isKeyPair(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let creating: Promise<OfflineSigningKeyPair> | null = null;

/**
 * Returns this device's Ed25519 offline-signing keypair (spec section
 * 20.2), generating one on first use. A pure local operation: it never
 * touches the network, so it works the same online or offline. The private
 * key lives only in the Keychain/Keystore via expo-secure-store (the web
 * stand-in uses AsyncStorage, see secure-storage.ts). `tweetnacl` has no
 * ambient RNG on React Native, so `expo-crypto`'s native `getRandomBytes` is
 * passed in as the seed source. Concurrent first calls share one generation,
 * so two events can never be signed with two different new keys.
 */
export function getOrCreateDeviceKeyPair(): Promise<OfflineSigningKeyPair> {
  creating ??= (async () => {
    const existing = await readKeyPair();
    if (existing) return existing;
    const keyPair = generateOfflineSigningKeyPair((byteCount) => Crypto.getRandomBytes(byteCount));
    await setSecureItem(SECURE_KEYS.signingKey, JSON.stringify(keyPair));
    // A new key is not registered yet, whatever was registered before.
    await deleteSecureItem(SECURE_KEYS.signingKeyRegisteredFor);
    return keyPair;
  })().finally(() => {
    creating = null;
  });
  return creating;
}

/** Whether this device's current key was registered with the API (for this install id). */
export async function isDeviceKeyRegistered(deviceId: string): Promise<boolean> {
  return (await getSecureItem(SECURE_KEYS.signingKeyRegisteredFor)) === deviceId;
}

/** Registers the current key (creating it if needed). Callers hold the device-key lock. */
export async function registerDeviceKeyUnlocked(client: FieldMasterClient, deviceId: string): Promise<void> {
  const keyPair = await getOrCreateDeviceKeyPair();
  await client.registerDevicePublicKey({ deviceId, publicKey: keyPair.publicKeyBase64 });
  await setSecureItem(SECURE_KEYS.signingKeyRegisteredFor, deviceId);
}

/**
 * Best-effort: registers this device's public key with the backend if it
 * hasn't been registered yet (or if the device ID changed, e.g. a reinstall),
 * or always with `force` (the API said it has no key for this device). Safe
 * to call on every sign-in/app start: the endpoint is an upsert, and this is
 * a no-op once registered. A thrown error is not fatal: offline, the
 * registration simply happens the next time this runs while online. An
 * unregistered key doesn't block capturing offline events locally, only
 * their eventual server-side verification.
 */
export function ensureDeviceKeyRegistered(client: FieldMasterClient, deviceId: string, options: { force?: boolean } = {}): Promise<void> {
  return withDeviceKeyLock(async () => {
    if (!options.force && (await isDeviceKeyRegistered(deviceId))) return;
    await registerDeviceKeyUnlocked(client, deviceId);
  });
}

/**
 * Forgets the signing key and its registration (an Owner revoked it). The
 * next key is generated on first use after a fresh sign-in, and registered
 * then. Callers hold the device-key lock.
 */
export async function clearDeviceKeyUnlocked(): Promise<void> {
  await deleteSecureItem(SECURE_KEYS.signingKey);
  await deleteSecureItem(SECURE_KEYS.signingKeyRegisteredFor);
}
