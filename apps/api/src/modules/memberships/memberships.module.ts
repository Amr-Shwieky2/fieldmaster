import { Module } from "@nestjs/common";
import { MembershipsService } from "./memberships.service";
import { MembershipsController } from "./memberships.controller";
import { OrganizationsModule } from "../organizations/organizations.module";
import { DevicesModule } from "../devices/devices.module";

@Module({
  imports: [OrganizationsModule, DevicesModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
