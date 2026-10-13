import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { FilesService } from "../../common/files/files.service";
import { AuditService } from "../../common/audit/audit.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

/** How long a view URL of an identity document or photo stays valid. */
export const FILE_VIEW_URL_TTL_SECONDS = 60;

/** `GET /file-assets/:id/view-url` answer (the contract's `FileViewUrl`). */
export interface FileViewUrl {
  url: string;
  expiresInSeconds: number;
  contentType: string;
}

/** Owner access to uploaded files: a short-lived signed URL per view, every view audited. */
@Injectable()
export class FileAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly auditService: AuditService,
  ) {}

  async getViewUrl(organizationId: string, fileAssetId: string, actor: AuthenticatedUser, correlationId: string): Promise<FileViewUrl> {
    const asset = UUID_PATTERN.test(fileAssetId) ? await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, organizationId } }) : null;
    if (!asset) throw new AppException(404, ErrorCodes.NOT_FOUND, "File not found.");

    const url = await this.files.getSignedDownloadUrl(asset.storageKey, {
      expiresInSeconds: FILE_VIEW_URL_TTL_SECONDS,
      inline: true,
      contentType: asset.contentType,
    });
    // Recorded before the URL is handed out: a view is never unaudited.
    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "FILE_ASSET_VIEWED",
      entityType: "FileAsset",
      entityId: asset.id,
      correlationId,
    });
    return { url, expiresInSeconds: FILE_VIEW_URL_TTL_SECONDS, contentType: asset.contentType };
  }
}
