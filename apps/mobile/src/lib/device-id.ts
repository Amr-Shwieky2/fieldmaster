import { getSecureItem, SECURE_KEYS, setSecureItem } from "./secure-storage";

/**
 * This install's stable id, sent at sign-in, with offline events and on
 * device registration. A random id is generated once and kept in secure
 * storage (Keychain / Keystore on iOS and Android; AsyncStorage on the web
 * stand-in), so it survives app restarts but not a reinstall. It is not a
 * hardware identifier on purpose (no IDFV / Android ID): the API only needs
 * to tell this install's sessions and key apart.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await getSecureItem(SECURE_KEYS.deviceId);
  if (existing) return existing;
  const generated = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await setSecureItem(SECURE_KEYS.deviceId, generated);
  return generated;
}
