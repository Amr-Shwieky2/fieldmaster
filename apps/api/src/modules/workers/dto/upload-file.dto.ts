import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { FileAssetPurpose } from "@fieldmaster/shared-types";

/** The text field of `POST /onboarding/invitations/:token/uploads` (multipart, next to the `file` field). */
export class UploadFileDto {
  @ApiProperty({ enum: Object.values(FileAssetPurpose) })
  @IsIn(Object.values(FileAssetPurpose))
  purpose!: FileAssetPurpose;
}
