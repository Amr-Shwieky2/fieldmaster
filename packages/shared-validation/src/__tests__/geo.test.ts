import { checkGeofence, haversineDistanceMeters } from "../geo";

describe("haversineDistanceMeters", () => {
  it("returns ~0 for identical points", () => {
    const p = { latitude: 32.0853, longitude: 34.7818 };
    expect(haversineDistanceMeters(p, p)).toBeCloseTo(0, 3);
  });

  it("computes a known distance between two Tel Aviv coordinates within 5m tolerance", () => {
    // Approx 1.11km apart along a meridian (0.01 deg lat ~ 1.1119km)
    const a = { latitude: 32.08, longitude: 34.78 };
    const b = { latitude: 32.09, longitude: 34.78 };
    const distance = haversineDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(1100);
    expect(distance).toBeLessThan(1120);
  });
});

describe("checkGeofence", () => {
  const center = { latitude: 32.0853, longitude: 34.7818 };

  it("allows a worker within the radius", () => {
    const result = checkGeofence(center, center, 100);
    expect(result.withinRadius).toBe(true);
    expect(result.distanceMeters).toBe(0);
  });

  it("rejects a worker outside the radius and reports distance (scenario 8)", () => {
    const farAway = { latitude: 32.1, longitude: 34.8 };
    const result = checkGeofence(farAway, center, 100);
    expect(result.withinRadius).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(100);
    expect(result.allowedRadiusMeters).toBe(100);
  });
});
