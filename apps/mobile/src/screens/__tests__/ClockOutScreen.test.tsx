import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator } from "expo-image-manipulator";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import { TaskCategory } from "@fieldmaster/shared-types";
import { audioMock } from "../../../jest/expo-audio-mock";
import ar from "../../i18n/messages";
import { useAuth } from "../../lib/auth-context";
import { getDeviceId } from "../../lib/device-id";
import { resetLocationHistory } from "../../lib/location";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { RootStackParamList } from "../../navigation/types";
import { ClockOutScreen } from "../ClockOutScreen";
import { deferred, doubleTap, expectArabicOnly, fill, freezeDate, receiptReference, renderInArabic } from "./clock-screens-test-utils";

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
// Step 9 photos: the gallery and the compression are fakes the photo test drives.
jest.mock("expo-image-picker", () => ({ ...jest.requireActual("expo-image-picker"), launchImageLibraryAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn() }));
jest.mock("expo-image-manipulator", () => ({ ...jest.requireActual("expo-image-manipulator"), ImageManipulator: { manipulate: jest.fn() } }));

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
  resetLocationHistory();
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
      ar.clock.summaryRequired,
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
    expect(screen.getByText(ar.clock.summaryRequired)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.changeText(summaryInput(), "   ");
    await fireEvent.press(actionButton());
    expect(screen.getByText(ar.clock.summaryRequired)).toBeOnTheScreen();

    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(clockOut).not.toHaveBeenCalled();
    expect(queueOfflineEvent).not.toHaveBeenCalled();

    // Typing the summary clears the message.
    await fireEvent.changeText(summaryInput(), "عمل");
    expect(screen.queryByText(ar.clock.summaryRequired)).not.toBeOnTheScreen();
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
        summarySource: "TYPED",
        taskCategory: "TRAFFIC_LIGHT_INSTALLATION",
        problemsEncountered: "نقص في الكوابل.",
        // Step 9: iOS (the test platform) cannot tell a mocked location: UNAVAILABLE, never "not detected".
        mockLocationState: "UNAVAILABLE",
        locationSignals: [],
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
    expectArabicOnly([receiptReference()]);

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
    expectArabicOnly([receiptReference()]);
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
    expectArabicOnly([receiptReference()]);
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
    expectArabicOnly([receiptReference()]);
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

  it("offline: queues the signed clock-out with its summary as before (plus the phone's mock-location state) and shows a saved-on-phone receipt with the time", async () => {
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
      // Step 9: signed with the event (the server verifies it); the movement signals are not part of a queued event.
      mockLocationState: "UNAVAILABLE",
      summaryText: "ركّبنا إشارتين جديدتين عند المفترق.",
      taskCategory: "MAINTENANCE",
      problemsEncountered: "نقص في الكوابل.",
    });
    expect(screen.getByText(ar.clockOut.queuedBody)).toBeOnTheScreen();
    expect(screen.getByText("وقت التسجيل: 17:45")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockOut.queuedAt, { time: "17:45" }))).toBeOnTheScreen();
    expect(receiptReference()).toBe(`clockout-${now}`);
    expectArabicOnly([receiptReference()]);

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

// ── Step 9: the summary by voice, the follow-up flag, photos and the receipt ──

