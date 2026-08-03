const EARTH_RADIUS_METERS = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two WGS84 points, in meters.
 * Used for unit-testable geofence math; the API's authoritative check
 * uses PostGIS ST_DWithin over geography(Point,4326), which this mirrors.
 */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export interface GeofenceCheckResult {
  withinRadius: boolean;
  distanceMeters: number;
  allowedRadiusMeters: number;
}

export function checkGeofence(
  workerLocation: GeoPoint,
  center: GeoPoint,
  radiusMeters: number,
): GeofenceCheckResult {
  const distanceMeters = haversineDistanceMeters(workerLocation, center);
  return {
    withinRadius: distanceMeters <= radiusMeters,
    distanceMeters: Math.round(distanceMeters),
    allowedRadiusMeters: radiusMeters,
  };
}
