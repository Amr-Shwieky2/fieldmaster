import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { FileAssetPurpose, MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES, type AttachmentFilePurpose } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { FilesService } from "../../common/files/files.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { generateId } from "../../common/ids";
import { detectContentType } from "./content-type";
import { InvalidFileStructureError, stripMetadata } from "./image-metadata";
import { MALWARE_SCANNER, type MalwareScanner } from "./malware-scanner";
import { fileTooLarge, fileTypeNotAllowed } from "./upload-errors";

/** Stored files per invitation: room for retakes, a bound on what one link can put in storage. */
export const MAX_UPLOADS_PER_INVITATION = 20;

/**
 * Step 9: a worker's attachments not used by any clock-in or clock-out yet
 * (photos and voice summaries). Room for retakes on a long day, a bound on
 * what one account can put in storage; over it, 429 RATE_LIMITED.
 */
export const MAX_UNATTACHED_ATTACHMENTS_PER_WORKER = 50;

/** `POST /onboarding/invitations/:token/uploads` answer (the contract's `UploadedFile`). */
export interface StoredUpload {
  fileAssetId: string;
  purpose: FileAssetPurpose;
  contentType: string;
  sizeBytes: number;
}

/** Who a signed-in worker's attachment belongs to (Step 9). */
export interface AttachmentOwner {
  organizationId: string;
  workerProfileId: string;
}

interface StoreOptions {
  /** Throws (429) when the owner already stored too many files; called once the file is known to be acceptable. */
  assertQuota: () => Promise<void>;
  storageKey: (fileAssetId: string) => string;
  /** The FileAsset columns that say whose file it is. */
  owner: { organizationId: string; invitationId?: string; workerProfileId?: string };
}

/**
 * Uploaded files (Step 8: the public onboarding page; Step 9: a signed-in
 * worker's attendance photos and voice summaries): at most MAX_UPLOAD_BYTES;
 * typed by their content (magic bytes), never by the file name or the
 * client's mimetype; images stored without their metadata (audio as
 * received); passed through the malware-scan hook; kept in private object
 * storage. File names and contents are never logged (nor stored: only the
 * bytes, under an id).
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  /** Stored under `onboarding/<organizationId>/<invitationId>/<fileAssetId>`. */
  async storeOnboardingUpload(
    invitation: { id: string; organizationId: string },
    purpose: FileAssetPurpose,
    file: Express.Multer.File | undefined,
  ): Promise<StoredUpload> {
    return this.store(purpose, file, {
      assertQuota: async () => {
        const alreadyStored = await this.prisma.fileAsset.count({ where: { invitationId: invitation.id } });
        if (alreadyStored >= MAX_UPLOADS_PER_INVITATION) {
          throw new AppException(429, ErrorCodes.RATE_LIMITED, "Too many files were uploaded with this invitation.");
        }
      },
      storageKey: (fileAssetId) => `onboarding/${invitation.organizationId}/${invitation.id}/${fileAssetId}`,
      owner: { organizationId: invitation.organizationId, invitationId: invitation.id },
    });
  }

  /**
   * Step 9 (`POST /attachments`): an attendance photo or a voice summary of a
   * signed-in worker, stored under
   * `attachments/<organizationId>/<workerProfileId>/<fileAssetId>` with the
   * worker's profile and no time entry yet (a clock-in or clock-out links it).
   */
  async storeAttachment(owner: AttachmentOwner, purpose: AttachmentFilePurpose, file: Express.Multer.File | undefined): Promise<StoredUpload> {
    return this.store(purpose, file, {
      assertQuota: () => this.assertAttachmentQuota(owner.workerProfileId),
      storageKey: (fileAssetId) => `attachments/${owner.organizationId}/${owner.workerProfileId}/${fileAssetId}`,
      owner: { organizationId: owner.organizationId, workerProfileId: owner.workerProfileId },
    });
  }

  /** 429 RATE_LIMITED once the worker has MAX_UNATTACHED_ATTACHMENTS_PER_WORKER attachments no clock event used yet. */
  async assertAttachmentQuota(workerProfileId: string): Promise<void> {
    const unattached = await this.prisma.fileAsset.count({
      where: {
        workerProfileId,
        timeEntryId: null,
        purpose: { in: [FileAssetPurpose.ATTENDANCE_PHOTO, FileAssetPurpose.VOICE_SUMMARY] },
      },
    });
    if (unattached >= MAX_UNATTACHED_ATTACHMENTS_PER_WORKER) {
      throw new AppException(429, ErrorCodes.RATE_LIMITED, "Too many files are waiting to be attached. Clock in or out with them first.", {
        maxUnattached: MAX_UNATTACHED_ATTACHMENTS_PER_WORKER,
      });
    }
  }

  private async store(purpose: FileAssetPurpose, file: Express.Multer.File | undefined, options: StoreOptions): Promise<StoredUpload> {
    if (!file) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, 'Attach the file in the multipart field "file".');
    const received = file.buffer;
    if (received.length > MAX_UPLOAD_BYTES) throw fileTooLarge();

    const contentType = detectContentType(received);
    const allowed: readonly string[] = UPLOAD_CONTENT_TYPES[purpose];
    if (contentType === null || !allowed.includes(contentType)) throw fileTypeNotAllowed(purpose);

    await options.assertQuota();

    let stored: Buffer;
    try {
      stored = stripMetadata(received, contentType);
    } catch (error) {
      // Starts like an image but is not a well-formed one.
      if (error instanceof InvalidFileStructureError) throw fileTypeNotAllowed(purpose);
      throw error;
    }

    const scanResult = await this.scanner.scan(stored, contentType);
    if (scanResult === "INFECTED") throw new AppException(422, ErrorCodes.FILE_REJECTED, "The file was rejected by the malware scan.");

    const fileAssetId = generateId();
    const storageKey = options.storageKey(fileAssetId);
    await this.files.putObject(storageKey, stored, contentType);
    try {
      await this.prisma.fileAsset.create({
        data: {
          id: fileAssetId,
          organizationId: options.owner.organizationId,
          purpose,
          storageKey,
          contentType,
          sizeBytes: stored.length,
          sha256: createHash("sha256").update(stored).digest("hex"),
          scanResult,
          invitationId: options.owner.invitationId ?? null,
          workerProfileId: options.owner.workerProfileId ?? null,
          timeEntryId: null,
        },
      });
    } catch (error) {
      // No row, no object: an object without its row could never be found again.
      await this.files.deleteObject(storageKey).catch(() => undefined);
      throw error;
    }

    return { fileAssetId, purpose, contentType, sizeBytes: stored.length };
  }
}
