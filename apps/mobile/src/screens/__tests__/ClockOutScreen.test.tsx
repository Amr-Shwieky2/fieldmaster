import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import { TaskCategory } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import { useAuth } from "../../lib/auth-context";
import { getDeviceId } from "../../lib/device-id";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { RootStackParamList } from "../../navigation/types";
import { ClockOutScreen } from "../ClockOutScreen";
import { deferred, doubleTap, expectArabicOnly, fill, freezeDate, renderInArabic } from "./clock-screens-test-utils";

jest.mock("../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: jest.fn() }));
jest.mock("../../lib/device-id", () => ({ getDeviceId: jest.fn() }));
// Every location call the screen makes is a mock this file controls (hasServicesEnabledAsync included).
jest.mock("expo-location", () => ({
  ...jest.requireActual("expo-location"),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));

type Navigation = NativeStackScreenProps<RootStackParamList, "ClockOut">["navigation"];

const POSITION: Location.LocationObject = {
  coords: { latitude: 32.0853, longitude: 34.7818, accuracy: 8, altitude: 41.5, altitudeAccuracy: null, heading: null, speed: null },
  timestamp: 0,
  mocked: false,
};
const GRANTED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" };
const DENIED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: "never" };
// Refused for good: the phone no longer shows the prompt.
const BLOCKED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: false, expires: "never" };

const GEOFENCE_ERROR = () =>
  new ApiRequestError(422, {
    statusCode: 422,
    code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
    message: "You are 184m from the site; the allowed radius is 100m.",
    details: { distanceMeters: 184, allowedRadiusMeters: 100 },
    correlationId: "corr-1",
  });
const GEOFENCE_TEXT = "أنت خارج نطاق الموقع. المسافة: 184 م، المسموح: 100 م.";

// 17:45 in Jerusalem (winter, UTC+2).
const NOW = "2026-01-15T15:45:00.000Z";
const SUMMARY = "  ركّبنا إشارتين جديدتين عند المفترق.  ";
const PROBLEMS = "  نقص في الكوابل.  ";

let clockOut: jest.Mock;
let queueOfflineEvent: jest.Mock;
let navigation: { navigate: jest.Mock; replace: jest.Mock; popTo: jest.Mock; goBack: jest.Mock };
let syncState: { isOnline: boolean; pendingCount: number };

