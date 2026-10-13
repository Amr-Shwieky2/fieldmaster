import type { OrgRole } from "@fieldmaster/shared-types";
import { deleteSecureItem, getSecureItem, SECURE_KEYS, setSecureItem } from "./secure-storage";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  role: OrgRole;
  workerProfileId: string | null;
}

/**
 * The session (short-lived access token + rotating refresh token) lives only
 * in the iOS Keychain / Android Keystore via expo-secure-store (spec 7.2:
 * "never store authentication tokens in plain AsyncStorage"). The web target,
 * a development stand-in only, keeps it in AsyncStorage: see secure-storage.ts.
 */
export const sessionStore = {
  async load(): Promise<StoredSession | null> {
    const raw = await getSecureItem(SECURE_KEYS.session);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
      if (!parsed || typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") return null;
      return parsed as StoredSession;
    } catch {
      return null;
    }
  },
  async save(session: StoredSession): Promise<void> {
    await setSecureItem(SECURE_KEYS.session, JSON.stringify(session));
  },
  async clear(): Promise<void> {
    await deleteSecureItem(SECURE_KEYS.session);
  },
};
