import { Logger, Module } from "@nestjs/common";
import { FileAssetsModule } from "../files/file-assets.module";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsService } from "./attachments.service";
import { AttachmentUploadGuard } from "./attachment-upload.guard";
import {
  MockTranscriptionService,
  TRANSCRIPTION_SERVICE,
  UnavailableTranscriptionService,
  resolveTranscriptionProvider,
  type TranscriptionService,
} from "./transcription";

/**
 * Step 9: the mobile app's private attachments (`POST /attachments`) and the
 * transcription of voice summaries. The transcription provider comes from
 * TRANSCRIPTION_PROVIDER (see `resolveTranscriptionProvider`), resolved once
 * when the module starts; an invalid value stops the API from starting.
 */
@Module({
  imports: [FileAssetsModule],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    AttachmentUploadGuard,
    MockTranscriptionService,
    UnavailableTranscriptionService,
    {
      provide: TRANSCRIPTION_SERVICE,
      useFactory: (mock: MockTranscriptionService, none: UnavailableTranscriptionService): TranscriptionService => {
        const provider = resolveTranscriptionProvider();
        new Logger("Transcription").log(`Transcription provider: ${provider}`);
        return provider === "mock" ? mock : none;
      },
      inject: [MockTranscriptionService, UnavailableTranscriptionService],
    },
  ],
})
export class AttachmentsModule {}
