import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { FileAssetPurpose } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";

/** Whose uploads a clock event may use: the caller's own, in their organization. */
export interface AttachmentOwner {
  organizationId: string;
  workerProfileId: string;
}

/** The uploads one clock-in or clock-out references (Step 9). */
export interface ClockEventAttachments {
  photoAssetIds?: string[];
  /** Clock-out only. */
  voiceNoteAssetId?: string;
}

type AttachmentField = "photoAssetIds" | "voiceNoteAssetId";

function uploadNotFound(field: AttachmentField): AppException {
  return new AppException(400, ErrorCodes.UPLOAD_NOT_FOUND, "An attached file was not found among your unused uploads. Upload it again.", { field });
}

/** An upload a clock event may still use: the caller's own, of the right purpose, and not attached to any entry yet. */
function usable(owner: AttachmentOwner, purpose: FileAssetPurpose): Prisma.FileAssetWhereInput {
  return { organizationId: owner.organizationId, workerProfileId: owner.workerProfileId, purpose, timeEntryId: null };
}

/**
 * The attendance photos and the voice summary a clock-in or clock-out uses
 * (Step 9). They are uploaded first (`POST /attachments`) and must be the
 * caller's own, unused uploads of the right purpose; anything else -- another
 * worker's file, one already attached, a photo given as the voice note -- is
 * 400 UPLOAD_NOT_FOUND with `details.field`. They are linked to the time
 * entry (`file_assets.time_entry_id`) inside the clock event's transaction.
 */
@Injectable()
export class AttendanceAttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Checked before anything is written, so the worker gets the error before the clock event exists. */
  async assertUsable(owner: AttachmentOwner, refs: ClockEventAttachments): Promise<void> {
    const photoIds = refs.photoAssetIds ?? [];
    if (photoIds.length > 0) {
      const found = await this.prisma.fileAsset.count({ where: { ...usable(owner, FileAssetPurpose.ATTENDANCE_PHOTO), id: { in: photoIds } } });
      if (found !== photoIds.length) throw uploadNotFound("photoAssetIds");
    }
    if (refs.voiceNoteAssetId) {
      const found = await this.prisma.fileAsset.count({
        where: { ...usable(owner, FileAssetPurpose.VOICE_SUMMARY), id: refs.voiceNoteAssetId, voiceSummaryOf: { is: null } },
      });
      if (found !== 1) throw uploadNotFound("voiceNoteAssetId");
    }
  }

  /**
   * Links the uploads to the entry, inside the clock event's transaction. The
   * claim is conditional (still unused), so two clock events racing for the
   * same upload cannot both get it: the loser's transaction rolls back with
   * the same 400.
   */
  async attach(tx: Prisma.TransactionClient, owner: AttachmentOwner, timeEntryId: string, refs: ClockEventAttachments): Promise<void> {
    const photoIds = refs.photoAssetIds ?? [];
    if (photoIds.length > 0) {
      const claimed = await tx.fileAsset.updateMany({
        where: { ...usable(owner, FileAssetPurpose.ATTENDANCE_PHOTO), id: { in: photoIds } },
        data: { timeEntryId },
      });
      if (claimed.count !== photoIds.length) throw uploadNotFound("photoAssetIds");
    }
    if (refs.voiceNoteAssetId) {
      const claimed = await tx.fileAsset.updateMany({
        where: { ...usable(owner, FileAssetPurpose.VOICE_SUMMARY), id: refs.voiceNoteAssetId },
        data: { timeEntryId },
      });
      if (claimed.count !== 1) throw uploadNotFound("voiceNoteAssetId");
    }
  }
}
