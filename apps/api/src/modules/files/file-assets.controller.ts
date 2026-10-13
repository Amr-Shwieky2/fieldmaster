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
