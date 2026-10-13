import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { ONBOARDING_FILE_PURPOSES, type OnboardingFilePurpose } from "@fieldmaster/shared-types";

/** The text field of `POST /onboarding/invitations/:token/uploads` (multipart, next to the `file` field). */
export class UploadFileDto {
  // The public page uploads only an identity document or a profile photo (Step 9 added purposes for signed-in workers).
  @ApiProperty({ enum: ONBOARDING_FILE_PURPOSES })
  @IsIn([...ONBOARDING_FILE_PURPOSES])
  purpose!: OnboardingFilePurpose;
}
