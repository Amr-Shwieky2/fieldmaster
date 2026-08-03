import { Module } from "@nestjs/common";
import { SitesService } from "./sites.service";
import { SitesController } from "./sites.controller";
import { GeofenceValidationService } from "./geofence-validation.service";

@Module({
  controllers: [SitesController],
  providers: [SitesService, GeofenceValidationService],
  exports: [GeofenceValidationService, SitesService],
})
export class SitesModule {}
