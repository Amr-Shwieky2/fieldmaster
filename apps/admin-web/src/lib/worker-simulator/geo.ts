/** Mean Earth radius (IUGG), metres. */
const EARTH_RADIUS_METERS = 6_371_008.8;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface CircleArea extends LatLng {
  radiusMeters: number;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle (haversine) distance in metres. The API measures on the
 * PostGIS geography type; for the few hundred metres around a site the two
 * differ by well under a metre, so the simulator labels its value approximate.
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where a point is relative to a circle: distance to its center and to its edge (always >= 0) and whether it is inside. */
export function relationToCircle(point: LatLng, circle: CircleArea) {
  const toCenter = distanceMeters(point, circle);
  return { toCenter, toEdge: Math.abs(circle.radiusMeters - toCenter), inside: toCenter <= circle.radiusMeters };
}

/** The point `northMeters` north and `eastMeters` east of `origin` (negative values go south / west). */
export function offsetByMeters(origin: LatLng, northMeters: number, eastMeters: number): LatLng {
  const latitude = origin.latitude + (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const longitude = origin.longitude + (eastMeters / (EARTH_RADIUS_METERS * Math.cos(toRadians(origin.latitude)))) * (180 / Math.PI);
  return { latitude, longitude };
}