describe("ClockOutScreen: voice summary, follow-up, photos and the receipt (Step 9)", () => {
  const TRANSCRIPT = "ركبنا اشارتين جديدتين عند المفترق";
  const EDITED = "ركّبنا إشارتين جديدتين عند المفترق.";
  let uploadAttachment: jest.Mock;
  let transcribeVoiceNote: jest.Mock;

  beforeEach(() => {
    audioMock.reset();
    uploadAttachment = jest.fn(async (purpose: string) => ({ fileAssetId: purpose === "VOICE_SUMMARY" ? "voice-1" : "photo-1", purpose, contentType: "audio/mp4", sizeBytes: 1000 }));
    transcribeVoiceNote = jest.fn(async () => ({ fileAssetId: "voice-1", text: TRANSCRIPT, provider: "mock", language: "ar" }));
    jest.mocked(useAuth).mockImplementation(() => ({ client: { clockOut, uploadAttachment, transcribeVoiceNote } }) as unknown as ReturnType<typeof useAuth>);
  });

  const voiceTab = () => screen.getByRole("tab", { name: ar.clock.summaryVoice });
  const typedTab = () => screen.getByRole("tab", { name: ar.clock.summaryTyped });

  /** Records 42 s, stops, and waits for the upload and the transcript. */
  async function recordVoice() {
    await fireEvent.press(voiceTab());
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.start }));
    await act(async () => audioMock.setRecordingDuration(42_000));
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));
  }

  it("offers the summary typed or by voice, typed first", async () => {
    await renderScreen();
    expect(typedTab()).toBeSelected();
    expect(voiceTab()).not.toBeSelected();
    expect(screen.getByLabelText(ar.clockOut.summaryLabel)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.voice.start })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("by voice: records, uploads, transcribes; the worker edits the text, which is sent as VOICE with the voice note and the raw transcript", async () => {
    const now = freezeDate(NOW);
    clockOut.mockResolvedValue({ status: "PENDING_APPROVAL", clockOutAt: NOW, rawDurationMinutes: 480 });
    await renderScreen();
    await recordVoice();

    const transcriptInput = await screen.findByLabelText(ar.clock.voiceTextLabel);
    expect(transcriptInput).toHaveDisplayValue(TRANSCRIPT);
    expect(uploadAttachment).toHaveBeenCalledWith("VOICE_SUMMARY", { uri: "file:///cache/voice-summary.m4a", name: "voice-summary.m4a", type: "audio/mp4" }, "voice-summary.m4a");
    expect(transcribeVoiceNote).toHaveBeenCalledWith("voice-1");
    expectArabicOnly();

    await fireEvent.changeText(transcriptInput, `  ${EDITED}  `);
    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.successTitle })).toBeOnTheScreen();
    const key = `clockout-${now}`;
    expect(clockOut).toHaveBeenCalledWith(
      {
        deviceId: "device-1",
        clientEventId: key,
        deviceTimestamp: NOW,
        ...LOCATION_FIELDS,
        origin: "ONLINE",
        summaryText: EDITED,
        summarySource: "VOICE",
        voiceNoteAssetId: "voice-1",
        transcription: TRANSCRIPT,
        taskCategory: "OTHER",
        problemsEncountered: undefined,
        mockLocationState: "UNAVAILABLE",
        locationSignals: [],
      },
      key,
    );
  });

  it("switching to typing and back keeps the recording and its edited text", async () => {
    await renderScreen();
    await recordVoice();
    const transcriptInput = await screen.findByLabelText(ar.clock.voiceTextLabel);
    await fireEvent.changeText(transcriptInput, EDITED);

    await fireEvent.press(typedTab());
    expect(screen.queryByLabelText(ar.clock.voiceTextLabel)).not.toBeOnTheScreen();
    expect(screen.getByLabelText(ar.clockOut.summaryLabel)).toBeOnTheScreen();

    await fireEvent.press(voiceTab());
    expect(screen.getByLabelText(ar.clock.voiceTextLabel)).toHaveDisplayValue(EDITED);
    expect(screen.getByRole("button", { name: ar.voice.discard })).toBeOnTheScreen();
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it("by voice without a transcript (transcription unavailable): the voice note alone is the summary", async () => {
    transcribeVoiceNote.mockRejectedValue(new ApiRequestError(503, { statusCode: 503, code: "TRANSCRIPTION_UNAVAILABLE", message: "No provider", correlationId: "c" }));
    clockOut.mockResolvedValue({ status: "PENDING_APPROVAL", clockOutAt: NOW });
    await renderScreen();
    await recordVoice();

    expect(await screen.findByText(ar.voice.transcriptionUnavailable)).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.clock.voiceTextLabel)).toHaveDisplayValue("");
    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.successTitle })).toBeOnTheScreen();
    const body = clockOut.mock.calls[0][0];
    expect(body).toMatchObject({ summarySource: "VOICE", voiceNoteAssetId: "voice-1" });
    expect(body.summaryText).toBeUndefined();
    expect(body.transcription).toBeUndefined();
  });

  it("neither typed nor recorded: a clear Arabic error before sending, in both modes", async () => {
    await renderScreen();
    await fireEvent.press(actionButton());
    expect(screen.getByText(ar.clock.summaryRequired)).toBeOnTheScreen();
    expect(screen.getByText("ملخص العمل اليومي مطلوب: يُرجى كتابته أو تسجيله بالصوت.")).toBeOnTheScreen();

    await fireEvent.press(voiceTab());
    await fireEvent.press(actionButton());
    expect(screen.getByText(ar.clock.summaryRequired)).toBeOnTheScreen();
    expect(clockOut).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("asks to wait while the recording is still being prepared", async () => {
    const upload = deferred<unknown>();
    uploadAttachment.mockReturnValueOnce(upload.promise);
    await renderScreen();
    await fireEvent.press(voiceTab());
    await fireEvent.press(screen.getByRole("button", { name: ar.voice.start }));
    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const stopping = fireEvent.press(screen.getByRole("button", { name: ar.voice.stop }));
    await screen.findByText(ar.voice.uploading);

    await fireEvent.press(actionButton());
    expect(screen.getByText(ar.clock.voiceBusy)).toBeOnTheScreen();
    expect(clockOut).not.toHaveBeenCalled();

    await act(async () => upload.resolve({ fileAssetId: "voice-1" }));
    await stopping;
  });

  it("shows the server's SUMMARY_REQUIRED as the same Arabic message, next to the summary", async () => {
    clockOut.mockRejectedValue(new ApiRequestError(400, { statusCode: 400, code: "SUMMARY_REQUIRED", message: "A task summary is required", correlationId: "c" }));
    await renderScreen();
    await fillSummary();
    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clock.summaryRequired)).toBeOnTheScreen();
    expect(screen.queryByText(/task summary/)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.errors.SUMMARY_REQUIRED)).not.toBeOnTheScreen();
  });

  it("sends followUpRequired only when the follow-up switch is on (online and in the offline queue)", async () => {
    clockOut.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await fillSummary();
    const toggle = screen.getByRole("switch", { name: ar.clock.followUp });
    expect(toggle).not.toBeChecked();
    await fireEvent(toggle, "valueChange", true);
    expect(screen.getByRole("switch", { name: ar.clock.followUp })).toBeChecked();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.queuedTitle })).toBeOnTheScreen();
    expect(clockOut.mock.calls[0][0]).toMatchObject({ followUpRequired: true, summarySource: "TYPED" });
    expect(queueOfflineEvent.mock.calls[0][0]).toMatchObject({ followUpRequired: true, summaryText: "ركّبنا إشارتين جديدتين عند المفترق." });
  });

  it("offline: recording is switched off with a notice, and the typed summary still saves on the phone", async () => {
    syncState = { isOnline: false, pendingCount: 0 };
    clockOut.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();

    expect(voiceTab()).toBeDisabled();
    expect(screen.getByText(ar.photos.offline)).toBeOnTheScreen();
    await fillSummary();
    await fireEvent.press(actionButton());
    expect(await screen.findByRole("header", { name: ar.clockOut.queuedTitle })).toBeOnTheScreen();
    expect(queueOfflineEvent).toHaveBeenCalledTimes(1);
  });

  it("offline at sending time in voice mode: the edited text is queued as the summary, without the voice note", async () => {
    const now = freezeDate(NOW);
    clockOut.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await recordVoice();
    await fireEvent.changeText(await screen.findByLabelText(ar.clock.voiceTextLabel), EDITED);
    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockOut.queuedTitle })).toBeOnTheScreen();
    // The signed event takes no file references: only the text.
    expect(queueOfflineEvent).toHaveBeenCalledWith({
      clientEventId: `clockout-${now}`,
      eventType: "CLOCK_OUT",
      deviceTimestamp: NOW,
      ...LOCATION_FIELDS,
      mockLocationState: "UNAVAILABLE",
      summaryText: EDITED,
      taskCategory: "OTHER",
      problemsEncountered: undefined,
    });
    expect(screen.getByText(ar.clock.voiceNotSent)).toBeOnTheScreen();
    expectArabicOnly([receiptReference()]);
  });

  it("offline at sending time in voice mode without any text: asks to type it, and saves nothing", async () => {
    transcribeVoiceNote.mockRejectedValue(new ApiRequestError(503, { statusCode: 503, code: "TRANSCRIPTION_UNAVAILABLE", message: "No provider", correlationId: "c" }));
    clockOut.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await recordVoice();
    await screen.findByText(ar.voice.transcriptionUnavailable);

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clock.offlineVoice)).toBeOnTheScreen();
    expect(queueOfflineEvent).not.toHaveBeenCalled();
    // Back to typing, so the worker can write the summary and save it on the phone.
    expect(typedTab()).toBeSelected();
    expect(screen.getByLabelText(ar.clockOut.summaryLabel)).toBeOnTheScreen();
  });

  it("uploads the compressed photos (ATTENDANCE_PHOTO) and sends their ids with the clock-out", async () => {
    let compressed = 0;
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: "file:///picker/a.jpg", width: 4032, height: 3024 }] });
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
      const context = {
        resize: jest.fn(),
        renderAsync: jest.fn(async () => ({ saveAsync: jest.fn(async () => ({ uri: `file:///cache/out-${++compressed}.jpg`, width: 1600, height: 1200 })), release: jest.fn() })),
        release: jest.fn(),
      };
      context.resize.mockReturnValue(context);
      return context as never;
    });
    clockOut.mockResolvedValue({ status: "PENDING_APPROVAL", clockOutAt: NOW });
    await renderScreen();
    await fireEvent.press(screen.getByRole("button", { name: ar.photos.pickFromGallery }));
    expect(await screen.findByText(fill(ar.photos.count, { count: "1", max: "5" }))).toBeOnTheScreen();
    await fillSummary();

    await fireEvent.press(actionButton());

    await screen.findByRole("header", { name: ar.clockOut.successTitle });
    expect(uploadAttachment).toHaveBeenCalledWith("ATTENDANCE_PHOTO", { uri: "file:///cache/out-1.jpg", name: "photo-1.jpg", type: "image/jpeg" }, "photo-1.jpg");
    expect(clockOut.mock.calls[0][0]).toMatchObject({ photoAssetIds: ["photo-1"], summarySource: "TYPED" });
  });

  it("sends no photo field without photos", async () => {
    clockOut.mockResolvedValue({ status: "PENDING_APPROVAL", clockOutAt: NOW });
    await renderScreen();
    await fillSummary();
    await fireEvent.press(actionButton());
    await screen.findByRole("header", { name: ar.clockOut.successTitle });
    expect(clockOut.mock.calls[0][0]).not.toHaveProperty("photoAssetIds");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("acts only as the signed-in worker: no worker id is ever sent, only the caller's own endpoints are used", async () => {
    clockOut.mockResolvedValue({ status: "PENDING_APPROVAL", clockOutAt: NOW });
    await renderScreen();
    await recordVoice();
    await screen.findByLabelText(ar.clock.voiceTextLabel);
    await fireEvent.press(actionButton());
    await screen.findByRole("header", { name: ar.clockOut.successTitle });

    expect(JSON.stringify([...clockOut.mock.calls, ...uploadAttachment.mock.calls, ...transcribeVoiceNote.mock.calls])).not.toContain("workerProfileId");
    // The transcription is asked for the caller's own upload only.
    expect(transcribeVoiceNote).toHaveBeenCalledWith("voice-1");
  });

  it("titles the receipt with the shift from the server's answer when Home gave none (an emergency by its Arabic type)", async () => {
    clockOut.mockResolvedValue({ status: "PENDING_APPROVAL", clockOutAt: NOW, shift: { id: "s-9", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" }, clockEvent: { id: "ce-9" } });
    await renderScreen();
    await fillSummary();
    await fireEvent.press(actionButton());
    await screen.findByRole("header", { name: ar.clockOut.successTitle });

    expect(screen.getByTestId("receipt-shift")).toHaveTextContent(ar.enums.ShiftType.EMERGENCY_CALLOUT);
    expect(screen.queryByText("Emergency Call-out")).not.toBeOnTheScreen();
    expect(receiptReference()).toBe("ce-9");
    expectArabicOnly([receiptReference()]);
  });

  it("shows the shift being ended (from Home) on the form and the receipt, with the clock-out receipt fields", async () => {
    freezeDate(NOW);
    clockOut.mockResolvedValue({
      id: "te-1",
      status: "PENDING_APPROVAL",
      clockOutAt: "2026-01-15T15:45:03.000Z",
      rawDurationMinutes: 570,
      clockEvents: [
        { id: "ce-in", clientEventId: "clockin-shift-1-1" },
        { id: "ce-out", clientEventId: `clockout-${new Date(NOW).getTime()}` },
      ],
    });
    await renderInArabic(
      <ClockOutScreen navigation={navigation as unknown as Navigation} route={{ key: "ClockOut-1", name: "ClockOut", params: { shiftTitle: "صيانة إشارات شارع هرتسل" } }} />,
    );
    expect(screen.getByText("صيانة إشارات شارع هرتسل")).toBeOnTheScreen();
    await fillSummary();
    await fireEvent.press(actionButton());
    await screen.findByRole("header", { name: ar.clockOut.successTitle });

    const value = (testID: string) => {
      const texts = within(screen.getByTestId(testID)).getAllByText(/./);
      return texts[texts.length - 1].props.children as string;
    };
    expect(screen.getByTestId("receipt-shift")).toHaveTextContent("صيانة إشارات شارع هرتسل");
    expect(value("receipt-action")).toBe("إنهاء الدوام");
    expect(value("receipt-server-time")).toBe("15 يناير 2026 في 17:45");
    expect(value("receipt-device-time")).toBe("15 يناير 2026 في 17:45");
    expect(value("receipt-sync-state")).toBe("تمت المزامنة");
    // The clock event id when the answer has it; otherwise the client event id stored on that event.
    expect(receiptReference()).toBe("ce-out");
  });
});
