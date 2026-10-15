import { Controller, Get, Header, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { FileAssetsService } from "./file-assets.service";

@ApiBearerAuth()
@ApiTags("file-assets")
@Controller("file-assets")
export class FileAssetsController {
  constructor(private readonly fileAssetsService: FileAssetsService) {}

  /** Owner only (a financial permission: identity documents sit with bank details), audited per view. */
  @Get(":id/view-url")
  @RequirePermissions(Permission.VIEW_BANK_INFO)
  @Header("Cache-Control", "no-store")
  async getViewUrl(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.fileAssetsService.getViewUrl(user.organizationId, id, user, correlationId);
  }
}

/** Mobile manager mode: an entry's attendance photo, opened from the review screen (VIEW_ATTENDANCE, within the reader's projects; audited per view). */
@ApiBearerAuth()
@ApiTags("file-assets")
@Controller("time-entries")
export class EntryPhotosController {
  constructor(private readonly fileAssetsService: FileAssetsService) {}

  @Get(":id/photos/:photoId/view-url")
  @RequirePermissions(Permission.VIEW_ATTENDANCE)
  @Header("Cache-Control", "no-store")
  async getPhotoViewUrl(@Param("id") id: string, @Param("photoId") photoId: string, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.fileAssetsService.getEntryPhotoViewUrl(user.organizationId, id, photoId, user, correlationId);
  }
}
