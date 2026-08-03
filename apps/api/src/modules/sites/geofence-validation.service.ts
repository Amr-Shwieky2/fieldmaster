import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

export interface GeofenceCheckResult {
  withinRadius: boolean;
  distanceMeters: number;
  allowedRadiusMeters: number;
}

/**
 * Authoritative, server-side geofence check using PostGIS `ST_DWithin` over
 * `geography` (spec section 17.3) -- never trust a client-reported
 * "inside geofence" boolean. `packages/shared-validation`'s haversine
 * function is a unit-testable mirror of this same math for pure-function
 * tests; this is the real check the API enforces.
 */
@Injectable()
export class GeofenceValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    workerLatitude: number,
    workerLongitude: number,
    centerLatitude: number,
    centerLongitude: number,
    radiusMeters: number,
  ): Promise<GeofenceCheckResult> {
    const rows = await this.prisma.$queryRaw<{ within: boolean; distance: number }[]>`
      SELECT
        ST_DWithin(
          ST_SetSRID(ST_MakePoint(${workerLongitude}, ${workerLatitude}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${centerLongitude}, ${centerLatitude}), 4326)::geography,
          ${radiusMeters}
        ) AS within,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(${workerLongitude}, ${workerLatitude}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${centerLongitude}, ${centerLatitude}), 4326)::geography
        ) AS distance
    `;
    const row = rows[0];
    return {
      withinRadius: row.within,
      distanceMeters: Math.round(Number(row.distance)),
      allowedRadiusMeters: radiusMeters,
    };
  }
}
