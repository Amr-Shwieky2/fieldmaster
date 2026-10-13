import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import ar from "../../i18n/messages";
import {
  ANDROID_CHANNEL_ID,
  addPushReceivedListener,
  addPushTapListener,
  configureNotificationHandling,
  ensureAndroidChannel,
  getPushToken,
  readEasProjectId,
  resolvePushToken,
  takeLaunchPushData,
  type PushEnvironment,
} from "../push";
import { notificationsMock } from "../../../jest/expo-notifications-mock";

const TOKEN = "ExponentPushToken[xyz]";

function permission(granted: boolean, canAskAgain = true) {
  return { granted, canAskAgain, status: granted ? "granted" : "denied", expires: "never" } as unknown as Notifications.NotificationPermissionsStatus;
}

function environment(overrides: Partial<PushEnvironment> = {}, api: Partial<Record<keyof PushEnvironment["notifications"], jest.Mock>> = {}) {
  const notifications = {
    getPermissionsAsync: jest.fn(async () => permission(true)),
    requestPermissionsAsync: jest.fn(async () => permission(true)),
    getExpoPushTokenAsync: jest.fn(async () => ({ type: "expo", data: TOKEN })),
    setNotificationChannelAsync: jest.fn(async () => null),
    setNotificationHandler: jest.fn(),
    ...api,
  };
  const env: PushEnvironment = {
    os: "ios",
    isDevice: true,
    inExpoGo: false,
    projectId: "11111111-2222-3333-4444-555555555555",
    notifications: notifications as unknown as PushEnvironment["notifications"],
    ...overrides,
  };
  return { env, notifications };
}

