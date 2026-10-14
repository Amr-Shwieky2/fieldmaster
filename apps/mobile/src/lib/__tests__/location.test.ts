import * as Location from "expo-location";
import { act, renderHook } from "@testing-library/react-native";
import {
  FROZEN_MIN_INTERVAL_MS,
  LocationSignal,
  MAX_PLAUSIBLE_SPEED_MPS,
  clockLocationFields,
  distanceFrom,
  distanceMeters,
  mockLocationStateFor,
  movementSignals,
  readLocation,
  rememberFix,
  resetLocationHistory,
  useLiveDistance,
  type LocationFix,
} from "../location";

jest.mock("expo-location", () => ({
  ...jest.requireActual("expo-location"),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

/** The seeded site «تقاطع تل أبيب المركزي». */
const SITE = { latitude: 32.0853, longitude: 34.7818 };
/** Meters per degree of latitude with the haversine's earth radius (6,371 km). */
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;
/** A point `meters` north of `from`. */
const north = (from: { latitude: number; longitude: number }, meters: number) => ({ latitude: from.latitude + meters / METERS_PER_DEGREE, longitude: from.longitude });

const GRANTED = { status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" } as const;
const DENIED = { status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: "never" } as const;
const BLOCKED = { status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: false, expires: "never" } as const;

function position(overrides: { latitude?: number; longitude?: number; accuracy?: number | null; timestamp?: number; mocked?: boolean } = {}): Location.LocationObject {
  return {
    coords: {
      latitude: overrides.latitude ?? SITE.latitude,
      longitude: overrides.longitude ?? SITE.longitude,
      accuracy: overrides.accuracy === undefined ? 8 : overrides.accuracy,
      altitude: 41.5,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: overrides.timestamp ?? 1_000_000,
    ...(overrides.mocked === undefined ? {} : { mocked: overrides.mocked }),
  };
}

const fix = (overrides: Partial<LocationFix> = {}): LocationFix => ({ ...SITE, accuracy: 8, timestamp: 1_000_000, ...overrides });

beforeEach(() => {
  resetLocationHistory();
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(GRANTED);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(position());
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
});

describe("mock location state: only Android can tell", () => {
  it("Android: the OS flag decides DETECTED / NOT_DETECTED", () => {
    expect(mockLocationStateFor({ mocked: true }, "android")).toBe("DETECTED");
    expect(mockLocationStateFor({ mocked: false }, "android")).toBe("NOT_DETECTED");
  });

  it("Android without the flag: UNAVAILABLE, never a guess", () => {
    expect(mockLocationStateFor({}, "android")).toBe("UNAVAILABLE");
  });

  it("iOS and the web: always UNAVAILABLE (never 'not detected'), whatever the fix says", () => {
    for (const platform of ["ios", "web"]) {
      expect(mockLocationStateFor({ mocked: true }, platform)).toBe("UNAVAILABLE");
      expect(mockLocationStateFor({ mocked: false }, platform)).toBe("UNAVAILABLE");
      expect(mockLocationStateFor({}, platform)).toBe("UNAVAILABLE");
    }
  });

  it("only DETECTED sets the old mockLocationSuspected flag the server's rule reads", async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(position({ mocked: true }));
    const android = await readLocation("android");
    const ios = await readLocation("ios");
    if (!android.ok || !ios.ok) throw new Error("expected readings");
    expect(android.reading.mockLocationState).toBe("DETECTED");
    expect(clockLocationFields(android.reading).mockLocationSuspected).toBe(true);
    expect(ios.reading.mockLocationState).toBe("UNAVAILABLE");
    expect(clockLocationFields(ios.reading).mockLocationSuspected).toBe(false);
  });
});

describe("movement heuristics (signals for review, never a refusal)", () => {
  it("flags a fix claiming 0 m accuracy, not a real or missing accuracy", () => {
    expect(movementSignals(null, fix({ accuracy: 0 }))).toEqual([LocationSignal.ZERO_ACCURACY]);
    expect(movementSignals(null, fix({ accuracy: 5 }))).toEqual([]);
    expect(movementSignals(null, fix({ accuracy: null }))).toEqual([]);
  });

  it(`flags a jump faster than ${MAX_PLAUSIBLE_SPEED_MPS} m/s between two fixes`, () => {
    const start = fix({ accuracy: 0.5, timestamp: 0 });
    // 10 km in one minute: 167 m/s.
    expect(movementSignals(start, fix({ ...north(SITE, 10_000), accuracy: 0.5, timestamp: 60_000 }))).toEqual([LocationSignal.IMPOSSIBLE_SPEED]);
    // 10 km in ten minutes: 17 m/s, a car.
    expect(movementSignals(start, fix({ ...north(SITE, 10_000), accuracy: 0.5, timestamp: 600_000 }))).toEqual([]);
  });

  it("uses the limit itself as the boundary (more than 70 m/s, not 70)", () => {
    const start = fix({ accuracy: null, timestamp: 0 });
    expect(movementSignals(start, fix({ ...north(SITE, 6_990), accuracy: null, timestamp: 100_000 }))).toEqual([]);
    expect(movementSignals(start, fix({ ...north(SITE, 7_100), accuracy: null, timestamp: 100_000 }))).toEqual([LocationSignal.IMPOSSIBLE_SPEED]);
  });

  it("does not take GPS jitter within the fixes' accuracy for movement", () => {
    // 25 m apart within 0.2 s is 125 m/s on paper, but both fixes are only good to 15 m.
    const start = fix({ accuracy: 15, timestamp: 0 });
    expect(movementSignals(start, fix({ ...north(SITE, 25), accuracy: 15, timestamp: 200 }))).toEqual([]);
  });

  it(`flags exactly the same coordinates on fixes at least ${FROZEN_MIN_INTERVAL_MS / 1000} s apart`, () => {
    const start = fix({ timestamp: 0 });
    expect(movementSignals(start, fix({ timestamp: FROZEN_MIN_INTERVAL_MS }))).toEqual([LocationSignal.FROZEN_POSITION]);
    expect(movementSignals(start, fix({ timestamp: FROZEN_MIN_INTERVAL_MS - 1 }))).toEqual([]);
    // Real GPS drifts a little: not frozen.
    expect(movementSignals(start, fix({ ...north(SITE, 0.3), timestamp: 3_600_000 }))).toEqual([]);
  });

  it("never judges time from a fix that is not newer (a cached fix handed back again)", () => {
    const start = fix({ timestamp: 5_000 });
    expect(movementSignals(start, fix({ timestamp: 5_000 }))).toEqual([]);
    expect(movementSignals(start, fix({ ...north(SITE, 50_000), timestamp: 4_000 }))).toEqual([]);
  });

  it("compares each clock event's fix with the previous one the app saw", async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce(position({ timestamp: 0 }));
    const first = await readLocation("ios");
    // A minute later, 50 km away, with perfect accuracy: two signals.
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce(position({ ...north(SITE, 50_000), accuracy: 0, timestamp: 60_000 }));
    const second = await readLocation("ios");
    if (!first.ok || !second.ok) throw new Error("expected readings");
    expect(first.reading.locationSignals).toEqual([]);
    expect(second.reading.locationSignals).toEqual([LocationSignal.ZERO_ACCURACY, LocationSignal.IMPOSSIBLE_SPEED]);
    // Still UNAVAILABLE: a heuristic never turns into a detection.
    expect(second.reading.mockLocationState).toBe("UNAVAILABLE");
  });

  it("also compares with the last fix of the live distance watch", async () => {
    rememberFix(position({ timestamp: 0 }));
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce(position({ timestamp: 120_000 }));
    const reading = await readLocation("ios");
    if (!reading.ok) throw new Error("expected a reading");
    expect(reading.reading.locationSignals).toEqual([LocationSignal.FROZEN_POSITION]);
  });
});

describe("readLocation", () => {
  it("reads one high-accuracy fix with the fields a clock event sends", async () => {
    const result = await readLocation("ios");
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
    if (!result.ok) throw new Error("expected a reading");
    expect(clockLocationFields(result.reading)).toEqual({
      latitude: SITE.latitude,
      longitude: SITE.longitude,
      accuracyMeters: 8,
      altitude: 41.5,
      locationProvider: "expo-location",
      mockLocationSuspected: false,
    });
  });

  it("sends 9999 m when the phone gives no accuracy, as the clock screens always did", async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(position({ accuracy: null }));
    const result = await readLocation("ios");
    if (!result.ok) throw new Error("expected a reading");
    expect(clockLocationFields(result.reading).accuracyMeters).toBe(9999);
  });

  it("says why there is no fix: permission (ask again or settings), GPS off, or no fix", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(DENIED);
    expect(await readLocation()).toEqual({ ok: false, failure: { kind: "permission", canAskAgain: true } });

    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(BLOCKED);
    expect(await readLocation()).toEqual({ ok: false, failure: { kind: "permission", canAskAgain: false } });

    // iOS refuses the permission while location services are off for the whole phone.
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    expect(await readLocation()).toEqual({ ok: false, failure: { kind: "servicesOff" } });

    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(GRANTED);
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error("Location services are disabled"));
    expect(await readLocation()).toEqual({ ok: false, failure: { kind: "servicesOff" } });

    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
    expect(await readLocation()).toEqual({ ok: false, failure: { kind: "location" } });
  });
});

