import { Platform } from "react-native";
import type * as NotificationsModule from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { isRunningInExpoGo } from "expo";
import messages from "../i18n/messages";

/**
 * Push notifications through expo-notifications, behind a small adapter so
 * the rest of the app never touches the native module directly (and tests
 * can pass their own environment).
 *
 * The push token is null, never an error, when push cannot work here:
 * - the web target (a development stand-in; push is skipped there);
 * - a simulator / emulator (no real push token);
 * - Expo Go on Android: remote push was removed from Expo Go in SDK 53, and
 *   expo-notifications throws there as soon as it registers its token
 *   listener, so the module is not even loaded (a development build is
 *   needed);
 * - no EAS projectId (`npx eas-cli init` writes `extra.eas.projectId` into
 *   app.json): Expo's push service needs it to issue a token;
 * - the worker did not allow notifications;
 * - any other failure (e.g. offline when Expo's token service is called).
 *
 * The API stores the token with the device registration (PUT /devices/me)
 * and sends pushes through Expo's push service. Each push carries
 * `{ notificationId, type, timeEntryId?, shiftId?, calloutId?, assignmentId?, yearMonth? }`;
 * linking.ts turns that into the screen a tap opens.
 */

type Notifications = typeof NotificationsModule;

/** The Android channel every FieldMaster notification uses (Android 8+ shows notifications only through a channel). */
export const ANDROID_CHANNEL_ID = "default";

let loaded: Notifications | null | undefined;

/**
 * expo-notifications, loaded on first use: never on the web, and never in
 * Expo Go on Android (see above). Null where it is not used.
 */
export function loadNotifications(): Notifications | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS === "web" || (Platform.OS === "android" && isRunningInExpoGo())) {
    loaded = null;
    return loaded;
  }
  try {
    // Loaded lazily on purpose (see above).
    loaded = require("expo-notifications") as Notifications;
  } catch {
    loaded = null;
  }
  return loaded;
}

type NotificationsApi = Pick<
  Notifications,
  "getPermissionsAsync" | "requestPermissionsAsync" | "getExpoPushTokenAsync" | "setNotificationChannelAsync" | "setNotificationHandler"
>;

export interface PushEnvironment {
  os: string;
  /** False on a simulator / emulator. */
  isDevice: boolean;
  inExpoGo: boolean;
  projectId: string | null;
  /** Null where expo-notifications is not loaded (the web, Expo Go on Android). */
  notifications: NotificationsApi | null;
}

/** The EAS project id from app.json (`extra.eas.projectId`), or from the EAS build's own config. */
export function readEasProjectId(constants: Pick<typeof Constants, "expoConfig" | "easConfig"> = Constants): string | null {
  const fromExtra: unknown = (constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const id = typeof fromExtra === "string" && fromExtra !== "" ? fromExtra : constants.easConfig?.projectId;
  return typeof id === "string" && id !== "" ? id : null;
}

export function currentPushEnvironment(): PushEnvironment {
  return {
    os: Platform.OS,
    isDevice: Device.isDevice,
    inExpoGo: isRunningInExpoGo(),
    projectId: readEasProjectId(),
    notifications: loadNotifications(),
  };
}

/** Why there is no push token (for logs and tests; the worker is never blocked by it). */
export type PushUnavailableReason = "WEB" | "SIMULATOR" | "EXPO_GO_ANDROID" | "NO_PROJECT_ID" | "PERMISSION_DENIED" | "ERROR";

export interface PushTokenResult {
  token: string | null;
  reason: PushUnavailableReason | null;
}

const unavailable = (reason: PushUnavailableReason): PushTokenResult => ({ token: null, reason });

/** expo-notifications' AndroidImportance.HIGH (a heads-up notification with sound). */
const ANDROID_IMPORTANCE_HIGH = 6;

/** Creates (or updates) the Android channel. Safe to call repeatedly. */
export async function ensureAndroidChannel(env: PushEnvironment = currentPushEnvironment()): Promise<void> {
  if (env.os !== "android" || !env.notifications) return;
  await env.notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: messages.notifications.channelName,
    importance: ANDROID_IMPORTANCE_HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#1d4ed8",
  });
}

