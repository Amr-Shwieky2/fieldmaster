import { distanceMeters, readLocation, type LocationResult } from "../../lib/location";
import type { LatLng, Region } from "../maps/Map";

/** Israel as a whole: where the map starts when the phone's position is unknown (the manager places the pin by hand). */
export const FALLBACK_REGION: Region = { latitude: 31.6, longitude: 34.95, latitudeDelta: 3.2, longitudeDelta: 3.2 };

/** How long the screens wait for a first position before going on without it (a weak GPS signal must not hold the form). */
export const positionTimeout = { ms: 10_000 };

const METERS_PER_DEGREE = 111_320;

/** A map region around `center` that shows a circle of `radiusMeters` with room around it. */
export function regionAround(center: LatLng, radiusMeters: number): Region {
  const latitudeDelta = Math.max((radiusMeters * 5) / METERS_PER_DEGREE, 0.004);
  const longitudeDelta = latitudeDelta / Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.2);
  return { latitude: center.latitude, longitude: center.longitude, latitudeDelta, longitudeDelta };
}

/** The phone's position (asking for the permission), or why not; "location" when it takes longer than `ms`. */
export async function readPosition(ms: number = positionTimeout.ms): Promise<LocationResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LocationResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, failure: { kind: "location" } }), ms);
  });
  try {
    return await Promise.race([readLocation(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `items` nearest first from `from` (great-circle distance); without a position the order is kept. */
export function nearestFirst<T extends LatLng>(items: readonly T[], from: LatLng | null): { item: T; meters: number | null }[] {
  const withDistance = items.map((item) => ({ item, meters: from ? distanceMeters(from, item) : null }));
  if (!from) return withDistance;
  // A stable sort: two sites at the same distance keep the API's order.
  return withDistance.map((entry, index) => ({ entry, index })).sort((a, b) => (a.entry.meters ?? 0) - (b.entry.meters ?? 0) || a.index - b.index).map(({ entry }) => entry);
}
