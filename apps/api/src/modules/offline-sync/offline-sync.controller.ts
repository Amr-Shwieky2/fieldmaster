import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { hasPermission, Permission } from "../../common/auth/permissions";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OfflineSyncService } from "./offline-sync.service";
import { OfflineSyncBatchDto } from "./dto/offline-sync-batch.dto";
import { pageWindow } from "../../common/validation/page-query";

@ApiBearerAuth()
@ApiTags("offline-sync")
@Controller("offline-sync")
export class OfflineSyncController {
  constructor(private readonly offlineSyncService: OfflineSyncService) {}

  @Post("batches")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  submitBatch(
    @Body() dto: OfflineSyncBatchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.offlineSyncService.submitBatch(user.organizationId, dto, user, idempotencyKey, correlationId);
  }

  /** A worker's own history (VIEW_OWN_ATTENDANCE), or every worker's within the member's projects (VIEW_ATTENDANCE: the phone's offline review). */
  @Get("batches")
  listBatches(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("workerProfileId") workerProfileId?: string,
  ) {
    assertMayReadSyncHistory(user);
    return this.offlineSyncService.listBatches(user.organizationId, user, pageWindow({ page, pageSize }), workerProfileId);
  }

  @Get("batches/:id")
  getBatch(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    assertMayReadSyncHistory(user);
    return this.offlineSyncService.getBatch(user.organizationId, id, user);
  }
}

/** A manager whose role has no attendance of their own still reviews their workers' offline records. */
function assertMayReadSyncHistory(user: AuthenticatedUser) {
  if (!hasPermission(user, Permission.VIEW_OWN_ATTENDANCE) && !hasPermission(user, Permission.VIEW_ATTENDANCE)) {
    throw new AppException(403, ErrorCodes.FORBIDDEN, "Missing required permission(s): VIEW_OWN_ATTENDANCE or VIEW_ATTENDANCE");
  }
}
