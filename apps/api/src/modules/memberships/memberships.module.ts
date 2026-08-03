import { Module } from "@nestjs/common";
import { MembershipsService } from "./memberships.service";
import { MembershipsController } from "./memberships.controller";
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [OrganizationsModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