describe("distance to the site", () => {
  it("is the shared haversine distance in meters", () => {
    expect(distanceMeters(SITE, SITE)).toBe(0);
    expect(distanceMeters(SITE, north(SITE, 1_000))).toBeCloseTo(1_000, 6);
    // To the seeded «موقع هرتسليا الشمالي» site: 10,716 m.
    expect(Math.round(distanceMeters(SITE, { latitude: 32.166, longitude: 34.844 }))).toBe(10_716);
  });

  it("is inside up to and including the radius, rounded to whole meters", () => {
    const target = { ...SITE, radiusMeters: 150 };
    expect(distanceFrom({ ...north(SITE, 150), accuracy: 5 }, target)).toMatchObject({ status: "located", distanceMeters: 150, inside: true });
    expect(distanceFrom({ ...north(SITE, 151.4), accuracy: 5 }, target)).toMatchObject({ distanceMeters: 151, inside: false });
    expect(distanceFrom({ ...north(SITE, 1_996.3), accuracy: null }, target)).toMatchObject({ distanceMeters: 1996, inside: false, accuracy: null });
  });
});

describe("useLiveDistance", () => {
  type Callback = (location: Location.LocationObject) => void;
  let emit: Callback;
  let remove: jest.Mock;

  beforeEach(() => {
    remove = jest.fn();
    jest.mocked(Location.watchPositionAsync).mockImplementation(async (_options, callback) => {
      emit = callback as Callback;
      return { remove };
    });
  });

  const target = { ...SITE, radiusMeters: 150 };

  it("watches the position only while active, and updates the distance on every fix", async () => {
    const { result, rerender, unmount } = await renderHook(({ active }: { active: boolean }) => useLiveDistance(target, active), { initialProps: { active: false } });
    expect(result.current).toEqual({ status: "idle" });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();

    await rerender({ active: true });
    expect(Location.watchPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 5000 }, expect.any(Function), expect.any(Function));
    expect(result.current).toEqual({ status: "locating" });

    await act(async () => emit(position({ ...north(SITE, 400), timestamp: 1 })));
    expect(result.current).toMatchObject({ status: "located", distanceMeters: 400, inside: false });
    await act(async () => emit(position({ ...north(SITE, 20), timestamp: 2 })));
    expect(result.current).toMatchObject({ status: "located", distanceMeters: 20, inside: true });

    // Blur: the watch stops.
    await rerender({ active: false });
    expect(remove).toHaveBeenCalledTimes(1);
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("stops the watch when the screen unmounts", async () => {
    const { unmount } = await renderHook(() => useLiveDistance(target, true));
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("says when the permission is refused, without watching", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(BLOCKED);
    const { result } = await renderHook(() => useLiveDistance(target, true));
    expect(result.current).toEqual({ status: "permission", canAskAgain: false });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("does nothing without a target (a shift without a site)", async () => {
    const { result } = await renderHook(() => useLiveDistance(null, true));
    expect(result.current).toEqual({ status: "idle" });
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});
