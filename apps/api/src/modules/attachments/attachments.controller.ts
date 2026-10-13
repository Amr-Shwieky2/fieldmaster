import { Body, Controller, HttpCode, HttpStatus, Param, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { ATTACHMENT_FILE_PURPOSES } from "@fieldmaster/shared-types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { SingleUploadInterceptor } from "../files/single-upload.interceptor";
import { AttachmentUploadGuard } from "./attachment-upload.guard";
import { AttachmentsService } from "./attachments.service";
import { UploadAttachmentDto } from "./dto/upload-attachment.dto";

/**
 * The mobile app's attachments (Step 9): attendance photos and voice
 * summaries, uploaded first and referenced by id at clock-in / clock-out
 * (`photoAssetIds`, `voiceNoteAssetId`). Private: no URL is ever handed out to
 * the worker, and only the uploader can attach or transcribe them.
 */
@ApiBearerAuth()
@ApiTags("attachments")
@Controller("attachments")
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  @UseGuards(AttachmentUploadGuard)
  @UseInterceptors(SingleUploadInterceptor)
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["purpose", "file"],
      properties: { purpose: { type: "string", enum: [...ATTACHMENT_FILE_PURPOSES] }, file: { type: "string", format: "binary" } },
    },
  })
  upload(@Body() dto: UploadAttachmentDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.attachments.upload(user, dto.purpose, file);
  }

  /** The caller's own voice summary as Arabic text; 503 TRANSCRIPTION_UNAVAILABLE when no provider can produce it. */
  @Post(":id/transcription")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  transcribe(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attachments.transcribe(user, id);
  }
}
