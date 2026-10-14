import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type Shift } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import { useAuth } from "../../lib/auth-context";
import { resetLocationHistory } from "../../lib/location";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { SiteMapData } from "../../lib/site-map-html";
import type { RootStackParamList } from "../../navigation/types";
import { ShiftDetailsScreen } from "../ShiftDetailsScreen";
import { deferred, expectArabicOnly, fill, inArabic, renderInArabic } from "./clock-screens-test-utils";

jest.mock("../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: jest.fn() }));
jest.mock("expo-location", () => ({
  ...jest.requireActual("expo-location"),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

let mockFocused = true;
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useIsFocused: () => mockFocused }));

type Navigation = NativeStackScreenProps<RootStackParamList, "ShiftDetails">["navigation"];

/** The seeded site «تقاطع تل أبيب المركزي». */
const SITE = { latitude: 32.0853, longitude: 34.7818 };
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;
const north = (meters: number) => ({ latitude: SITE.latitude + meters / METERS_PER_DEGREE, longitude: SITE.longitude });
// 14:00 in Jerusalem (winter, UTC+2).
const NOW = "2026-01-15T12:00:00.000Z";
const realNow = Date.now.bind(Date);
const iso = (value: string) => `\u2068${value}\u2069`;

let getShift: jest.Mock;
let online: boolean;
let navigation: { navigate: jest.Mock; goBack: jest.Mock };
let emit: (position: Location.LocationObject) => void;
let removeWatch: jest.Mock;

function shift(overrides: Record<string, unknown> = {}): Shift {
  return {
    id: "shift-1",
    organizationId: "org-1",
    projectId: "project-1",
    siteId: "site-1",
    geofenceId: "geofence-1",
    shiftType: "STANDARD",
    title: "وردية عادية — تقاطع تل أبيب المركزي",
    scheduledStart: "2026-01-15T06:00:00.000Z",
    scheduledEnd: "2026-01-15T15:00:00.000Z",
    checkInMethod: "GEOFENCED",
    status: "PUBLISHED",
    managerId: "manager-1",
    businessDate: "2026-01-15",
    managerName: "يوسف الخطيب",
    project: { id: "project-1", name: "تنظيم حركة السير على شارع 6", client: null, projectCode: "HWY6-2026", status: "ACTIVE" },
    site: {
      id: "site-1",
      projectId: "project-1",
      name: "تقاطع تل أبيب المركزي",
      ...SITE,
      defaultGeofenceRadiusMeters: 150,
      instructions: "يجب ارتداء السترة العاكسة ومراجعة مشرف الموقع فور الوصول.",
    },
    geofence: { id: "geofence-1", siteId: "site-1", centerLatitude: SITE.latitude, centerLongitude: SITE.longitude, radiusMeters: 150, minAccuracyMeters: 50 },
    temporaryCheckInPoints: [
      { id: "point-1", shiftId: "shift-1", name: "نقطة تجمّع الطاقم", latitude: 32.0863, longitude: 34.7828, radiusMeters: 100, status: "ACTIVE", expiresAt: "2026-01-15T15:00:00.000Z", revokedAt: null },
      { id: "point-2", shiftId: "shift-1", name: "نقطة منتهية", latitude: 32.09, longitude: 34.79, radiusMeters: 100, status: "EXPIRED", expiresAt: "2026-01-15T09:00:00.000Z", revokedAt: null },
      { id: "point-3", shiftId: "shift-1", name: "نقطة ملغاة", latitude: 32.091, longitude: 34.791, radiusMeters: 100, status: "ACTIVE", expiresAt: "2026-01-15T15:00:00.000Z", revokedAt: "2026-01-15T10:00:00.000Z" },
    ],
    // What the API still attaches today: other workers on the shift. The screen must never show them.
    assignments: [
      { id: "a-1", workerProfileId: "worker-1", worker: { membership: { user: { fullLegalName: "باسل عازر", phoneNumber: "+972500010004" } } } },
      { id: "a-2", workerProfileId: "worker-2", worker: { membership: { user: { fullLegalName: "كريم حمدان", phoneNumber: "+972500010005" } } } },
    ],
    ...overrides,
  } as unknown as Shift;
}

function position(latitude: number, longitude: number, accuracy = 8): Location.LocationObject {
  return { coords: { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: 1 };
}

beforeEach(() => {
  const offset = new Date(NOW).getTime() - realNow();
  jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
  resetLocationHistory();
  mockFocused = true;
  online = true;
  getShift = jest.fn(async () => shift());
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  removeWatch = jest.fn();
  // One client per session, like the real AuthProvider (the screen reloads when the client changes).
  const client = { getShift };
  jest.mocked(useAuth).mockImplementation(() => ({ client }) as unknown as ReturnType<typeof useAuth>);
  jest.mocked(useOfflineSync).mockImplementation(() => ({ isOnline: online, pendingCount: online ? 0 : 1, queue: [], queueOfflineEvent: jest.fn(), syncNow: jest.fn() }) as unknown as ReturnType<typeof useOfflineSync>);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" });
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest.mocked(Location.watchPositionAsync).mockImplementation(async (_options, callback) => {
    emit = callback as (position: Location.LocationObject) => void;
    return { remove: removeWatch };
  });
});

function screenElement() {
  return inArabic(
    <ShiftDetailsScreen navigation={navigation as unknown as Navigation} route={{ key: "ShiftDetails-1", name: "ShiftDetails", params: { shiftId: "shift-1" } }} />,
  );
}

function renderScreen() {
  return renderInArabic(
    <ShiftDetailsScreen navigation={navigation as unknown as Navigation} route={{ key: "ShiftDetails-1", name: "ShiftDetails", params: { shiftId: "shift-1" } }} />,
  );
}

/** The value of a labelled field. */
const field = (testID: string) => {
  const texts = within(screen.getByTestId(testID)).getAllByText(/./);
  return texts[texts.length - 1].props.children as string;
};

function mapData(): SiteMapData {
  const html = (screen.getByTestId("shift-map").props as { source: { html: string } }).source.html;
  const match = /window\.__FM_MAP__ = (.*);<\/script>/.exec(html);
  if (!match) throw new Error("no map data");
  return JSON.parse(match[1]) as SiteMapData;
}

describe("ShiftDetailsScreen (Arabic, RTL)", () => {
  it("shows the loading state while the shift loads", async () => {
    getShift.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.shift.title })).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the shift: title, project, site, Jerusalem date and times, check-in method, manager and site instructions", async () => {
    await renderScreen();

    expect(await screen.findByText(iso("وردية عادية — تقاطع تل أبيب المركزي"))).toBeOnTheScreen();
    expect(getShift).toHaveBeenCalledWith("shift-1");
    expect(field("shift-project")).toBe(iso("تنظيم حركة السير على شارع 6"));
    expect(field("shift-site")).toBe(iso("تقاطع تل أبيب المركزي"));
    expect(field("shift-date")).toBe("15 يناير 2026");
    // 06:00Z-15:00Z is 08:00-17:00 in Jerusalem (winter).
    expect(field("shift-hours")).toBe(fill(ar.shift.hoursValue, { start: "08:00", end: "17:00" }));
    expect(field("shift-check-in-method")).toBe(ar.enums.CheckInMethod.GEOFENCED);
    expect(field("shift-manager")).toBe(iso("يوسف الخطيب"));
    expect(field("shift-instructions")).toBe(iso("يجب ارتداء السترة العاكسة ومراجعة مشرف الموقع فور الوصول."));
    expect(screen.queryByText(ar.shift.flexiHint)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the dates as well when the shift crosses midnight, and the Flexi-Check note", async () => {
    getShift.mockResolvedValue(shift({ scheduledStart: "2026-01-15T20:00:00.000Z", scheduledEnd: "2026-01-16T04:00:00.000Z", checkInMethod: "FLEXI_CHECK" }));
    await renderScreen();

    expect(await screen.findByText(ar.shift.flexiHint)).toBeOnTheScreen();
    expect(field("shift-hours")).toBe(fill(ar.shift.hoursValue, { start: "15 يناير 2026 في 22:00", end: "16 يناير 2026 في 06:00" }));
    expect(field("shift-check-in-method")).toBe("تسجيل مرن");
  });

  it("says 'not set' for what the API does not give (no project, manager or instructions)", async () => {
    getShift.mockResolvedValue(shift({ project: null, managerName: undefined, site: { ...shift().site, instructions: null } }));
    await renderScreen();

    await screen.findByTestId("shift-title");
    expect(field("shift-project")).toBe(ar.shift.notSet);
    expect(field("shift-manager")).toBe(ar.shift.notSet);
    expect(field("shift-instructions")).toBe(ar.shift.noInstructions);
    expectArabicOnly();
  });

  it("never shows the other workers the API attaches to the shift", async () => {
    await renderScreen();
    await screen.findByTestId("shift-title");

    for (const text of ["باسل عازر", "كريم حمدان", "+972500010004", "+972500010005"]) {
      expect(screen.queryByText(text, { exact: false })).not.toBeOnTheScreen();
    }
    expect(JSON.stringify(mapData())).not.toContain("باسل");
    // Only the caller's own shift endpoint is called.
    expect(Object.keys(jest.mocked(useAuth).mock.results[0].value.client)).toEqual(["getShift"]);
  });

  it("maps the geofence circle and only the active temporary points", async () => {
    await renderScreen();
    await screen.findByTestId("shift-title");

    const data = mapData();
    expect(data.geofence).toEqual({ latitude: SITE.latitude, longitude: SITE.longitude, radiusMeters: 150 });
    expect(data.points).toEqual([{ name: "نقطة تجمّع الطاقم", latitude: 32.0863, longitude: 34.7828, radiusMeters: 100 }]);
    expect(screen.getByText(ar.shift.temporaryPoints)).toBeOnTheScreen();
    // Until 17:00 (15:00Z).
    expect(screen.getByText(fill(ar.shift.temporaryPoint, { name: iso("نقطة تجمّع الطاقم"), time: "17:00" }))).toBeOnTheScreen();
    expect(screen.queryByText("نقطة منتهية", { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText("نقطة ملغاة", { exact: false })).not.toBeOnTheScreen();
  });

  it("uses the site's own radius when the shift has no geofence", async () => {
    getShift.mockResolvedValue(shift({ geofence: null, temporaryCheckInPoints: [] }));
    await renderScreen();
    await screen.findByTestId("shift-title");
    expect(mapData().geofence).toEqual({ latitude: SITE.latitude, longitude: SITE.longitude, radiusMeters: 150 });
    expect(screen.queryByTestId("shift-temporary-points")).not.toBeOnTheScreen();
  });

  it("updates «أنت على بعد X م من الموقع» live, then «داخل نطاق الموقع» inside the geofence", async () => {
    await renderScreen();
    await screen.findByTestId("shift-title");
    expect(screen.getByText(ar.location.locating)).toBeOnTheScreen();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    const far = north(1_996);
    await act(async () => emit(position(far.latitude, far.longitude, 12)));
    expect(screen.getByTestId("shift-distance")).toHaveTextContent(fill(ar.location.distanceAway, { distance: "1,996" }));
    expect(screen.getByText("أنت على بعد 1,996 م من الموقع")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.location.accuracy, { meters: "12" }))).toBeOnTheScreen();
    expect(mapData().worker).toBeNull();
    expectArabicOnly();

    const near = north(40);
    await act(async () => emit(position(near.latitude, near.longitude, 6)));
    expect(screen.getByTestId("shift-distance")).toHaveTextContent(ar.location.insideSite);
    expect(screen.getByText("داخل نطاق الموقع")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("stops watching the GPS when the screen loses focus, and when it unmounts", async () => {
    const view = await renderScreen();
    await screen.findByTestId("shift-title");
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    mockFocused = false;
    await view.rerender(screenElement());
    expect(removeWatch).toHaveBeenCalledTimes(1);

    mockFocused = true;
    await view.rerender(screenElement());
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
    await view.unmount();
    expect(removeWatch).toHaveBeenCalledTimes(2);
  });

  it("explains a refused location permission instead of the distance", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: false, expires: "never" });
    await renderScreen();
    expect(await screen.findByText(ar.location.permissionSettings)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.location.openSettings })).toBeOnTheScreen();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("offline: the map says «الخريطة غير متاحة دون اتصال», and the banner shows", async () => {
    online = false;
    await renderScreen();
    await screen.findByTestId("shift-title");
    expect(screen.getByText("الخريطة غير متاحة دون اتصال")).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the load error in Arabic (never the API's English) and retries", async () => {
    getShift.mockRejectedValueOnce(new ApiRequestError(404, { statusCode: 404, code: "NOT_FOUND", message: "Shift not found.", correlationId: "c" }));
    await renderScreen();

    expect(await screen.findByText(`${ar.shift.loadError}\n${ar.errors.NOT_FOUND}`)).toBeOnTheScreen();
    expect(screen.queryByText(/Shift not found/)).not.toBeOnTheScreen();
    expectArabicOnly();

    const next = deferred<Shift>();
    getShift.mockReturnValueOnce(next.promise);
    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByLabelText(ar.states.loading)).toBeOnTheScreen();
    await act(async () => next.resolve(shift()));
    await pressing;
    expect(await screen.findByTestId("shift-title")).toBeOnTheScreen();
  });

  it("offline without the shift: the network error in Arabic", async () => {
    online = false;
    getShift.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.shift.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("goes back", async () => {
    await renderScreen();
    await screen.findByTestId("shift-title");
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
