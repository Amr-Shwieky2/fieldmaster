# Geofencing

## The one rule that matters

**The client's own belief about being inside a geofence is never trusted.**
Every clock-in against a `GEOFENCED` shift is validated server-side using
real PostGIS geospatial functions against the database's own copy of the
geofence, regardless of what the mobile app computed locally. The mobile
app requests high-accuracy GPS and displays it to the worker for their own
awareness, but the pass/fail decision is made once, in
`GeofenceValidationService`, on the server.

## Implementation

Prisma has no first-class PostGIS type, so geofence centers are stored as
plain `Float` latitude/longitude columns on the `geofences` table, and the
authoritative check runs as a raw parameterized query:

```sql
SELECT ST_DWithin(
  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
  ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
  $5
) AS within_radius,
ST_Distance(
  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
  ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
) AS distance_meters;
```

(see `GeofenceValidationService.check()`, `apps/api/src/modules/sites/`).
Casting to `::geography` makes `ST_DWithin`/`ST_Distance` compute a true
great-circle distance in meters on WGS84 (SRID 4326), not a flat-plane
approximation — important at the coordinate precision this app deals with,
even though the areas involved are small.

`packages/shared-validation/src/geo.ts` additionally provides a pure
Haversine-distance function, used for fast unit tests that don't need a
database connection; it is not used for the actual authorization decision.

## Check-in methods

### `GEOFENCED`

Before a clock-in is accepted:

1. GPS coordinates must be present.
2. Accuracy must meet the geofence's configured `minAccuracyMeters`
   (default 50m) — `400 GPS_ACCURACY_TOO_LOW` otherwise, with the required
   vs. actual accuracy in `details`.
3. The reported position must fall within `radiusMeters` of the geofence
   center per the `ST_DWithin` check above — `400
   GEOFENCE_OUTSIDE_ALLOWED_RADIUS` otherwise, with `distanceMeters` and
   `allowedRadiusMeters` in `details` (enough for the worker to understand
   *why*, without exposing the server's full validation logic).
4. Mock-location suspicion (client-reported, e.g. from `expo-location`'s
   `position.mocked` flag) blocks the event outright with `403
   MOCK_LOCATION_BLOCKED` — see `security.md`.

A worker can also clock in via an active **temporary check-in point**
instead of the shift's own geofence (see below) by passing
`temporaryCheckInPointId` — the same distance/accuracy checks apply, just
against the temporary point's own center/radius
(`DEFAULT_TEMP_POINT_MIN_ACCURACY_METERS = 75`, slightly looser than a
permanent site's default, since these are ad-hoc mobile-crew rally points).

### `FLEXI_CHECK`

No radius restriction — intended for mobile Ramzanim crews and emergency
work where there's no fixed site to fence. The exact GPS position and
accuracy are still captured and stored (never skipped), and are visible to
the Owner and the assigned Field Manager on the same evidence surfaces a
geofenced clock-in uses. The `TimeEntry.checkInMethod` is recorded as
`FLEXI_CHECK` so approval screens and reports can distinguish it from a
geofence pass.

## Temporary check-in points

Created by a worker acting as Temporary Supervisor for their assigned
shift (`TemporaryCheckInPointsService`), or by a Field Manager/Owner
directly. Usable only by workers assigned to that shift; expires
automatically when the shift closes (`isCurrentlyActive()` checks both an
explicit `expiresAt` and the parent shift's status). A background BullMQ
job (`QueueModule`) sweeps and marks stale points `EXPIRED` on a 60-second
interval as a backstop, independent of the lazy check performed at
clock-in time. Expired/revoked points are never deleted — they remain in
audit history, just excluded from active use.

## Offline events and geofencing

An offline-queued clock-in event still carries the geofence check — it
isn't skipped just because the device was offline when it was captured.
The check runs when the batch is synced, using
`ClockEventsService.clockInCore` (the same code path online clock-ins use)
with `origin: OFFLINE`. A worker who was genuinely outside the geofence
while offline gets exactly the same `GEOFENCE_OUTSIDE_ALLOWED_RADIUS`
rejection they would have gotten online — offline mode changes *when* the
check runs, never *whether* it runs. See `offline-sync.md`.

## What's not implemented

Device attestation (Play Integrity / App Attest / DeviceCheck) and OS-level
mock-location provider detection beyond the client-reported `mocked` flag
— see `security.md` and `technical-decisions.md` for the honest scope
boundary here. The schema already has `attestationState`/`riskState`
columns on `user_devices` for a mobile client to populate in a future pass
without a migration.
