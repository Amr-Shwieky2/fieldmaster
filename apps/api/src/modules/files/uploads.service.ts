import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES, type FileAssetPurpose } from "@fieldmaster/shared-types";
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

/** `POST /onboarding/invitations/:token/uploads` answer (the contract's `UploadedFile`). */
export interface StoredUpload {
  fileAssetId: string;
  purpose: FileAssetPurpose;
  contentType: string;
  sizeBytes: number;
}

/**
 * Files uploaded on the public onboarding page (Step 8): at most
 * MAX_UPLOAD_BYTES; typed by their content (magic bytes), never by the file
 * name or the client's mimetype; images stored without their metadata;
 * passed through the malware-scan hook; kept in private object storage under
 * `onboarding/<organizationId>/<invitationId>/<fileAssetId>`. File names and
 * contents are never logged (nor stored: only the bytes, under an id).
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  async storeOnboardingUpload(
    invitation: { id: string; organizationId: string },
    purpose: FileAssetPurpose,
    file: Express.Multer.File | undefined,
  ): Promise<StoredUpload> {
    if (!file) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, 'Attach the file in the multipart field "file".');
    const received = file.buffer;
    if (received.length > MAX_UPLOAD_BYTES) throw fileTooLarge();

    const contentType = detectContentType(received);
    const allowed: readonly string[] = UPLOAD_CONTENT_TYPES[purpose];
    if (contentType === null || !allowed.includes(contentType)) throw fileTypeNotAllowed(purpose);

    const alreadyStored = await this.prisma.fileAsset.count({ where: { invitationId: invitation.id } });
    if (alreadyStored >= MAX_UPLOADS_PER_INVITATION) {
      throw new AppException(429, ErrorCodes.RATE_LIMITED, "Too many files were uploaded with this invitation.");
    }

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
    const storageKey = `onboarding/${invitation.organizationId}/${invitation.id}/${fileAssetId}`;
    await this.files.putObject(storageKey, stored, contentType);
    try {
      await this.prisma.fileAsset.create({
        data: {
          id: fileAssetId,
          organizationId: invitation.organizationId,
          purpose,
          storageKey,
          contentType,
          sizeBytes: stored.length,
          sha256: createHash("sha256").update(stored).digest("hex"),
          scanResult,
          invitationId: invitation.id,
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
