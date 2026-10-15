import { Module } from "@nestjs/common";
import { SitesService } from "./sites.service";
import { SitesController } from "./sites.controller";
import { GeofenceValidationService } from "./geofence-validation.service";
import { WorkLocationsService } from "./work-locations.service";
import { WorkLocationsController } from "./work-locations.controller";

@Module({
  controllers: [SitesController, WorkLocationsController],
  providers: [SitesService, GeofenceValidationService, WorkLocationsService],
  exports: [GeofenceValidationService, SitesService],
})
export class SitesModule {}
