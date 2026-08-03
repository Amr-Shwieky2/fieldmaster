import { Module } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import { OrganizationsController } from "./organizations.controller";
import { OwnerLimitService } from "./owner-limit.service";

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OwnerLimitService],
  exports: [OwnerLimitService],
})
export class OrganizationsModule {}
