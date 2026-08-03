import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { MembershipsService } from "./memberships.service";
import { CreateMembershipDto } from "./dto/create-membership.dto";

@ApiBearerAuth()
@ApiTags("memberships")
@Controller("memberships")
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  async create(@Body() dto: CreateMembershipDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.membershipsService.create(user.organizationId, dto, user, correlationId);
  }

  @Get()
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.membershipsService.list(user.organizationId);
  }
}
