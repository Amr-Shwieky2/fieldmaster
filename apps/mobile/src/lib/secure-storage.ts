import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The one place that decides where secrets live: the session (access and
 * refresh tokens), the device's offline-signing private key, the offline
 * queue's encryption key and the install id.
 *
 * - iOS / Android: ONLY expo-secure-store (iOS Keychain, Android Keystore).
 *   There is no AsyncStorage path on native, not even as a fallback: if the
 *   Keychain/Keystore fails, the call fails (spec 7.2: never keep tokens in
 *   plain AsyncStorage).
 * - Web: expo-secure-store has no web implementation (its web module is an
 *   empty stub), so the web target, which is only a development stand-in for
 *   a phone (see docs/technical-decisions.md), uses AsyncStorage
 *   (localStorage). Nothing on the web is a real secret store.
 *
 * The platform is read on every call (not once at import) so tests can run
 * the same code as iOS, Android and web.
 */
export function usesSecureStore(): boolean {
  return Platform.OS !== "web";
}

export async function getSecureItem(key: string): Promise<string | null> {
  return usesSecureStore() ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (usesSecureStore()) await SecureStore.setItemAsync(key, value);
  else await AsyncStorage.setItem(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (usesSecureStore()) await SecureStore.deleteItemAsync(key);
  else await AsyncStorage.removeItem(key);
}

/** Every key kept in secure storage (tests assert none of them ever reaches AsyncStorage on iOS/Android). */
export const SECURE_KEYS = {
  session: "fieldmaster.session",
  deviceId: "fieldmaster.deviceId",
  signingKey: "fieldmaster.offlineSigningKey",
  signingKeyRegisteredFor: "fieldmaster.offlineSigningKey.registeredFor",
  offlineQueueKey: "fieldmaster.offlineQueueKey",
} as const;
