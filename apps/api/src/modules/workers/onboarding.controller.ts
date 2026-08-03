import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OnboardingService } from "./onboarding.service";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import { RedeemInvitationDto } from "./dto/redeem-invitation.dto";

@ApiTags("onboarding")
@Controller()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @ApiBearerAuth()
  @Post("onboarding-invitations")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async createInvitation(@Body() dto: CreateInvitationDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.onboardingService.createInvitation(user.organizationId, user, dto.prefilledPhoneNumber, correlationId);
  }

  @ApiBearerAuth()
  @Delete("onboarding-invitations/:id")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async revokeInvitation(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    await this.onboardingService.revokeInvitation(user.organizationId, id, user, correlationId);
    return { success: true };
  }

  @ApiBearerAuth()
  @Get("onboarding-invitations/pending-workers")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.listPending(user.organizationId);
  }

  @Public()
  @Post("onboarding/redeem")
  async redeem(@Body() dto: RedeemInvitationDto, @CorrelationId() correlationId: string) {
    return this.onboardingService.redeem(dto, correlationId);
  }
}