beforeEach(() => {
  clockOut = jest.fn();
  queueOfflineEvent = jest.fn(async () => undefined);
  navigation = { navigate: jest.fn(), replace: jest.fn(), popTo: jest.fn(), goBack: jest.fn() };
  syncState = { isOnline: true, pendingCount: 0 };
  jest.mocked(useAuth).mockImplementation(() => ({ client: { clockOut } }) as unknown as ReturnType<typeof useAuth>);
  jest
    .mocked(useOfflineSync)
    .mockImplementation(() => ({ ...syncState, queue: [], queueOfflineEvent, syncNow: jest.fn() }) as unknown as ReturnType<typeof useOfflineSync>);
  jest.mocked(getDeviceId).mockResolvedValue("device-1");
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(GRANTED);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(POSITION);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest.mocked(Linking.openSettings).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

function renderScreen() {
  return renderInArabic(
    <ClockOutScreen navigation={navigation as unknown as Navigation} route={{ key: "ClockOut-1", name: "ClockOut", params: undefined }} />,
  );
}

const actionButton = () => screen.getByRole("button", { name: ar.clockOut.action });
const summaryInput = () => screen.getByLabelText(ar.clockOut.summaryLabel);
const problemsInput = () => screen.getByLabelText(ar.clockOut.problemsLabel);

async function fillSummary(summary = SUMMARY, problems?: string) {
  await fireEvent.changeText(summaryInput(), summary);
  if (problems !== undefined) await fireEvent.changeText(problemsInput(), problems);
}

const LOCATION_FIELDS = {
  latitude: 32.0853,
  longitude: 34.7818,
  accuracyMeters: 8,
  altitude: 41.5,
  locationProvider: "expo-location",
  mockLocationSuspected: false,
};

describe("ClockOutScreen (Arabic, RTL)", () => {
  it("shows the clock-out form in Arabic with every task category translated and \"other\" selected", async () => {
    await renderScreen();

    expect(screen.getByRole("header", { name: ar.clockOut.title })).toBeOnTheScreen();
    expect(screen.getByText(ar.clockOut.help)).toBeOnTheScreen();
    expect(screen.getByText(ar.clockOut.categoryLabel)).toBeOnTheScreen();
    expect(screen.getByText(ar.clockOut.summaryLabel)).toBeOnTheScreen();
    expect(screen.getByPlaceholderText(ar.clockOut.summaryPlaceholder)).toBeOnTheScreen();
    expect(screen.getByText(ar.clockOut.problemsLabel)).toBeOnTheScreen();
    expect(screen.getByPlaceholderText(ar.clockOut.problemsPlaceholder)).toBeOnTheScreen();

    const chips = screen.getAllByRole("radio");
    expect(chips).toHaveLength(Object.values(TaskCategory).length);
    for (const value of Object.values(TaskCategory)) {
      const chip = screen.getByRole("radio", { name: ar.enums.TaskCategory[value] });
      if (value === TaskCategory.OTHER) expect(chip).toBeChecked();
      else expect(chip).not.toBeChecked();
    }
    expect(screen.getByText("تركيب إشارات المرور")).toBeOnTheScreen();

    // The action stays enabled: pressing it with an empty summary explains what is missing.
    expect(actionButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: ar.common.cancel })).toBeEnabled();
    for (const text of [
      ar.clockOut.summaryRequired,
      ar.clockOut.permissionDenied,
      ar.clockOut.permissionSettings,
      ar.clockOut.locationServicesOff,
      ar.clockOut.locationUnavailable,
    ]) {
      expect(screen.queryByText(text)).not.toBeOnTheScreen();
    }
    // Online with nothing waiting: no connection banner.
    expect(screen.queryByRole("button", { name: ar.connection.openQueue })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("asks for the daily work summary when it is empty (or only spaces), without locating or calling the API", async () => {
    await renderScreen();

    await fireEvent.press(actionButton());
    expect(screen.getByText(ar.clockOut.summaryRequired)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.changeText(summaryInput(), "   ");
    await fireEvent.press(actionButton());
    expect(screen.getByText(ar.clockOut.summaryRequired)).toBeOnTheScreen();

    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(clockOut).not.toHaveBeenCalled();
    expect(queueOfflineEvent).not.toHaveBeenCalled();

    // Typing the summary clears the message.
    await fireEvent.changeText(summaryInput(), "عمل");
    expect(screen.queryByText(ar.clockOut.summaryRequired)).not.toBeOnTheScreen();
  });

  it("clocks out with the same payload as before (chosen category, trimmed texts) and shows a receipt with time, duration and approval note", async () => {
    const now = freezeDate(NOW);
    clockOut.mockResolvedValue({
      id: "te-1",
      status: "PENDING_APPROVAL",
      clockInAt: "2026-01-15T06:16:00.000Z",
      clockOutAt: "2026-01-15T15:46:00.000Z",
      rawDurationMinutes: 570,
    });
    await renderScreen();

    await fireEvent.press(screen.getByRole("radio", { name: ar.enums.TaskCategory.TRAFFIC_LIGHT_INSTALLATION }));
    expect(screen.getByRole("radio", { name: ar.enums.TaskCategory.TRAFFIC_LIGHT_INSTALLATION })).toBeChecked();
    expect(screen.getByRole("radio", { name: ar.enums.TaskCategory.OTHER })).not.toBeChecked();
    await fillSummary(SUMMARY, PROBLEMS);
    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.successTitle })).toBeOnTheScreen();
    const key = `clockout-${now}`;
    expect(clockOut).toHaveBeenCalledTimes(1);
    expect(clockOut).toHaveBeenCalledWith(
      {
        deviceId: "device-1",
        clientEventId: key,
        deviceTimestamp: NOW,
        ...LOCATION_FIELDS,
        origin: "ONLINE",
        summaryText: "ركّبنا إشارتين جديدتين عند المفترق.",
        taskCategory: "TRAFFIC_LIGHT_INSTALLATION",
        problemsEncountered: "نقص في الكوابل.",
      },
      key,
    );
    expect(queueOfflineEvent).not.toHaveBeenCalled();

    expect(screen.getByText("أنهيت دوامك الساعة 17:46.")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockOut.successBody, { time: "17:46" }))).toBeOnTheScreen();
    expect(screen.getByText("مدة الدوام: 9 س 30 د")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockOut.successDuration, { duration: "9 س 30 د" }))).toBeOnTheScreen();
    expect(screen.getByText(ar.clockOut.successPending)).toBeOnTheScreen();
    expect(screen.getByText("حضورك الآن بانتظار الموافقة من المدير.")).toBeOnTheScreen();
    expectArabicOnly();

    // The receipt stays until the worker taps the button: no silent navigation.
    expect(navigation.popTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: ar.clockOut.backHome }));
    // Back to the Home screen already in the stack, not a second copy of it.
    expect(navigation.popTo).toHaveBeenCalledWith("Home");
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("does not say the attendance waits for approval when the server already gives another status", async () => {
    clockOut.mockResolvedValue({ id: "te-1", status: "APPROVED", clockOutAt: "2026-01-15T15:46:00.000Z", rawDurationMinutes: 45 });
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.successTitle })).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockOut.successBody, { time: "17:46" }))).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockOut.successDuration, { duration: "0 س 45 د" }))).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockOut.successPending)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("sends no problems field when it is left empty, and falls back to the device time without a duration line", async () => {
    // 00:30 on 16 July in Jerusalem (summer, UTC+3).
    freezeDate("2026-07-15T21:30:00.000Z");
    clockOut.mockResolvedValue({});
    await renderScreen();

    await fillSummary("فحص الإشارات", "   ");
    await fireEvent.press(actionButton());

    expect(await screen.findByText(fill(ar.clockOut.successBody, { time: "00:30" }))).toBeOnTheScreen();
    expect(clockOut.mock.calls[0][0]).toMatchObject({ summaryText: "فحص الإشارات", taskCategory: "OTHER", problemsEncountered: undefined });
    expect(screen.queryByText(/مدة الدوام/)).not.toBeOnTheScreen();
    expect(screen.getByText(ar.clockOut.successPending)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows what it is doing while locating and submitting, and blocks cancel, the categories and the connection banner", async () => {
    // Online with records waiting: the banner is on screen during the whole attempt.
    syncState = { isOnline: true, pendingCount: 1 };
    const location = deferred<Location.LocationObject>();
    const request = deferred<unknown>();
    jest.mocked(Location.getCurrentPositionAsync).mockReturnValue(location.promise);
    clockOut.mockReturnValue(request.promise);
    await renderScreen();
    await fillSummary();

    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(actionButton());
    const locating = await screen.findByRole("button", { name: ar.clockOut.locating });
    expect(locating).toBeDisabled();
    expect(locating).toBeBusy();
    expect(screen.getByRole("button", { name: ar.common.cancel })).toBeDisabled();
    expect(screen.getByRole("radio", { name: ar.enums.TaskCategory.MAINTENANCE })).toBeDisabled();
    // Leaving for the offline queue mid-request is not possible.
    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expectArabicOnly();

    await act(async () => location.resolve(POSITION));
    const submitting = await screen.findByRole("button", { name: ar.clockOut.submitting });
    expect(submitting).toBeDisabled();
    expect(submitting).toBeBusy();
    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).not.toHaveBeenCalled();

    await act(async () => request.resolve({ clockOutAt: NOW, rawDurationMinutes: 90, status: "PENDING_APPROVAL" }));
    await pressing;
    expect(await screen.findByText(fill(ar.clockOut.successDuration, { duration: "1 س 30 د" }))).toBeOnTheScreen();
    expect(clockOut).toHaveBeenCalledTimes(1);
  });

  it("ignores a second tap that lands before the screen re-renders (double tap): one location request, one clock-out", async () => {
    clockOut.mockResolvedValue({ clockOutAt: NOW, rawDurationMinutes: 90, status: "PENDING_APPROVAL" });
    await renderScreen();
    await fillSummary();

    // The second tap reaches the handler before the button re-renders as busy.
    await doubleTap(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.successTitle })).toBeOnTheScreen();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expect(clockOut).toHaveBeenCalledTimes(1);
  });

  it("asks for location permission when it is denied, without calling the API", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(DENIED);
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockOut.permissionDenied)).toBeOnTheScreen();
    expect(screen.getByText("اسمح للتطبيق بالوصول إلى موقعك لتنهي الدوام.")).toBeOnTheScreen();
    // The phone will ask again on the next tap: no settings button.
    expect(screen.queryByRole("button", { name: ar.clockOut.openSettings })).not.toBeOnTheScreen();
    expect(clockOut).not.toHaveBeenCalled();
    expect(queueOfflineEvent).not.toHaveBeenCalled();
    expect(actionButton()).toBeEnabled();
    // What the worker typed is kept.
    expect(summaryInput()).toHaveDisplayValue(SUMMARY);
    expectArabicOnly();
  });

  it("offers to open the settings when the permission was refused for good, keeping what the worker typed", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(BLOCKED);
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockOut.permissionSettings)).toBeOnTheScreen();
    expect(screen.getByText("افتح الإعدادات واسمح للتطبيق بالوصول إلى موقعك، ثم حاول مرة أخرى.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockOut.permissionDenied)).not.toBeOnTheScreen();
    const settings = screen.getByRole("button", { name: ar.clockOut.openSettings });
    expect(screen.getByRole("button", { name: "فتح الإعدادات" })).toBe(settings);
    expect(summaryInput()).toHaveDisplayValue(SUMMARY);
    expect(clockOut).not.toHaveBeenCalled();
    expectArabicOnly();

    await fireEvent.press(settings);
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("says the GPS is switched off (not 'move to an open area') when the phone's location services are off", async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error("Location services are disabled"));
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockOut.locationServicesOff)).toBeOnTheScreen();
    expect(screen.getByText("خدمة الموقع (GPS) مغلقة في هاتفك. شغّلها ثم حاول مرة أخرى.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockOut.locationUnavailable)).not.toBeOnTheScreen();
    expect(clockOut).not.toHaveBeenCalled();
    expect(queueOfflineEvent).not.toHaveBeenCalled();
    // "GPS" is the one Latin word, inside the Arabic sentence.
    expectArabicOnly(["GPS"]);
  });

  it("says the GPS is switched off when iOS refuses the permission because location services are off", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(BLOCKED);
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockOut.locationServicesOff)).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockOut.permissionSettings)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.clockOut.openSettings })).not.toBeOnTheScreen();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(clockOut).not.toHaveBeenCalled();
    expectArabicOnly(["GPS"]);
  });

  it("says the location could not be found when the GPS is on but times out", async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error("Location request timed out"));
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockOut.locationUnavailable)).toBeOnTheScreen();
    expect(screen.getByText("تعذّر تحديد موقعك. انتقل إلى مكان مكشوف وحاول مرة أخرى.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockOut.locationServicesOff)).not.toBeOnTheScreen();
    expect(Location.hasServicesEnabledAsync).toHaveBeenCalled();
    expect(clockOut).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("says the location could not be found when the permission request itself fails", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockRejectedValue(new Error("Permission request failed"));
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockOut.locationUnavailable)).toBeOnTheScreen();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(clockOut).not.toHaveBeenCalled();
    expect(actionButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("shows the geofence rejection with the distance and the allowed radius (never the API's English message)", async () => {
    clockOut.mockRejectedValue(GEOFENCE_ERROR());
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(GEOFENCE_TEXT)).toBeOnTheScreen();
    expect(queueOfflineEvent).not.toHaveBeenCalled();
    expect(navigation.popTo).not.toHaveBeenCalled();
    expect(actionButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("clears the old error and shows the receipt when the next attempt succeeds", async () => {
    clockOut
      .mockRejectedValueOnce(GEOFENCE_ERROR())
      .mockResolvedValueOnce({ status: "PENDING_APPROVAL", clockOutAt: "2026-01-15T15:46:00.000Z", rawDurationMinutes: 570 });
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());
    expect(await screen.findByText(GEOFENCE_TEXT)).toBeOnTheScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.successTitle })).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockOut.successBody, { time: "17:46" }))).toBeOnTheScreen();
    expect(screen.queryByText(GEOFENCE_TEXT)).not.toBeOnTheScreen();
    expect(clockOut).toHaveBeenCalledTimes(2);
    expectArabicOnly();
  });

  it("shows the Arabic message for a known business error (no open clock-in)", async () => {
    clockOut.mockRejectedValue(
      new ApiRequestError(409, { statusCode: 409, code: "NO_ACTIVE_TIME_ENTRY", message: "No active time entry", correlationId: "corr-3" }),
    );
    await renderScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.errors.NO_ACTIVE_TIME_ENTRY)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("offline: queues the signed clock-out with its summary exactly as before and shows a saved-on-phone receipt with the time", async () => {
    const now = freezeDate(NOW);
    clockOut.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();

    await fireEvent.press(screen.getByRole("radio", { name: ar.enums.TaskCategory.MAINTENANCE }));
    await fillSummary(SUMMARY, PROBLEMS);
    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.queuedTitle })).toBeOnTheScreen();
    expect(queueOfflineEvent).toHaveBeenCalledTimes(1);
    expect(queueOfflineEvent).toHaveBeenCalledWith({
      clientEventId: `clockout-${now}`,
      eventType: "CLOCK_OUT",
      deviceTimestamp: NOW,
      ...LOCATION_FIELDS,
      summaryText: "ركّبنا إشارتين جديدتين عند المفترق.",
      taskCategory: "MAINTENANCE",
      problemsEncountered: "نقص في الكوابل.",
    });
    expect(screen.getByText(ar.clockOut.queuedBody)).toBeOnTheScreen();
    expect(screen.getByText("وقت التسجيل: 17:45")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockOut.queuedAt, { time: "17:45" }))).toBeOnTheScreen();
    expectArabicOnly();

    expect(navigation.popTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: ar.clockOut.backHome }));
    expect(navigation.popTo).toHaveBeenCalledWith("Home");
  });

  it("shows the offline banner while offline, which opens the offline queue", async () => {
    syncState = { isOnline: false, pendingCount: 0 };
    await renderScreen();

    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offlineHint)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).toHaveBeenCalledWith("OfflineQueue");
  });

  it("shows the syncing banner with the waiting count while online with records waiting", async () => {
    syncState = { isOnline: true, pendingCount: 2 };
    await renderScreen();

    expect(screen.getByText(ar.connection.syncing)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.connection.pending, { count: "2" }))).toBeOnTheScreen();
    expect(screen.getByText("بانتظار المزامنة: 2")).toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.offline)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.offlineHint)).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).toHaveBeenCalledWith("OfflineQueue");
  });

  it("goes back when the worker cancels", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByRole("button", { name: ar.common.cancel }));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(clockOut).not.toHaveBeenCalled();
  });
});
