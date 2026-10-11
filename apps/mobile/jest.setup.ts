import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager } from "react-native";

// The app always runs right-to-left (forced by app.json / expo-localization).
// Mirror that steady state; a test can simulate an LTR first launch with
// jest.replaceProperty(I18nManager, "isRTL", false).
const rtlConstants = { ...I18nManager.getConstants(), isRTL: true };
Object.assign(I18nManager, { isRTL: true, getConstants: () => rtlConstants });

jest.mock("@react-native-async-storage/async-storage", () => jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@react-native-community/netinfo", () => jest.requireActual("@react-native-community/netinfo/jest/netinfo-mock.js"));
jest.mock("react-native-safe-area-context", () => jest.requireActual("react-native-safe-area-context/jest/mock").default);

// jest-expo's automatic Expo mocks resolve to undefined/null; give the app realistic values.
jest.mock("expo-location", () => ({
  ...jest.requireActual("expo-location"),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true, canAskAgain: true, expires: "never" })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 32.0853, longitude: 34.7818, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now(),
    mocked: false,
  })),
}));

const mockSecureStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  ...jest.requireActual("expo-secure-store"),
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock("expo-crypto", () => ({
  ...jest.requireActual("expo-crypto"),
  getRandomBytes: (count: number) => globalThis.crypto.getRandomValues(new Uint8Array(count)),
}));

jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));

beforeEach(async () => {
  mockSecureStore.clear();
  await AsyncStorage.clear();
});
