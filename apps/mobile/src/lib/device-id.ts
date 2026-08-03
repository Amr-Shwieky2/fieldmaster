import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "fieldmaster.deviceId";
const isWeb = Platform.OS === "web";

// No native device-fingerprint module (expo-application) is installed in this
// slice, so a random id is generated once and persisted (Keychain/Keystore on
// native; expo-secure-store has no web implementation, so web -- used only as
// a stand-in for iOS Simulator verification here -- falls back to AsyncStorage)
// so it stays stable across app launches for this install.
export async function getDeviceId(): Promise<string> {
  const existing = isWeb ? await AsyncStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
  if (existing) return existing;
  const generated = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (isWeb) {
    await AsyncStorage.setItem(KEY, generated);
  } else {
    await SecureStore.setItemAsync(KEY, generated);
  }
  return generated;
}
