import { Module } from "@nestjs/common";
import { WorkersService } from "./workers.service";
import { WorkersController } from "./workers.controller";
import { OnboardingService } from "./onboarding.service";
import { OnboardingController } from "./onboarding.controller";

@Module({
  controllers: [WorkersController, OnboardingController],
  providers: [WorkersService, OnboardingService],
  exports: [WorkersService],
})
export class WorkersModule {}
