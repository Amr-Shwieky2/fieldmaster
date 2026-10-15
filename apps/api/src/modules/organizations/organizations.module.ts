import { Module } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import { OrganizationsController } from "./organizations.controller";
import { OwnerLimitService } from "./owner-limit.service";
import { WorkRulesAdminService } from "./work-rules-admin.service";

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OwnerLimitService, WorkRulesAdminService],
  exports: [OwnerLimitService],
})
export class OrganizationsModule {}
