import { Inject, Injectable, Logger } from "@nestjs/common";
import { FileAssetPurpose, type AttachmentFilePurpose } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { FilesService } from "../../common/files/files.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { UploadsService, type StoredUpload } from "../files/uploads.service";
import { MAX_TRANSCRIPTION_LENGTH, TRANSCRIPTION_SERVICE, TranscriptionUnavailableError, type TranscriptionService } from "./transcription";

/** `POST /attachments/:id/transcription` answer (the contract's `VoiceTranscription`). */
export interface VoiceTranscriptionResult {
  fileAssetId: string;
  text: string;
  provider: string;
  language: "ar";
}

/**
 * The mobile app's private attachments (Step 9): attendance photos and voice
 * summaries uploaded before the clock-in or clock-out that uses them, and the
 * transcription of a voice summary. Everything is scoped to the caller's own
 * worker profile; another worker's file does not exist for them (404).
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly uploads: UploadsService,
    @Inject(TRANSCRIPTION_SERVICE) private readonly transcription: TranscriptionService,
  ) {}

  async upload(actor: AuthenticatedUser, purpose: AttachmentFilePurpose, file: Express.Multer.File | undefined): Promise<StoredUpload> {
    // The guard already refused a caller without a worker profile; this keeps the service safe on its own.
    if (!actor.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "Only time-trackable members with a worker profile can upload attachments.");
    }
    return this.uploads.storeAttachment({ organizationId: actor.organizationId, workerProfileId: actor.workerProfileId }, purpose, file);
  }

  /** The caller's own voice summary as Arabic text. Never logged: neither the text nor the audio. */
  async transcribe(actor: AuthenticatedUser, fileAssetId: string): Promise<VoiceTranscriptionResult> {
    const asset =
      actor.workerProfileId && UUID_PATTERN.test(fileAssetId)
        ? await this.prisma.fileAsset.findFirst({
            where: { id: fileAssetId, organizationId: actor.organizationId, workerProfileId: actor.workerProfileId, purpose: FileAssetPurpose.VOICE_SUMMARY },
          })
        : null;
    if (!asset) throw new AppException(404, ErrorCodes.NOT_FOUND, "Voice summary not found.");

    try {
      const result = await this.transcription.transcribe({
        fileAssetId: asset.id,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        language: "ar",
        load: async () => {
          const bytes = await this.files.getObject(asset.storageKey);
          if (!bytes) throw new TranscriptionUnavailableError("The recording is missing from storage.");
          return bytes;
        },
      });
      return { fileAssetId: asset.id, text: result.text.slice(0, MAX_TRANSCRIPTION_LENGTH), provider: this.transcription.name, language: "ar" };
    } catch (error) {
      // Only the kind of failure: a provider's message could quote the recording.
      if (!(error instanceof TranscriptionUnavailableError)) {
        this.logger.warn(`Transcription of voice summary ${asset.id} failed (${error instanceof Error ? error.name : "unknown error"}).`);
      }
      throw new AppException(503, ErrorCodes.TRANSCRIPTION_UNAVAILABLE, "Transcription is not available right now. Type the summary instead, or try again later.");
    }
  }
}
