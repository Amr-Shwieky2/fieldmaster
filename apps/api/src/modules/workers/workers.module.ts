import { Module } from "@nestjs/common";
import { FileAssetsModule } from "../files/file-assets.module";
import { WorkersService } from "./workers.service";
import { WorkersController } from "./workers.controller";
import { OnboardingService } from "./onboarding.service";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingReviewService } from "./onboarding-review.service";

@Module({
  imports: [FileAssetsModule],
  controllers: [WorkersController, OnboardingController],
  providers: [WorkersService, OnboardingService, OnboardingReviewService],
  exports: [WorkersService],
})
export class WorkersModule {}
