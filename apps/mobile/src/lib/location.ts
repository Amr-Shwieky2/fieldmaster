import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { MockLocationState } from "@fieldmaster/shared-types";
import { haversineDistanceMeters } from "@fieldmaster/shared-validation";

/**
 * The location reading behind every clock event (clock-in, clock-out, the
 * emergency call-out) and the live distance on the shift details screen.
 *
 * What the phone can tell about a fake (mocked) location depends on the
 * platform, and the app never claims more than that:
 * - Android: expo-location passes on the OS flag (`mocked`): DETECTED or
 *   NOT_DETECTED. DETECTED is refused by the server (the existing rule).
 * - iOS and the web: the platform does not say. The state is UNAVAILABLE,
 *   which never means "certainly real". A few simple movement heuristics
 *   (below) are recorded as `locationSignals` for a manager to review; they
 *   never block anything on their own, and they cannot prove a location is
 *   fake (or real).
 *
 * The server decides everything (geofence, accuracy, mock rule); this module
 * only reports what the phone saw.
 */

/** Signals sent with a clock event: suspicious, never a refusal on their own. */
export const LocationSignal = {
  /** Faster than any vehicle between two fixes (after allowing for both fixes' accuracy). */
  IMPOSSIBLE_SPEED: "IMPOSSIBLE_SPEED",
  /** A fix that claims perfect (0 m) accuracy: real GPS never does, location-faking tools often do. */
  ZERO_ACCURACY: "ZERO_ACCURACY",
  /** Exactly the same coordinates on two fixes at least FROZEN_MIN_INTERVAL_MS apart. */
  FROZEN_POSITION: "FROZEN_POSITION",
} as const;
export type LocationSignal = (typeof LocationSignal)[keyof typeof LocationSignal];

/** 70 m/s is 252 km/h: no worker on the ground moves faster between two fixes. */
export const MAX_PLAUSIBLE_SPEED_MPS = 70;
/** Real GPS coordinates drift a little between fixes; identical ones this far apart are worth a look. */
export const FROZEN_MIN_INTERVAL_MS = 30_000;

/** One position as the heuristics need it. `timestamp` is the fix's own time (ms since epoch). */
export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
}

export interface LocationReading extends LocationFix {
  altitude: number | null;
  mockLocationState: MockLocationState;
  locationSignals: LocationSignal[];
}

/** Why no reading: the screens turn each kind into their own Arabic message. */
export type LocationFailure =
  /** `canAskAgain: false`: the phone no longer shows the prompt, only the settings can fix it. */
  | { kind: "permission"; canAskAgain: boolean }
  | { kind: "servicesOff" }
  | { kind: "location" };

export type LocationResult = { ok: true; reading: LocationReading } | { ok: false; failure: LocationFailure };

/**
 * DETECTED / NOT_DETECTED from Android's flag; UNAVAILABLE everywhere else
 * (iOS and the web cannot tell, so their answer is never "not detected"),
 * and on an Android fix without the flag.
 */
export function mockLocationStateFor(position: { mocked?: boolean }, platform: string = Platform.OS): MockLocationState {
  if (platform !== "android" || typeof position.mocked !== "boolean") return MockLocationState.UNAVAILABLE;
  return position.mocked ? MockLocationState.DETECTED : MockLocationState.NOT_DETECTED;
}

/** Great-circle distance in meters (the shared haversine the API's own geofence math mirrors). */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  return haversineDistanceMeters(a, b);
}

/**
 * The heuristics, comparing a new fix with the previous one. Two fixes a few
 * meters apart within a second are normal GPS jitter, so the distance used
 * for the speed leaves out both fixes' accuracy radius first.
 */
export function movementSignals(previous: LocationFix | null, current: LocationFix): LocationSignal[] {
  const signals: LocationSignal[] = [];
  if (current.accuracy === 0) signals.push(LocationSignal.ZERO_ACCURACY);
  if (!previous) return signals;

  const elapsedMs = current.timestamp - previous.timestamp;
  if (elapsedMs > 0) {
    const slack = (previous.accuracy ?? 0) + (current.accuracy ?? 0);
    const speed = Math.max(0, distanceMeters(previous, current) - slack) / (elapsedMs / 1000);
    if (speed > MAX_PLAUSIBLE_SPEED_MPS) signals.push(LocationSignal.IMPOSSIBLE_SPEED);
  }
  if (elapsedMs >= FROZEN_MIN_INTERVAL_MS && previous.latitude === current.latitude && previous.longitude === current.longitude) {
    signals.push(LocationSignal.FROZEN_POSITION);
  }
  return signals;
}

// The last fix this app saw (clock events and the live distance), kept in memory only.
let lastFix: LocationFix | null = null;

