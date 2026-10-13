import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator } from "expo-image-manipulator";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, Platform } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import { useAuth } from "../../lib/auth-context";
import { getDeviceId } from "../../lib/device-id";
import { resetLocationHistory } from "../../lib/location";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { RootStackParamList } from "../../navigation/types";
import { ClockInScreen } from "../ClockInScreen";
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
// Step 9 photos: the gallery and the compression are fakes the photo tests drive.
jest.mock("expo-image-picker", () => ({ ...jest.requireActual("expo-image-picker"), launchImageLibraryAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn() }));
jest.mock("expo-image-manipulator", () => ({ ...jest.requireActual("expo-image-manipulator"), ImageManipulator: { manipulate: jest.fn() } }));

type Navigation = NativeStackScreenProps<RootStackParamList, "ClockIn">["navigation"];

const SHIFT_TITLE = "صيانة إشارات شارع هرتسل";
const POSITION: Location.LocationObject = {
  coords: { latitude: 32.0853, longitude: 34.7818, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
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

// 10:30 in Jerusalem (winter, UTC+2).
const NOW = "2026-01-15T08:30:00.000Z";

let clockIn: jest.Mock;
let queueOfflineEvent: jest.Mock;
let navigation: { navigate: jest.Mock; replace: jest.Mock; popTo: jest.Mock; goBack: jest.Mock };
let syncState: { isOnline: boolean; pendingCount: number };

beforeEach(() => {
  clockIn = jest.fn();
  queueOfflineEvent = jest.fn(async () => undefined);
  navigation = { navigate: jest.fn(), replace: jest.fn(), popTo: jest.fn(), goBack: jest.fn() };
  syncState = { isOnline: true, pendingCount: 0 };
  jest.mocked(useAuth).mockImplementation(() => ({ client: { clockIn } }) as unknown as ReturnType<typeof useAuth>);
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

function renderScreen(shiftTitle = SHIFT_TITLE) {
  return renderInArabic(
    <ClockInScreen
      navigation={navigation as unknown as Navigation}
      route={{ key: "ClockIn-1", name: "ClockIn", params: { shiftId: "shift-1", shiftTitle } }}
    />,
  );
}

const actionButton = () => screen.getByRole("button", { name: ar.clockIn.action });

/** None of the failure messages is on screen. */
function expectNoFailure() {
  for (const text of [
    ar.clockIn.permissionDenied,
    ar.clockIn.permissionSettings,
    ar.clockIn.locationServicesOff,
    ar.clockIn.locationUnavailable,
    GEOFENCE_TEXT,
    ar.errors.INTERNAL_ERROR,
  ]) {
    expect(screen.queryByText(text)).not.toBeOnTheScreen();
  }
  expect(screen.queryByRole("button", { name: ar.clockIn.openSettings })).not.toBeOnTheScreen();
}

function expectedOnlinePayload(now: number) {
  const key = `clockin-shift-1-${now}`;
  return {
    key,
    body: {
      shiftId: "shift-1",
      deviceId: "device-1",
      clientEventId: key,
      deviceTimestamp: new Date(now).toISOString(),
      latitude: 32.0853,
      longitude: 34.7818,
      accuracyMeters: 8,
      altitude: undefined,
      locationProvider: "expo-location",
      mockLocationSuspected: false,
      origin: "ONLINE",
      // Step 9: iOS (the test platform) cannot tell a mocked location: UNAVAILABLE, never "not detected".
      mockLocationState: "UNAVAILABLE",
      locationSignals: [],
    },
  };
}

describe("ClockInScreen (Arabic, RTL)", () => {
  it("shows the clock-in form in Arabic: title, shift, help, action and cancel", async () => {
    await renderScreen();

    expect(screen.getByRole("header", { name: ar.clockIn.title })).toBeOnTheScreen();
    expect(screen.getByText(SHIFT_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(ar.clockIn.help)).toBeOnTheScreen();
    expect(screen.getByText("سنتحقق من موقعك. تأكد أنك داخل نطاق الموقع قبل بدء الدوام.")).toBeOnTheScreen();
    expect(actionButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: ar.common.cancel })).toBeEnabled();
    expectNoFailure();
    // Online with nothing waiting: no connection banner.
    expect(screen.queryByRole("button", { name: ar.connection.openQueue })).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.offline)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.syncing)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows an emergency call-out by its Arabic shift type, never the API's English placeholder title", async () => {
    await renderScreen("Emergency Call-out");

    expect(screen.getByText(ar.enums.ShiftType.EMERGENCY_CALLOUT)).toBeOnTheScreen();
    expect(screen.queryByText("Emergency Call-out")).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("clocks in with the same payload and idempotency key as before, then shows a receipt with the server's time in Asia/Jerusalem", async () => {
    const now = freezeDate(NOW);
    // The API answers { timeEntry, clockEvent }; the server time wins over the device time.
    clockIn.mockResolvedValue({ timeEntry: { id: "te-1", clockInAt: "2026-01-15T08:31:00.000Z" }, clockEvent: { id: "ce-1" } });
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
    const { key, body } = expectedOnlinePayload(now);
    expect(clockIn).toHaveBeenCalledTimes(1);
    expect(clockIn).toHaveBeenCalledWith(body, key);
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
    expect(queueOfflineEvent).not.toHaveBeenCalled();

    expect(screen.getByText("بدأ دوامك الساعة 10:31.")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockIn.successBody, { time: "10:31" }))).toBeOnTheScreen();
    expect(screen.getByText(SHIFT_TITLE)).toBeOnTheScreen();
    expect(receiptReference()).toBe("ce-1");
    expectArabicOnly([receiptReference()]);

    // The receipt stays until the worker taps the button: no silent navigation.
    expect(navigation.popTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: ar.clockIn.backHome }));
    // Back to the Home screen already in the stack, not a second copy of it.
    expect(navigation.popTo).toHaveBeenCalledWith("Home");
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("shows the device time (Asia/Jerusalem, across midnight in summer) when the API returns no clock-in time", async () => {
    // 00:30 on 16 July in Jerusalem (UTC+3).
    freezeDate("2026-07-15T21:30:00.000Z");
    clockIn.mockResolvedValue({});
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(fill(ar.clockIn.successBody, { time: "00:30" }))).toBeOnTheScreen();
    expectArabicOnly([receiptReference()]);
  });

  it("shows what it is doing while locating and submitting, and blocks cancel and the connection banner", async () => {
    // Online with records waiting: the banner is on screen during the whole attempt.
    syncState = { isOnline: true, pendingCount: 1 };
    const location = deferred<Location.LocationObject>();
    const request = deferred<unknown>();
    jest.mocked(Location.getCurrentPositionAsync).mockReturnValue(location.promise);
    clockIn.mockReturnValue(request.promise);
    await renderScreen();

    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(actionButton());
    const locating = await screen.findByRole("button", { name: ar.clockIn.locating });
    expect(locating).toBeDisabled();
    expect(locating).toBeBusy();
    expect(screen.getByRole("button", { name: ar.common.cancel })).toBeDisabled();
    // Leaving for the offline queue mid-request is not possible.
    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expectArabicOnly();

    await act(async () => location.resolve(POSITION));
    const submitting = await screen.findByRole("button", { name: ar.clockIn.submitting });
    expect(submitting).toBeDisabled();
    expect(submitting).toBeBusy();
    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).not.toHaveBeenCalled();

    await act(async () => request.resolve({ timeEntry: { clockInAt: NOW } }));
    await pressing;
    expect(await screen.findByText(fill(ar.clockIn.successBody, { time: "10:30" }))).toBeOnTheScreen();
    expect(clockIn).toHaveBeenCalledTimes(1);
  });

  it("ignores a second tap that lands before the screen re-renders (double tap): one location request, one clock-in", async () => {
    clockIn.mockResolvedValue({ timeEntry: { clockInAt: NOW } });
    await renderScreen();

    // The second tap reaches the handler before the button re-renders as busy.
    await doubleTap(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expect(clockIn).toHaveBeenCalledTimes(1);
  });

  it("asks for location permission when it is denied, without calling the API", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(DENIED);
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockIn.permissionDenied)).toBeOnTheScreen();
    expect(screen.getByText("اسمح للتطبيق بالوصول إلى موقعك لتبدأ الدوام.")).toBeOnTheScreen();
    // The phone will ask again on the next tap: no settings button.
    expect(screen.queryByRole("button", { name: ar.clockIn.openSettings })).not.toBeOnTheScreen();
    expect(clockIn).not.toHaveBeenCalled();
    expect(queueOfflineEvent).not.toHaveBeenCalled();
    expect(actionButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("offers to open the settings when the permission was refused for good", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(BLOCKED);
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockIn.permissionSettings)).toBeOnTheScreen();
    expect(screen.getByText("افتح الإعدادات واسمح للتطبيق بالوصول إلى موقعك، ثم حاول مرة أخرى.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockIn.permissionDenied)).not.toBeOnTheScreen();
    const settings = screen.getByRole("button", { name: ar.clockIn.openSettings });
    expect(screen.getByRole("button", { name: "فتح الإعدادات" })).toBe(settings);
    expect(clockIn).not.toHaveBeenCalled();
    expectArabicOnly();

    await fireEvent.press(settings);
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("says the GPS is switched off (not 'move to an open area') when the phone's location services are off", async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error("Location request failed due to unsatisfied device settings"));
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockIn.locationServicesOff)).toBeOnTheScreen();
    expect(screen.getByText("خدمة الموقع (GPS) مغلقة في هاتفك. شغّلها ثم حاول مرة أخرى.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockIn.locationUnavailable)).not.toBeOnTheScreen();
    expect(clockIn).not.toHaveBeenCalled();
    expect(queueOfflineEvent).not.toHaveBeenCalled();
    // "GPS" is the one Latin word, inside the Arabic sentence.
    expectArabicOnly(["GPS"]);
  });

  it("says the GPS is switched off when iOS refuses the permission because location services are off", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(BLOCKED);
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockIn.locationServicesOff)).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockIn.permissionSettings)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.clockIn.openSettings })).not.toBeOnTheScreen();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(clockIn).not.toHaveBeenCalled();
    expectArabicOnly(["GPS"]);
  });

  it("says the location could not be found when the GPS is on but times out", async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error("Location request timed out"));
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockIn.locationUnavailable)).toBeOnTheScreen();
    expect(screen.getByText("تعذّر تحديد موقعك. انتقل إلى مكان مكشوف وحاول مرة أخرى.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.clockIn.locationServicesOff)).not.toBeOnTheScreen();
    expect(Location.hasServicesEnabledAsync).toHaveBeenCalled();
    expect(clockIn).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("says the location could not be found when the permission request itself fails", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockRejectedValue(new Error("Permission request failed"));
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.clockIn.locationUnavailable)).toBeOnTheScreen();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(clockIn).not.toHaveBeenCalled();
    expect(actionButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("shows the geofence rejection with the distance and the allowed radius (never the API's English message)", async () => {
    clockIn.mockRejectedValue(GEOFENCE_ERROR());
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(GEOFENCE_TEXT)).toBeOnTheScreen();
    expect(queueOfflineEvent).not.toHaveBeenCalled();
    expect(navigation.popTo).not.toHaveBeenCalled();
    // The worker can try again from the same screen.
    expect(actionButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("clears the old error and shows the receipt when the next attempt succeeds", async () => {
    clockIn.mockRejectedValueOnce(GEOFENCE_ERROR()).mockResolvedValueOnce({ timeEntry: { clockInAt: NOW } });
    await renderScreen();

    await fireEvent.press(actionButton());
    expect(await screen.findByText(GEOFENCE_TEXT)).toBeOnTheScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockIn.successBody, { time: "10:30" }))).toBeOnTheScreen();
    expect(screen.queryByText(GEOFENCE_TEXT)).not.toBeOnTheScreen();
    expect(clockIn).toHaveBeenCalledTimes(2);
    expectArabicOnly([receiptReference()]);
  });

  it("shows an Arabic server message for an API error code the app does not know", async () => {
    clockIn.mockRejectedValue(
      new ApiRequestError(500, { statusCode: 500, code: "SOMETHING_NEW", message: "Internal server error", correlationId: "corr-2" }),
    );
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.errors.INTERNAL_ERROR)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("offline: queues the signed clock-in as before (plus the phone's mock-location state) and shows a saved-on-phone receipt with the time", async () => {
    const now = freezeDate(NOW);
    clockIn.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockIn.queuedTitle })).toBeOnTheScreen();
    const key = `clockin-shift-1-${now}`;
    expect(queueOfflineEvent).toHaveBeenCalledTimes(1);
    expect(queueOfflineEvent).toHaveBeenCalledWith({
      clientEventId: key,
      eventType: "CLOCK_IN",
      shiftId: "shift-1",
      deviceTimestamp: NOW,
      latitude: 32.0853,
      longitude: 34.7818,
      accuracyMeters: 8,
      altitude: undefined,
      locationProvider: "expo-location",
      mockLocationSuspected: false,
      // Step 9: signed with the event (the server verifies it); the movement signals are not part of a queued event.
      mockLocationState: "UNAVAILABLE",
    });
    expect(screen.getByText(ar.clockIn.queuedBody)).toBeOnTheScreen();
    expect(screen.getByText("وقت التسجيل: 10:30")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.clockIn.queuedAt, { time: "10:30" }))).toBeOnTheScreen();
    expect(receiptReference()).toBe(key);
    expectArabicOnly([receiptReference()]);

    expect(navigation.popTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: ar.clockIn.backHome }));
    expect(navigation.popTo).toHaveBeenCalledWith("Home");
  });

  it("shows the offline banner while offline, which opens the offline queue", async () => {
    syncState = { isOnline: false, pendingCount: 1 };
    await renderScreen();

    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.connection.pending, { count: "1" }))).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offlineHint)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).toHaveBeenCalledWith("OfflineQueue");
  });

  it("shows the syncing banner with the waiting count while online with records waiting", async () => {
    syncState = { isOnline: true, pendingCount: 2 };
    await renderScreen();

    expect(screen.getByText(ar.connection.syncing)).toBeOnTheScreen();
    expect(screen.getByText("جارٍ المزامنة…")).toBeOnTheScreen();
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
    expect(clockIn).not.toHaveBeenCalled();
  });
});

