import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OrgRole } from "@fieldmaster/shared-types";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  role: OrgRole;
  workerProfileId: string | null;
}

const KEY = "fieldmaster.session";

/**
 * Tokens live in the iOS Keychain / Android Keystore via expo-secure-store
 * (spec section 7.2 -- "never store authentication tokens in plain
 * AsyncStorage"). This is the one piece of native-security spec language
 * this slice actually satisfies for real; full device attestation /
 * mock-location detection is not implemented -- see technical-decisions.md.
 *
 * expo-secure-store has no web implementation (its web module is a stub),
 * so the web target -- used only as a stand-in for iOS Simulator
 * verification in this environment -- falls back to AsyncStorage there.
 * Real device builds (iOS/Android) always use the Keychain/Keystore path.
 */
const isWeb = Platform.OS === "web";

export const sessionStore = {
  async load(): Promise<StoredSession | null> {
    const raw = isWeb ? await AsyncStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  },
  async save(session: StoredSession): Promise<void> {
    if (isWeb) {
      await AsyncStorage.setItem(KEY, JSON.stringify(session));
    } else {
      await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    }
  },
  async clear(): Promise<void> {
    if (isWeb) {
      await AsyncStorage.removeItem(KEY);
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  },
};
