/** The simulated phone: where it is, how good its GPS fix is, how wrong its clock is, and whether it has a connection. */
export interface SimulatedDevice {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  /** Added to the computer's clock for `deviceTimestamp`; can be negative. */
  clockOffsetSeconds: number;
  mockLocationSuspected: boolean;
  online: boolean;
}

/** Stored on every clock event as `locationProvider`, so simulator events are recognisable in the data. */
export const SIMULATOR_LOCATION_PROVIDER = "admin-web-worker-simulator";

/** Seeded site 0 (Tel Aviv) -- only used until a shift with a geofence is selected. */
export const DEFAULT_DEVICE: SimulatedDevice = {
  latitude: 32.0853,
  longitude: 34.7818,
  accuracyMeters: 10,
  clockOffsetSeconds: 0,
  mockLocationSuspected: false,
  online: true,
};

/** The phone's own idea of "now" (ISO), including the configured clock offset. */
export function deviceTimestamp(device: Pick<SimulatedDevice, "clockOffsetSeconds">, now: number = Date.now()): string {
  return new Date(now + device.clockOffsetSeconds * 1000).toISOString();
}

/** A fresh id for one clock event; also used as its Idempotency-Key, like the mobile app does. */
export function newClientEventId(kind: string): string {
  return `sim-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Location fields of a clock-in / clock-out request, as the mobile app sends them. */
export function clockLocationFields(device: SimulatedDevice) {
  return {
    latitude: device.latitude,
    longitude: device.longitude,
    accuracyMeters: device.accuracyMeters,
    locationProvider: SIMULATOR_LOCATION_PROVIDER,
    mockLocationSuspected: device.mockLocationSuspected,
  };
}

/** The emergency call-out endpoints accept only these location fields (no provider or mock flag; the API rejects unknown fields). */
export function emergencyLocationFields(device: SimulatedDevice) {
  return { latitude: device.latitude, longitude: device.longitude, accuracyMeters: device.accuracyMeters };
}
