/**
 * jest: a small fake of expo-notifications (the real module warns about Expo
 * Go as soon as it is imported under jest-expo, and its listeners need
 * native events). Tests drive it through `notificationsMock`: deliver a
 * notification while the app runs, tap one, or set the one that launched the
 * app. Call `notificationsMock.reset()` in `beforeEach` when a test uses it.
 * Registered in jest.setup.ts.
 */

type Listener = (event: unknown) => void;

const received = new Set<Listener>();
const responses = new Set<Listener>();
let lastResponse: unknown = null;

export const DEFAULT_ACTION_IDENTIFIER = "expo.modules.notifications.actions.DEFAULT";

export const AndroidImportance = { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 } as const;

/** A tap on a notification carrying `data` (as expo-notifications reports it). */
export function tapResponse(data: Record<string, unknown>, identifier = `n-${Math.random().toString(36).slice(2)}`) {
  return {
    actionIdentifier: DEFAULT_ACTION_IDENTIFIER,
    notification: { date: Date.now(), request: { identifier, content: { title: null, subtitle: null, body: null, data }, trigger: null } },
  };
}

export const notificationsMock = {
  /** A notification arrives while the app is open. */
  receive(data: Record<string, unknown> = {}) {
    for (const listener of [...received]) listener(tapResponse(data).notification);
  },
  /** The worker taps a notification while the app runs. */
  tap(data: Record<string, unknown>) {
    for (const listener of [...responses]) listener(tapResponse(data));
  },
  /** The notification whose tap started the app. */
  setLaunchTap(data: Record<string, unknown> | null) {
    lastResponse = data ? tapResponse(data) : null;
  },
  listenerCount() {
    return { received: received.size, responses: responses.size };
  },
  reset() {
    received.clear();
    responses.clear();
    lastResponse = null;
  },
};

export const addNotificationReceivedListener = jest.fn((listener: Listener) => {
  received.add(listener);
  return { remove: () => received.delete(listener) };
});

export const addNotificationResponseReceivedListener = jest.fn((listener: Listener) => {
  responses.add(listener);
  return { remove: () => responses.delete(listener) };
});

export const getLastNotificationResponseAsync = jest.fn(async () => lastResponse);
export const clearLastNotificationResponseAsync = jest.fn(async () => {
  lastResponse = null;
});

export const getPermissionsAsync = jest.fn(async () => ({ granted: true, canAskAgain: true, status: "granted", expires: "never" }));
export const requestPermissionsAsync = jest.fn(async () => ({ granted: true, canAskAgain: true, status: "granted", expires: "never" }));
export const getExpoPushTokenAsync = jest.fn(async () => ({ type: "expo", data: "ExponentPushToken[jest]" }));
export const setNotificationChannelAsync = jest.fn(async () => null);
export const setNotificationHandler = jest.fn();
