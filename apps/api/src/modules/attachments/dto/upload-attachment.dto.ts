import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { ATTACHMENT_FILE_PURPOSES, type AttachmentFilePurpose } from "@fieldmaster/shared-types";

/** The text field of `POST /attachments` (multipart, next to the `file` field). */
export class UploadAttachmentDto {
  // Only the mobile app's purposes: identity documents and profile photos come from the onboarding page alone.
  @ApiProperty({ enum: ATTACHMENT_FILE_PURPOSES })
  @IsIn([...ATTACHMENT_FILE_PURPOSES])
  purpose!: AttachmentFilePurpose;
}