/**
 * The Expo push token for this phone, asking for permission once if needed.
 * Never throws: `token` is null with the reason when push is not possible.
 */
export async function resolvePushToken(env: PushEnvironment = currentPushEnvironment()): Promise<PushTokenResult> {
  if (env.os === "web") return unavailable("WEB");
  if (!env.isDevice) return unavailable("SIMULATOR");
  if (env.inExpoGo && env.os === "android") return unavailable("EXPO_GO_ANDROID");
  if (!env.projectId) return unavailable("NO_PROJECT_ID");
  const notifications = env.notifications;
  if (!notifications) return unavailable("ERROR");
  try {
    // Android 13+ shows the permission prompt only once a channel exists.
    await ensureAndroidChannel(env);
    let permission = await notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await notifications.requestPermissionsAsync();
    if (!permission.granted) return unavailable("PERMISSION_DENIED");
    const token = await notifications.getExpoPushTokenAsync({ projectId: env.projectId });
    return typeof token?.data === "string" && token.data !== "" ? { token: token.data, reason: null } : unavailable("ERROR");
  } catch {
    return unavailable("ERROR");
  }
}

export async function getPushToken(env: PushEnvironment = currentPushEnvironment()): Promise<string | null> {
  return (await resolvePushToken(env)).token;
}

/**
 * Shows notifications that arrive while the app is open (banner and list),
 * and creates the Android channel. Called once at app start; nothing on the
 * web or where the module is not loaded.
 */
export function configureNotificationHandling(env: PushEnvironment = currentPushEnvironment()): void {
  if (env.os === "web" || !env.notifications) return;
  try {
    env.notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  } catch {
    // The native module is missing (an unusual runtime): notifications simply are not shown in the foreground.
  }
  ensureAndroidChannel(env).catch(() => undefined);
}

const noop = () => undefined;

/** Calls `listener` when a notification arrives while the app is open (e.g. to refresh the unread count). */
export function addPushReceivedListener(listener: () => void, notifications: Notifications | null = loadNotifications()): () => void {
  if (!notifications) return noop;
  try {
    const subscription = notifications.addNotificationReceivedListener(() => listener());
    return () => subscription.remove();
  } catch {
    return noop;
  }
}

/** Taps already handled (the launch tap can be reported both at start and to the listener). */
const handledTaps = new Set<string>();

/** The data of a tapped notification (`{ notificationId, type, timeEntryId?, ... }`), once per tap; null otherwise. */
function tappedData(response: NotificationsModule.NotificationResponse | null | undefined, notifications: Notifications): Record<string, unknown> | null {
  if (!response || response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const request = response.notification?.request;
  const tapId = `${request?.identifier ?? ""}:${response.notification?.date ?? ""}`;
  if (handledTaps.has(tapId)) return null;
  handledTaps.add(tapId);
  const data = request?.content?.data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

/** Calls `listener` with the data of every notification the worker taps while the app runs. */
export function addPushTapListener(listener: (data: Record<string, unknown>) => void, notifications: Notifications | null = loadNotifications()): () => void {
  if (!notifications) return noop;
  try {
    const subscription = notifications.addNotificationResponseReceivedListener((response) => {
      const data = tappedData(response, notifications);
      if (data) listener(data);
    });
    return () => subscription.remove();
  } catch {
    return noop;
  }
}

/** The notification whose tap opened the app (cold start), once; null when there is none. */
export async function takeLaunchPushData(notifications: Notifications | null = loadNotifications()): Promise<Record<string, unknown> | null> {
  if (!notifications) return null;
  try {
    const data = tappedData(await notifications.getLastNotificationResponseAsync(), notifications);
    if (data) await notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    return data;
  } catch {
    return null;
  }
}