// ── Step 9: photos, what the phone could tell about the location, and the receipt ──

describe("ClockInScreen: photos, location signals and the receipt (Step 9)", () => {
  let uploadAttachment: jest.Mock;
  let compressed: number;

  beforeEach(() => {
    compressed = 0;
    uploadAttachment = jest.fn(async (_purpose: string, _file: unknown, name: string) => ({ fileAssetId: `asset-${name}`, purpose: "ATTENDANCE_PHOTO", contentType: "image/jpeg", sizeBytes: 300_000 }));
    jest.mocked(useAuth).mockImplementation(() => ({ client: { clockIn, uploadAttachment } }) as unknown as ReturnType<typeof useAuth>);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///picker/a.jpg", width: 4032, height: 3024 },
        { uri: "file:///picker/b.jpg", width: 3024, height: 4032 },
      ],
    });
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
      const context = {
        resize: jest.fn(),
        renderAsync: jest.fn(async () => ({ saveAsync: jest.fn(async () => ({ uri: `file:///cache/photo-${++compressed}.jpg`, width: 1600, height: 1200 })), release: jest.fn() })),
        release: jest.fn(),
      };
      context.resize.mockReturnValue(context);
      return context as never;
    });
  });

  async function addTwoPhotos() {
    await fireEvent.press(screen.getByRole("button", { name: ar.photos.pickFromGallery }));
    expect(await screen.findByText(fill(ar.photos.count, { count: "2", max: "5" }))).toBeOnTheScreen();
  }

  it("uploads the compressed photos first (ATTENDANCE_PHOTO), then clocks in with their ids", async () => {
    const now = freezeDate(NOW);
    clockIn.mockResolvedValue({ timeEntry: { clockInAt: NOW }, clockEvent: { id: "ce-1" } });
    await renderScreen();
    await addTwoPhotos();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
    expect(uploadAttachment.mock.calls).toEqual([
      ["ATTENDANCE_PHOTO", { uri: "file:///cache/photo-1.jpg", name: "photo-1.jpg", type: "image/jpeg" }, "photo-1.jpg"],
      ["ATTENDANCE_PHOTO", { uri: "file:///cache/photo-2.jpg", name: "photo-2.jpg", type: "image/jpeg" }, "photo-2.jpg"],
    ]);
    const { key, body } = expectedOnlinePayload(now);
    expect(clockIn).toHaveBeenCalledWith({ ...body, photoAssetIds: ["asset-photo-1.jpg", "asset-photo-2.jpg"] }, key);
    // The photos went before the clock-in.
    expect(uploadAttachment.mock.invocationCallOrder[1]).toBeLessThan(clockIn.mock.invocationCallOrder[0]);
  });

  it("shows the upload progress while the photos are sent", async () => {
    const upload = deferred<unknown>();
    uploadAttachment.mockReturnValueOnce(upload.promise);
    clockIn.mockResolvedValue({ timeEntry: { clockInAt: NOW } });
    await renderScreen();
    await addTwoPhotos();

    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(actionButton());
    const busy = await screen.findByRole("button", { name: fill(ar.clock.uploadingPhotos, { current: "1", total: "2" }) });
    expect(busy).toBeDisabled();
    expect(screen.getByText("جارٍ رفع الصور (1 من 2)…")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.photos.pickFromGallery })).toBeDisabled();
    expectArabicOnly();

    await act(async () => upload.resolve({ fileAssetId: "asset-1" }));
    await pressing;
    expect(await screen.findByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
  });

  it("stops on a refused photo with the Arabic reason, and the retry never uploads a photo twice", async () => {
    uploadAttachment
      .mockImplementationOnce(async () => ({ fileAssetId: "asset-1" }))
      .mockRejectedValueOnce(new ApiRequestError(413, { statusCode: 413, code: "FILE_TOO_LARGE", message: "File too large", correlationId: "c" }));
    clockIn.mockResolvedValue({ timeEntry: { clockInAt: NOW } });
    await renderScreen();
    await addTwoPhotos();

    await fireEvent.press(actionButton());
    expect(await screen.findByText(ar.errors.FILE_TOO_LARGE)).toBeOnTheScreen();
    expect(clockIn).not.toHaveBeenCalled();
    expect(queueOfflineEvent).not.toHaveBeenCalled();

    await fireEvent.press(actionButton());
    expect(await screen.findByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
    // Photo 1 kept its id from the first attempt; only photo 2 was sent again.
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
    expect(uploadAttachment.mock.calls[2][2]).toBe("photo-2.jpg");
    expect(clockIn.mock.calls[0][0]).toMatchObject({ photoAssetIds: ["asset-1", "asset-photo-2.jpg"] });
  });

  it("offline during the upload: saves the clock-in on the phone without the photos (files are never queued) and says so", async () => {
    const now = freezeDate(NOW);
    uploadAttachment.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await addTwoPhotos();

    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockIn.queuedTitle })).toBeOnTheScreen();
    expect(clockIn).not.toHaveBeenCalled();
    // The signed event: no photo ids (files are never queued).
    expect(queueOfflineEvent).toHaveBeenCalledWith({
      clientEventId: `clockin-shift-1-${now}`,
      eventType: "CLOCK_IN",
      shiftId: "shift-1",
      deviceTimestamp: NOW,
      latitude: 32.0853,
      longitude: 34.7818,
      accuracyMeters: 8,
      altitude: undefined,
      locationProvider: "expo-location",
      mockLocationSuspected: false,
      mockLocationState: "UNAVAILABLE",
    });
    expect(screen.getByText(ar.clock.photosNotSent)).toBeOnTheScreen();
    expectArabicOnly([receiptReference()]);
  });

  it("offline from the start: adding photos is switched off with an Arabic notice", async () => {
    syncState = { isOnline: false, pendingCount: 0 };
    await renderScreen();
    expect(screen.getByText(ar.photos.offline)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.photos.pickFromGallery })).toBeDisabled();
    expect(screen.getByRole("button", { name: ar.photos.takePhoto })).toBeDisabled();
  });

  it("Android: a location the phone reports as mocked is sent as DETECTED (the server's rule decides)", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ ...POSITION, mocked: true });
    clockIn.mockRejectedValue(new ApiRequestError(403, { statusCode: 403, code: "MOCK_LOCATION_BLOCKED", message: "Mock location", correlationId: "c" }));
    await renderScreen();

    await fireEvent.press(actionButton());

    expect(await screen.findByText(ar.errors.MOCK_LOCATION_BLOCKED)).toBeOnTheScreen();
    expect(clockIn.mock.calls[0][0]).toMatchObject({ mockLocationState: "DETECTED", mockLocationSuspected: true, locationSignals: [] });
  });

  it("Android: a real location is NOT_DETECTED; iOS is UNAVAILABLE (never claimed as real)", async () => {
    clockIn.mockRejectedValue(GEOFENCE_ERROR());
    jest.replaceProperty(Platform, "OS", "android");
    await renderScreen();
    await fireEvent.press(actionButton());
    await screen.findByText(GEOFENCE_TEXT);
    expect(clockIn.mock.calls[0][0]).toMatchObject({ mockLocationState: "NOT_DETECTED", mockLocationSuspected: false });

    jest.replaceProperty(Platform, "OS", "ios");
    await fireEvent.press(actionButton());
    await screen.findByText(GEOFENCE_TEXT);
    expect(clockIn.mock.calls[1][0]).toMatchObject({ mockLocationState: "UNAVAILABLE", mockLocationSuspected: false });
  });

  it("sends the movement signals the phone saw between two attempts, as signals only", async () => {
    clockIn.mockRejectedValueOnce(GEOFENCE_ERROR()).mockResolvedValueOnce({ timeEntry: { clockInAt: NOW } });
    jest.mocked(Location.getCurrentPositionAsync)
      .mockResolvedValueOnce({ ...POSITION, timestamp: 1_000 })
      // A minute later, 55 km away, claiming perfect accuracy.
      .mockResolvedValueOnce({ ...POSITION, coords: { ...POSITION.coords, latitude: 32.58, accuracy: 0 }, timestamp: 61_000 });
    await renderScreen();

    await fireEvent.press(actionButton());
    await screen.findByText(GEOFENCE_TEXT);
    await fireEvent.press(actionButton());

    expect(await screen.findByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
    expect(clockIn.mock.calls[0][0]).toMatchObject({ locationSignals: [] });
    expect(clockIn.mock.calls[1][0]).toMatchObject({ locationSignals: ["ZERO_ACCURACY", "IMPOSSIBLE_SPEED"], mockLocationState: "UNAVAILABLE" });
  });

  it("the receipt shows the action, the server and phone times (Asia/Jerusalem), the sync state and the clock event id", async () => {
    freezeDate(NOW);
    clockIn.mockResolvedValue({ timeEntry: { id: "te-1", clockInAt: "2026-01-15T08:30:02.000Z" }, clockEvent: { id: "0199c5a2-7c1d-7a3e-9a52-3f6c2d1e8b40" } });
    await renderScreen();
    await fireEvent.press(actionButton());
    await screen.findByRole("header", { name: ar.clockIn.successTitle });

    const value = (testID: string) => {
      const texts = within(screen.getByTestId(testID)).getAllByText(/./);
      return texts[texts.length - 1].props.children as string;
    };
    expect(value("receipt-action")).toBe("بدء الدوام");
    expect(value("receipt-server-time")).toBe("15 يناير 2026 في 10:30");
    expect(value("receipt-device-time")).toBe("15 يناير 2026 في 10:30");
    expect(value("receipt-sync-state")).toBe("تمت المزامنة");
    expect(receiptReference()).toBe("0199c5a2-7c1d-7a3e-9a52-3f6c2d1e8b40");
    expect(screen.getByTestId("receipt-shift")).toHaveTextContent(SHIFT_TITLE);
  });

  it("acts only as the signed-in worker: no worker id is ever sent, only the caller's own endpoints are used", async () => {
    clockIn.mockResolvedValue({ timeEntry: { clockInAt: NOW } });
    await renderScreen();
    await addTwoPhotos();
    await fireEvent.press(actionButton());
    await screen.findByRole("header", { name: ar.clockIn.successTitle });

    expect(JSON.stringify([...clockIn.mock.calls, ...uploadAttachment.mock.calls])).not.toContain("workerProfileId");
    expect(Object.keys(jest.mocked(useAuth).mock.results[0].value.client)).toEqual(["clockIn", "uploadAttachment"]);
  });

  it("the queued receipt says it waits for sync, with no server time yet and the client event id", async () => {
    const now = freezeDate(NOW);
    clockIn.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await fireEvent.press(actionButton());
    await screen.findByRole("header", { name: ar.clockIn.queuedTitle });

    expect(within(screen.getByTestId("receipt-sync-state")).getByText("بانتظار المزامنة")).toBeOnTheScreen();
    expect(within(screen.getByTestId("receipt-server-time")).getByText(ar.receipt.serverTimePending)).toBeOnTheScreen();
    expect(receiptReference()).toBe(`clockin-shift-1-${now}`);
    expect(screen.queryByText(ar.clock.photosNotSent)).not.toBeOnTheScreen();
  });
});