describe("push token", () => {
  it("returns the Expo push token for this project on a real phone that allows notifications", async () => {
    const { env, notifications } = environment();
    expect(await resolvePushToken(env)).toEqual({ token: TOKEN, reason: null });
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: env.projectId });
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("asks for permission once when it was not decided yet", async () => {
    const { env, notifications } = environment({}, { getPermissionsAsync: jest.fn(async () => permission(false, true)) });
    expect(await getPushToken(env)).toBe(TOKEN);
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the web target", { os: "web" }, "WEB"],
    ["a simulator or emulator", { isDevice: false }, "SIMULATOR"],
    ["Expo Go on Android (remote push was removed in SDK 53)", { os: "android", inExpoGo: true }, "EXPO_GO_ANDROID"],
    ["no EAS projectId (eas init was not run)", { projectId: null }, "NO_PROJECT_ID"],
  ] as const)("is null, without any prompt, on %s", async (_label, overrides, reason) => {
    const { env, notifications } = environment(overrides);
    expect(await resolvePushToken(env)).toEqual({ token: null, reason });
    expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("works in Expo Go on an iPhone (given a projectId)", async () => {
    const { env } = environment({ inExpoGo: true, os: "ios" });
    expect(await getPushToken(env)).toBe(TOKEN);
  });

  it("is null when the worker does not allow notifications (and does not ask again once refused for good)", async () => {
    const denied = environment({}, { getPermissionsAsync: jest.fn(async () => permission(false, true)), requestPermissionsAsync: jest.fn(async () => permission(false, false)) });
    expect(await resolvePushToken(denied.env)).toEqual({ token: null, reason: "PERMISSION_DENIED" });

    const blocked = environment({}, { getPermissionsAsync: jest.fn(async () => permission(false, false)) });
    expect(await resolvePushToken(blocked.env)).toEqual({ token: null, reason: "PERMISSION_DENIED" });
    expect(blocked.notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("is null, never an error, when Expo's token service fails (e.g. offline)", async () => {
    const { env } = environment({}, { getExpoPushTokenAsync: jest.fn(async () => Promise.reject(new Error("ERR_NOTIFICATIONS_NETWORK_ERROR"))) });
    expect(await resolvePushToken(env)).toEqual({ token: null, reason: "ERROR" });
  });

  it("creates the Android channel (Arabic name, high importance) before asking for permission", async () => {
    const order: string[] = [];
    const { env, notifications } = environment(
      { os: "android" },
      {
        setNotificationChannelAsync: jest.fn(async () => {
          order.push("channel");
          return null;
        }),
        getPermissionsAsync: jest.fn(async () => {
          order.push("permission");
          return permission(true);
        }),
      },
    );
    expect(await getPushToken(env)).toBe(TOKEN);
    expect(order).toEqual(["channel", "permission"]);
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      ANDROID_CHANNEL_ID,
      expect.objectContaining({ name: ar.notifications.channelName, importance: Notifications.AndroidImportance.HIGH }),
    );
    expect(ar.notifications.channelName).toMatch(/[ء-ي]/);
  });

  it("is null when expo-notifications could not be loaded", async () => {
    const { env } = environment({ notifications: null });
    expect(await resolvePushToken(env)).toEqual({ token: null, reason: "ERROR" });
  });

  it("creates no channel on iOS", async () => {
    const { env, notifications } = environment();
    await ensureAndroidChannel(env);
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});

describe("notification handling", () => {
  it("shows notifications that arrive while the app is open (iOS / Android), and does nothing on the web", async () => {
    const native = environment({ os: "android" });
    configureNotificationHandling(native.env);
    expect(native.notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = native.notifications.setNotificationHandler.mock.calls[0][0] as Notifications.NotificationHandler;
    expect(await handler.handleNotification({} as Notifications.Notification)).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
    expect(native.notifications.setNotificationChannelAsync).toHaveBeenCalled();

    const web = environment({ os: "web" });
    configureNotificationHandling(web.env);
    expect(web.notifications.setNotificationHandler).not.toHaveBeenCalled();
  });
});

describe("taps and arrivals", () => {
  beforeEach(() => notificationsMock.reset());

  it("reports each tapped notification's data once, and ignores other actions", () => {
    const listener = jest.fn();
    const remove = addPushTapListener(listener, Notifications);
    notificationsMock.tap({ notificationId: "n1", type: "SHIFT_APPROVED", timeEntryId: "te-1" });
    expect(listener).toHaveBeenCalledWith({ notificationId: "n1", type: "SHIFT_APPROVED", timeEntryId: "te-1" });
    remove();
    notificationsMock.tap({ notificationId: "n2" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hands over the tap that started the app once", async () => {
    notificationsMock.setLaunchTap({ notificationId: "n1", type: "PAYROLL_FINALIZED", yearMonth: "2026-09" });
    expect(await takeLaunchPushData(Notifications)).toEqual({ notificationId: "n1", type: "PAYROLL_FINALIZED", yearMonth: "2026-09" });
    expect(await takeLaunchPushData(Notifications)).toBeNull();
  });

  it("tells when a notification arrives while the app is open", () => {
    const listener = jest.fn();
    const remove = addPushReceivedListener(listener, Notifications);
    notificationsMock.receive({ notificationId: "n1" });
    expect(listener).toHaveBeenCalledTimes(1);
    remove();
    expect(notificationsMock.listenerCount().received).toBe(0);
  });

  it("does nothing where expo-notifications is not loaded (the web, Expo Go on Android)", async () => {
    expect(addPushTapListener(jest.fn(), null)()).toBeUndefined();
    expect(addPushReceivedListener(jest.fn(), null)()).toBeUndefined();
    expect(await takeLaunchPushData(null)).toBeNull();
  });

  it.each([
    ["web", false],
    ["android", false],
    ["ios", true],
  ] as const)("loads expo-notifications on %s inside Expo Go: %s", (os, expected) => {
    jest.isolateModules(() => {
      jest.replaceProperty(Platform, "OS", os);
      // jest-expo reports Expo Go (isRunningInExpoGo() is true here), like a phone running Expo Go.
      const { loadNotifications } = jest.requireActual("../push") as typeof import("../push");
      expect(loadNotifications() !== null).toBe(expected);
    });
  });
});

describe("EAS projectId", () => {
  it("comes from app.json's extra.eas.projectId, or the EAS build's config, and is null otherwise", () => {
    expect(readEasProjectId({ expoConfig: { extra: { eas: { projectId: "from-extra" } } }, easConfig: null } as never)).toBe("from-extra");
    expect(readEasProjectId({ expoConfig: { extra: {} }, easConfig: { projectId: "from-eas" } } as never)).toBe("from-eas");
    expect(readEasProjectId({ expoConfig: { extra: { eas: { projectId: "" } } }, easConfig: null } as never)).toBeNull();
    expect(readEasProjectId({ expoConfig: null, easConfig: null } as never)).toBeNull();
  });
});
