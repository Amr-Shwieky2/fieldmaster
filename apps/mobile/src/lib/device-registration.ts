import { Platform } from "react-native";
import * as Application from "expo-application";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { isRunningInExpoGo } from "expo";
import type { FieldMasterClient, RegisterDeviceInput } from "@fieldmaster/api-client";
import { getErrorCode } from "@fieldmaster/i18n";
import type { DevicePlatform } from "@fieldmaster/shared-types";
import { readAttestationState, type AttestationProvider } from "./attestation";
import { getDeviceId } from "./device-id";
import { isDeviceKeyRegistered, registerDeviceKeyUnlocked, withDeviceKeyLock } from "./device-key";
import { getPushToken } from "./push";

/**
 * Device registration (PUT /devices/me), on every sign-in and app start:
 * platform, OS version, app version, push token and attestation state. Best
 * effort: offline, it is tried again on the next start (or when the phone is
 * back online). The answer also says whether an Owner revoked this device's
 * offline-signing key.
 */

export function currentPlatform(os: string = Platform.OS): DevicePlatform {
  return os === "ios" ? "IOS" : os === "android" ? "ANDROID" : "WEB";
}

export interface DeviceInfo {
  platform: DevicePlatform;
  osVersion: string | null;
  appVersion: string | null;
}

export interface DeviceInfoSources {
  os: string;
  /** expo-device: "17.5" on iOS, "14" on Android, the browser's OS version on the web. */
  deviceOsVersion: string | null;
  /** react-native: the iOS version, or Android's API level (a number). */
  platformVersion: string | number | null;
  inExpoGo: boolean;
  /** expo-application: the installed app's version (Expo Go's own version inside Expo Go). */
  nativeApplicationVersion: string | null;
  /** app.json `version`. */
  configVersion: string | null;
}

export function currentDeviceInfoSources(): DeviceInfoSources {
  return {
    os: Platform.OS,
    deviceOsVersion: Device.osVersion ?? null,
    platformVersion: (Platform.Version as string | number | undefined) ?? null,
    inExpoGo: isRunningInExpoGo(),
    nativeApplicationVersion: Application.nativeApplicationVersion ?? null,
    configVersion: Constants.expoConfig?.version ?? null,
  };
}

export function deviceInfo(sources: DeviceInfoSources = currentDeviceInfoSources()): DeviceInfo {
  const osVersion = sources.deviceOsVersion || (sources.platformVersion !== null && sources.platformVersion !== "" ? String(sources.platformVersion) : null);
  // Inside Expo Go the native version is Expo Go's, not this app's: use app.json's.
  const appVersion = sources.inExpoGo ? sources.configVersion : (sources.nativeApplicationVersion ?? sources.configVersion);
  return { platform: currentPlatform(sources.os), osVersion: osVersion || null, appVersion: appVersion || null };
}

export interface DeviceRegistrationDeps {
  getDeviceId: () => Promise<string>;
  getPushToken: () => Promise<string | null>;
  attestation?: AttestationProvider;
  info: () => DeviceInfo;
}

const defaultDeps: DeviceRegistrationDeps = {
  getDeviceId,
  getPushToken: () => getPushToken(),
  info: () => deviceInfo(),
};

/** The PUT /devices/me body for this phone. */
export async function buildRegistrationInput(deps: Partial<DeviceRegistrationDeps> = {}): Promise<RegisterDeviceInput> {
  const resolved = { ...defaultDeps, ...deps };
  const [deviceId, pushToken, attestationState] = await Promise.all([
    resolved.getDeviceId(),
    resolved.getPushToken().catch(() => null),
    readAttestationState(resolved.attestation),
  ]);
  return { deviceId, ...resolved.info(), pushToken, attestationState };
}

/**
 * - REGISTERED: done (and the signing key is registered).
 * - RETRY: offline or the server failed; try again on the next start / when back online.
 * - REVOKED: an Owner revoked the key this phone signs with: the caller clears
 *   the queue, the key and the session, and asks for a fresh sign-in.
 */
export type DeviceRegistrationOutcome = "REGISTERED" | "RETRY" | "REVOKED";

/**
 * Registers this phone and makes sure its signing key is registered too.
 *
 * keyStatus REVOKED means the key the API last had for this device was
 * revoked. If this phone still has that key registered, it is a new
 * revocation (REVOKED). If not, the app already reset after a revocation and
 * this is the fresh sign-in that follows: a new key is generated and
 * registered (the API accepts it only after a fresh sign-in).
 */
export async function registerThisDevice(client: FieldMasterClient, deps: Partial<DeviceRegistrationDeps> = {}): Promise<DeviceRegistrationOutcome> {
  try {
    const input = await buildRegistrationInput(deps);
    return await withDeviceKeyLock(async () => {
      const registered = await client.registerDevice(input);
      const keyRegistered = await isDeviceKeyRegistered(input.deviceId);
      if (registered.keyStatus === "REVOKED") {
        if (keyRegistered) return "REVOKED";
        await registerDeviceKeyUnlocked(client, input.deviceId);
        return "REGISTERED";
      }
      if (registered.keyStatus === "NONE" || !keyRegistered) await registerDeviceKeyUnlocked(client, input.deviceId);
      return "REGISTERED";
    });
  } catch (error) {
    if (getErrorCode(error) === "DEVICE_KEY_REVOKED") return "REVOKED";
    // Offline, a server error, or the Keychain / Keystore was not readable: tried again later.
    return "RETRY";
  }
}
