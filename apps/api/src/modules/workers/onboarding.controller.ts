import { Body, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { FileAssetPurpose } from "@fieldmaster/shared-types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { UploadsService } from "../files/uploads.service";
import { SingleUploadInterceptor } from "../files/single-upload.interceptor";
import { OnboardingService, type ActiveInvitation } from "./onboarding.service";
import { WorkersService } from "./workers.service";
import { ActiveInvitationGuard, CurrentInvitation } from "./active-invitation.guard";
import { OnboardingRateLimit } from "./onboarding-rate-limit";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import { JoinApplicationDto } from "./dto/join-application.dto";
import { UploadFileDto } from "./dto/upload-file.dto";

@ApiTags("onboarding")
@Controller()
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly workersService: WorkersService,
    private readonly uploadsService: UploadsService,
  ) {}

  // ── Invitations (Owners and Field Managers) ──────────────────────────

  @ApiBearerAuth()
  @Post("onboarding-invitations")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async createInvitation(@Body() dto: CreateInvitationDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.onboardingService.createInvitation(user.organizationId, user, dto.prefilledPhoneNumber, correlationId);
  }

  @ApiBearerAuth()
  @Get("onboarding-invitations")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.listInvitations(user.organizationId);
  }

  @ApiBearerAuth()
  @Delete("onboarding-invitations/:id")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async revokeInvitation(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    await this.onboardingService.revokeInvitation(user.organizationId, id, user, correlationId);
    return { success: true };
  }

  /** Same rows as `GET /workers/pending-approval` (names and phone numbers only). */
  @ApiBearerAuth()
  @Get("onboarding-invitations/pending-workers")
  @RequirePermissions(Permission.APPROVE_ONBOARDING)
  async listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.workersService.listPendingApproval(user.organizationId);
  }

  // ── The public onboarding page (no sign-in, rate limited) ─────────────

  @Public()
  @OnboardingRateLimit()
  @UseGuards(ActiveInvitationGuard)
  @Get("onboarding/invitations/:token")
  async getPublicInvitation(@CurrentInvitation() invitation: ActiveInvitation) {
    return this.onboardingService.publicInvitation(invitation);
  }

  @Public()
  @OnboardingRateLimit()
  @UseGuards(ActiveInvitationGuard)
  @UseInterceptors(SingleUploadInterceptor)
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["purpose", "file"],
      properties: { purpose: { type: "string", enum: Object.values(FileAssetPurpose) }, file: { type: "string", format: "binary" } },
    },
  })
  @Post("onboarding/invitations/:token/uploads")
  async upload(@CurrentInvitation() invitation: ActiveInvitation, @Body() dto: UploadFileDto, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.uploadsService.storeOnboardingUpload(invitation, dto.purpose, file);
  }

  @Public()
  @OnboardingRateLimit()
  @UseGuards(ActiveInvitationGuard)
  @Post("onboarding/invitations/:token/redeem")
  async redeem(@CurrentInvitation() invitation: ActiveInvitation, @Body() dto: JoinApplicationDto, @CorrelationId() correlationId: string) {
    return this.onboardingService.submitApplication(invitation, dto, correlationId);
  }
}