function fixOf(position: Location.LocationObject): LocationFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: typeof position.coords.accuracy === "number" ? position.coords.accuracy : null,
    timestamp: position.timestamp,
  };
}

/** Remembers a fix (from the live distance watch) for the next reading's heuristics. */
export function rememberFix(position: Location.LocationObject): void {
  lastFix = fixOf(position);
}

/** Forgets the previous fix (tests; a new session). */
export function resetLocationHistory(): void {
  lastFix = null;
}

/** A position as sent with a clock event: the mock state, and the heuristics against the previous fix. */
export function toReading(position: Location.LocationObject, platform: string = Platform.OS): LocationReading {
  const fix = fixOf(position);
  const locationSignals = movementSignals(lastFix, fix);
  lastFix = fix;
  return {
    ...fix,
    altitude: typeof position.coords.altitude === "number" ? position.coords.altitude : null,
    mockLocationState: mockLocationStateFor(position, platform),
    locationSignals,
  };
}

/** True only when the phone reports that its location services (GPS) are switched off. */
export async function locationServicesOff(): Promise<boolean> {
  try {
    return (await Location.hasServicesEnabledAsync()) === false;
  } catch {
    return false;
  }
}

/**
 * Asks for the location permission and reads one high-accuracy fix. Never
 * throws: a failure says why, so the screen can say what to do in Arabic.
 */
export async function readLocation(platform: string = Platform.OS): Promise<LocationResult> {
  let position: Location.LocationObject;
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      // iOS answers "denied" while location services are off for the whole phone.
      return {
        ok: false,
        failure: (await locationServicesOff()) ? { kind: "servicesOff" } : { kind: "permission", canAskAgain: permission.canAskAgain !== false },
      };
    }
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    // GPS switched off (Android rejects) versus a timeout or a weak signal.
    return { ok: false, failure: (await locationServicesOff()) ? { kind: "servicesOff" } : { kind: "location" } };
  }
  return { ok: true, reading: toReading(position, platform) };
}

/** The fields every clock event carries for its location (the API's clock-in / clock-out DTOs). */
export function clockLocationFields(reading: LocationReading) {
  return {
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracyMeters: reading.accuracy ?? 9999,
    altitude: reading.altitude ?? undefined,
    locationProvider: "expo-location",
    // The existing server rule reads this flag; it is only ever true when Android said so.
    mockLocationSuspected: reading.mockLocationState === MockLocationState.DETECTED,
  };
}

// ── Live distance (shift details) ───────────────────────────────────────────

export interface DistanceTarget {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export type LiveDistance =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "permission"; canAskAgain: boolean }
  | { status: "servicesOff" }
  | { status: "unavailable" }
  | {
      status: "located";
      latitude: number;
      longitude: number;
      accuracy: number | null;
      /** Rounded meters from the target's center. */
      distanceMeters: number;
      /** Within the radius (for information only: the server decides at clock-in). */
      inside: boolean;
    };

/** Where a fix stands against the target. */
export function distanceFrom(position: { latitude: number; longitude: number; accuracy: number | null }, target: DistanceTarget): LiveDistance {
  const meters = Math.round(distanceMeters(position, target));
  return { status: "located", latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy, distanceMeters: meters, inside: meters <= target.radiusMeters };
}

/**
 * Watches the phone's position while `active` (the screen is focused) and
 * keeps the distance to `target` up to date. The watch stops as soon as the
 * screen loses focus or unmounts, so the GPS is not kept on in the background.
 */
export function useLiveDistance(target: DistanceTarget | null, active: boolean): LiveDistance {
  const [state, setState] = useState<LiveDistance>({ status: "idle" });
  const latitude = target?.latitude;
  const longitude = target?.longitude;
  const radiusMeters = target?.radiusMeters;

  useEffect(() => {
    if (!active || latitude === undefined || longitude === undefined || radiusMeters === undefined) return;
    const goal: DistanceTarget = { latitude, longitude, radiusMeters };
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const fail = async () => {
      const off = await locationServicesOff();
      if (!cancelled) setState(off ? { status: "servicesOff" } : { status: "unavailable" });
    };

    setState((current) => (current.status === "located" ? current : { status: "locating" }));
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== "granted") {
          const off = await locationServicesOff();
          if (!cancelled) setState(off ? { status: "servicesOff" } : { status: "permission", canAskAgain: permission.canAskAgain !== false });
          return;
        }
        const watch = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 5000 },
          (position) => {
            if (cancelled) return;
            rememberFix(position);
            setState(distanceFrom(fixOf(position), goal));
          },
          () => {
            void fail();
          },
        );
        if (cancelled) watch.remove();
        else subscription = watch;
      } catch {
        await fail();
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active, latitude, longitude, radiusMeters]);

  return state;
}
